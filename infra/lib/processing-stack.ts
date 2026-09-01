import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as bedrock from 'aws-cdk-lib/aws-bedrock';
import * as path from 'path';

export interface ProcessingStackProps extends StackProps {
  addressesTable: dynamodb.Table;
  hereSecretName: string;
  guardrail: bedrock.CfnGuardrail;
  guardrailVersion: bedrock.CfnGuardrailVersion;
  bedrockModelId?: string;
}

/**
 * The processing pipeline: two single-purpose Lambdas (HERE geocode,
 * Bedrock-based normalization) wired into Step Functions Distributed Map
 * state machines. Distributed Map runs each item as its own child workflow
 * execution, which is why it's used here instead of a plain Map — at ~1000
 * items a plain (inline) Map risks the 25,000-event execution history limit,
 * Distributed Map does not.
 */
export class ProcessingStack extends Stack {
  public readonly validationStateMachine: sfn.StateMachine;
  public readonly normalizationStateMachine: sfn.StateMachine;

  constructor(scope: Construct, id: string, props: ProcessingStackProps) {
    super(scope, id, props);

    const { addressesTable, guardrail } = props;
    // This AWS account is provisioned under a partner/channel program, which
    // blocks third-party marketplace models (Anthropic/Claude) on Bedrock
    // regardless of model ID or inference profile ("Access to this model is
    // not available for channel program accounts"). Amazon's own first-party
    // models are unaffected. Nova Lite over Nova Pro specifically because
    // this account's cross-region RPM quota for Lite is 200 vs. Pro's 25 —
    // both fixed, non-adjustable quotas tied to the account type — and Lite
    // is still capable enough for this rewrite task.
    const modelId = props.bedrockModelId ?? 'us.amazon.nova-lite-v1:0';
    const hereSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'HereApiKeySecret',
      props.hereSecretName
    );

    const repoRoot = path.join(__dirname, '../../');
    const commonNodeJsProps: Partial<nodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 512,
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      bundling: { minify: true, sourceMap: false },
    };

    const hereGeocodeFn = new nodejs.NodejsFunction(this, 'HereGeocodeFunction', {
      ...commonNodeJsProps,
      entry: path.join(__dirname, '../../services/lambdas/here-geocode/src/index.ts'),
      environment: {
        ADDRESSES_TABLE: addressesTable.tableName,
        HERE_SECRET_ARN: hereSecret.secretArn,
      },
    });

    const normalizeAddressFn = new nodejs.NodejsFunction(this, 'NormalizeAddressFunction', {
      ...commonNodeJsProps,
      // A single invocation now handles a batch (one Bedrock call covering
      // several addresses, then up to 2 HERE calls per address run in
      // parallel), so it needs more headroom than a single-item call did.
      timeout: Duration.seconds(90),
      entry: path.join(__dirname, '../../services/lambdas/normalize-address/src/index.ts'),
      environment: {
        ADDRESSES_TABLE: addressesTable.tableName,
        HERE_SECRET_ARN: hereSecret.secretArn,
        BEDROCK_MODEL_ID: modelId,
        GUARDRAIL_ID: guardrail.attrGuardrailId,
        // DRAFT always reflects the guardrail's current saved config, so
        // iterating on the guardrail (as we're actively doing) takes effect
        // immediately. CfnGuardrailVersion snapshots are create-only and
        // silently go stale on further edits (guardrailVersion is kept on
        // AgentStack for when we publish a stable numbered version ahead of
        // the client demo, but isn't wired in here yet).
        GUARDRAIL_VERSION: 'DRAFT',
      },
    });

    for (const fn of [hereGeocodeFn, normalizeAddressFn]) {
      addressesTable.grantReadWriteData(fn);
      hereSecret.grantRead(fn);
    }

    normalizeAddressFn.addToRolePolicy(
      new iam.PolicyStatement({
        // Cross-region inference profiles fan out to the underlying
        // foundation models in whichever region they route to, so the role
        // needs InvokeModel on both the profile itself and the Anthropic
        // foundation models across regions it may dispatch to.
        actions: ['bedrock:InvokeModel'],
        resources: [
          'arn:aws:bedrock:*::foundation-model/amazon.*',
          'arn:aws:bedrock:*::foundation-model/anthropic.*',
          `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/*`,
        ],
      })
    );
    normalizeAddressFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['bedrock:ApplyGuardrail'],
        resources: [guardrail.attrGuardrailArn],
      })
    );

    // Validation only calls HERE, which has no quota tight enough to worry
    // about at this scale, so it keeps full concurrency.
    this.validationStateMachine = this.buildDistributedMapStateMachine('ValidationStateMachine', hereGeocodeFn, {
      maxConcurrency: 10,
      retryAttempts: 4,
      retryInterval: Duration.seconds(2),
      timeout: Duration.minutes(30),
    });

    // Normalization calls Bedrock, which on this account has a fixed,
    // non-adjustable requests/minute quota (confirmed via Service Quotas:
    // Adjustable=false) — 25 RPM for Nova Pro, 200 RPM for Nova Lite. Request
    // count is the binding constraint, not tokens (Nova Lite's token quota on
    // this account is in the hundreds of thousands per minute, essentially
    // unused at our per-address prompt size), so batching several addresses
    // into one Converse call multiplies effective throughput without needing
    // more requests. Trade-off: the guardrail's grounding check scores the
    // whole batch response as one block, so one bad address can take the
    // rest of its batch down with it — batch size stays modest to limit that
    // blast radius.
    this.normalizationStateMachine = this.buildBatchedNormalizationStateMachine(normalizeAddressFn, {
      maxConcurrency: 8,
      batchSize: 8,
      retryAttempts: 6,
      retryInterval: Duration.seconds(3),
      timeout: Duration.minutes(45),
    });
  }

  /**
   * Input contract for both state machines: { "items": [{ "jobId": "...", "addressId": "..." }, ...] }
   * The invoked Lambda is the source of truth for reading/writing the address record.
   */
  private buildDistributedMapStateMachine(
    id: string,
    fn: lambda.IFunction,
    opts: { maxConcurrency: number; retryAttempts: number; retryInterval: Duration; timeout: Duration }
  ): sfn.StateMachine {
    const invokeTask = new tasks.LambdaInvoke(this, `${id}Invoke`, {
      lambdaFunction: fn,
      payload: sfn.TaskInput.fromObject({
        jobId: sfn.JsonPath.stringAt('$.jobId'),
        addressId: sfn.JsonPath.stringAt('$.addressId'),
      }),
      retryOnServiceExceptions: true,
    });
    invokeTask.addRetry({
      errors: ['States.TaskFailed', 'Lambda.TooManyRequestsException', 'ThrottlingException'],
      interval: opts.retryInterval,
      backoffRate: 2,
      maxAttempts: opts.retryAttempts,
    });

    const distributedMap = sfn.DistributedMap.jsonPath(this, `${id}DistributedMap`, {
      itemsPath: '$.items',
      maxConcurrency: opts.maxConcurrency,
      toleratedFailurePercentage: 10,
    });
    distributedMap.itemProcessor(invokeTask);

    // Distributed Map runs each iteration as a child workflow execution of
    // this same state machine. CDK detects the DistributedMap in the graph
    // and automatically attaches an inline policy granting the execution
    // role states:StartExecution/DescribeExecution/StopExecution on itself
    // (built specifically to avoid the resource-creation cycle a hand-written
    // equivalent runs into) — no manual grant needed here.
    const stateMachine = new sfn.StateMachine(this, id, {
      stateMachineName: `georeferencing-agent-${id}`,
      definitionBody: sfn.DefinitionBody.fromChainable(distributedMap),
      timeout: opts.timeout,
    });

    return stateMachine;
  }

  /**
   * Same Distributed Map shape as above, but with an ItemBatcher: each child
   * workflow execution receives a *group* of items — `{ Items: [...] }` —
   * instead of one, and the Lambda makes a single Bedrock call covering the
   * whole group. maxConcurrency × batchSize is the real throughput lever
   * here, not maxConcurrency alone.
   */
  private buildBatchedNormalizationStateMachine(
    fn: lambda.IFunction,
    opts: {
      maxConcurrency: number;
      batchSize: number;
      retryAttempts: number;
      retryInterval: Duration;
      timeout: Duration;
    }
  ): sfn.StateMachine {
    const id = 'NormalizationStateMachine';
    const invokeTask = new tasks.LambdaInvoke(this, `${id}Invoke`, {
      lambdaFunction: fn,
      payload: sfn.TaskInput.fromObject({
        items: sfn.JsonPath.listAt('$.Items'),
      }),
      retryOnServiceExceptions: true,
    });
    invokeTask.addRetry({
      errors: ['States.TaskFailed', 'Lambda.TooManyRequestsException', 'ThrottlingException'],
      interval: opts.retryInterval,
      backoffRate: 2,
      maxAttempts: opts.retryAttempts,
    });

    const distributedMap = sfn.DistributedMap.jsonPath(this, `${id}DistributedMap`, {
      itemsPath: '$.items',
      maxConcurrency: opts.maxConcurrency,
      toleratedFailurePercentage: 10,
      itemBatcher: new sfn.ItemBatcher({ maxItemsPerBatch: opts.batchSize }),
    });
    distributedMap.itemProcessor(invokeTask);

    const stateMachine = new sfn.StateMachine(this, id, {
      stateMachineName: `georeferencing-agent-${id}`,
      definitionBody: sfn.DefinitionBody.fromChainable(distributedMap),
      timeout: opts.timeout,
    });

    return stateMachine;
  }
}
