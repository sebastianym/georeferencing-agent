import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as wafv2 from 'aws-cdk-lib/aws-wafv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as path from 'path';

export interface ApiStackProps extends StackProps {
  vpc: ec2.Vpc;
  jobsTable: dynamodb.Table;
  addressesTable: dynamodb.Table;
  dataBucket: s3.Bucket;
  validationStateMachine: sfn.StateMachine;
  normalizationStateMachine: sfn.StateMachine;
}

/**
 * The API tier: a small always-on ECS Fargate service behind an ALB, with
 * AWS WAF attached. This is the only piece of compute the frontend talks to
 * directly; everything it does (seed a job, kick off Step Functions,
 * read status) is just AWS SDK calls, so the task lives in fully isolated
 * private subnets — see NetworkStack for why no NAT Gateway is required.
 */
export class ApiStack extends Stack {
  public readonly service: ecsPatterns.ApplicationLoadBalancedFargateService;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const {
      vpc,
      jobsTable,
      addressesTable,
      dataBucket,
      validationStateMachine,
      normalizationStateMachine,
    } = props;

    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
      clusterName: 'georeferencing-agent',
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });

    this.service = new ecsPatterns.ApplicationLoadBalancedFargateService(this, 'ApiService', {
      cluster,
      cpu: 256,
      memoryLimitMiB: 512,
      desiredCount: 2,
      minHealthyPercent: 100,
      maxHealthyPercent: 200,
      publicLoadBalancer: true,
      taskSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      circuitBreaker: { rollback: true },
      taskImageOptions: {
        image: ecs.ContainerImage.fromAsset(path.join(__dirname, '../../apps/api')),
        containerPort: 8080,
        environment: {
          PORT: '8080',
          JOBS_TABLE: jobsTable.tableName,
          ADDRESSES_TABLE: addressesTable.tableName,
          DATA_BUCKET: dataBucket.bucketName,
          VALIDATION_STATE_MACHINE_ARN: validationStateMachine.stateMachineArn,
          NORMALIZATION_STATE_MACHINE_ARN: normalizationStateMachine.stateMachineArn,
        },
        logDriver: ecs.LogDrivers.awsLogs({
          streamPrefix: 'api',
          logRetention: logs.RetentionDays.ONE_WEEK,
        }),
      },
    });

    this.service.targetGroup.configureHealthCheck({ path: '/health' });

    jobsTable.grantReadWriteData(this.service.taskDefinition.taskRole);
    addressesTable.grantReadWriteData(this.service.taskDefinition.taskRole);
    dataBucket.grantReadWrite(this.service.taskDefinition.taskRole);
    validationStateMachine.grantStartExecution(this.service.taskDefinition.taskRole);
    normalizationStateMachine.grantStartExecution(this.service.taskDefinition.taskRole);

    const webAcl = new wafv2.CfnWebACL(this, 'ApiWebAcl', {
      scope: 'REGIONAL',
      defaultAction: { allow: {} },
      visibilityConfig: {
        sampledRequestsEnabled: true,
        cloudWatchMetricsEnabled: true,
        metricName: 'georeferencing-agent-api',
      },
      rules: [
        {
          name: 'AWS-AWSManagedRulesCommonRuleSet',
          priority: 0,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesCommonRuleSet',
              // ALB's WAF body-inspection limit is a hard 8KB, not
              // configurable via AssociationConfig (that only applies to
              // CloudFront/API Gateway/Cognito/App Runner/Verified Access).
              // Bulk CSV/JSON uploads routinely exceed that, so the generic
              // "body too large" rule gets switched to Count instead of
              // Block — everything else in the Core Rule Set stays enforced.
              ruleActionOverrides: [{ name: 'SizeRestrictions_BODY', actionToUse: { count: {} } }],
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'CommonRuleSet',
          },
        },
        {
          name: 'AWS-AWSManagedRulesKnownBadInputsRuleSet',
          priority: 1,
          overrideAction: { none: {} },
          statement: {
            managedRuleGroupStatement: {
              vendorName: 'AWS',
              name: 'AWSManagedRulesKnownBadInputsRuleSet',
            },
          },
          visibilityConfig: {
            sampledRequestsEnabled: true,
            cloudWatchMetricsEnabled: true,
            metricName: 'KnownBadInputs',
          },
        },
      ],
    });

    new wafv2.CfnWebACLAssociation(this, 'ApiWebAclAssociation', {
      resourceArn: this.service.loadBalancer.loadBalancerArn,
      webAclArn: webAcl.attrArn,
    });

    // The ALB has no ACM certificate (no custom domain for this POC), so it
    // only serves HTTP — which the Amplify-hosted frontend (HTTPS) can't
    // call directly due to mixed-content blocking. Fronting it with
    // CloudFront gives free HTTPS via the default *.cloudfront.net
    // certificate without needing a domain. The WAF above stays attached to
    // the ALB directly; this distribution is just a TLS passthrough.
    const distribution = new cloudfront.Distribution(this, 'ApiDistribution', {
      comment: 'HTTPS front door for the georeferencing-agent API ALB',
      defaultBehavior: {
        origin: new origins.HttpOrigin(this.service.loadBalancer.loadBalancerDnsName, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
      },
    });

    new CfnOutput(this, 'ApiHttpsUrl', { value: `https://${distribution.distributionDomainName}` });
  }
}
