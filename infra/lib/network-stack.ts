import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

/**
 * Network foundation for the POC.
 *
 * Design decision: no NAT Gateway. Fargate tasks never need to reach the
 * public internet (they only talk to DynamoDB, S3, Step Functions, Secrets
 * Manager and ECR/Logs, all reachable through VPC endpoints), so they sit in
 * fully isolated private subnets. The Lambdas that must call the public HERE
 * API run outside the VPC (default Lambda networking), which reaches both
 * AWS APIs and the public internet without needing a NAT Gateway either.
 * Net effect: zero NAT Gateway cost, and the only public entry point in the
 * whole system is the ALB.
 */
export class NetworkStack extends Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.vpc = new ec2.Vpc(this, 'Vpc', {
      maxAzs: 2,
      natGateways: 0,
      subnetConfiguration: [
        {
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'private-isolated',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    // Gateway endpoints (free) — required for ECR image layers and for
    // direct, private DynamoDB/S3 access from the Fargate task.
    this.vpc.addGatewayEndpoint('S3Endpoint', {
      service: ec2.GatewayVpcEndpointAwsService.S3,
    });
    this.vpc.addGatewayEndpoint('DynamoDbEndpoint', {
      service: ec2.GatewayVpcEndpointAwsService.DYNAMODB,
    });

    // Interface endpoints — everything else the Fargate task needs while
    // living in a subnet with no internet route.
    const interfaceServices: Array<[string, ec2.InterfaceVpcEndpointAwsService]> = [
      ['EcrApiEndpoint', ec2.InterfaceVpcEndpointAwsService.ECR],
      ['EcrDkrEndpoint', ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER],
      ['LogsEndpoint', ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS],
      ['SecretsManagerEndpoint', ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER],
      ['StepFunctionsEndpoint', ec2.InterfaceVpcEndpointAwsService.STEP_FUNCTIONS],
    ];

    // Shared by all interface endpoints. Ingress is scoped to the VPC CIDR
    // (not to a specific consumer security group) so that any resource
    // inside the VPC — the Fargate service today, anything else later — can
    // reach the endpoints without creating a cross-stack security-group
    // reference (which would otherwise create a dependency cycle between
    // this stack and whichever stack owns that consumer's security group).
    const endpointsSecurityGroup = new ec2.SecurityGroup(this, 'EndpointsSecurityGroup', {
      vpc: this.vpc,
      description: 'Allows VPC-internal HTTPS traffic to reach interface VPC endpoints',
      allowAllOutbound: true,
    });
    endpointsSecurityGroup.addIngressRule(
      ec2.Peer.ipv4(this.vpc.vpcCidrBlock),
      ec2.Port.tcp(443),
      'HTTPS from within the VPC'
    );

    // Single-AZ on purpose: each interface endpoint is billed per-AZ-hour,
    // so 5 endpoints x 2 AZs would roughly double this cost for a POC that
    // doesn't need that redundancy. Traffic from the other AZ still reaches
    // it fine (cross-AZ, same VPC); an AZ outage would be an acceptable risk
    // for a one-month demo, not for a production workload.
    for (const [endpointId, service] of interfaceServices) {
      this.vpc.addInterfaceEndpoint(endpointId, {
        service,
        subnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED, availabilityZones: [this.vpc.availabilityZones[0]] },
        securityGroups: [endpointsSecurityGroup],
      });
    }
  }
}
