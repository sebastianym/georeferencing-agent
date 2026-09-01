import { Duration, RemovalPolicy, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';

/**
 * Data layer for the POC: job/address tracking in DynamoDB, raw uploads and
 * exports in S3. Removal policies are set to DESTROY on purpose — this is a
 * disposable POC stack, not a production data store.
 */
export class DataStack extends Stack {
  public readonly jobsTable: dynamodb.Table;
  public readonly addressesTable: dynamodb.Table;
  public readonly bucket: s3.Bucket;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.jobsTable = new dynamodb.Table(this, 'JobsTable', {
      tableName: 'georeferencing-agent-jobs',
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
    });

    this.addressesTable = new dynamodb.Table(this, 'AddressesTable', {
      tableName: 'georeferencing-agent-addresses',
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'addressId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
    });

    this.bucket = new s3.Bucket(this, 'DataBucket', {
      bucketName: `georeferencing-agent-${this.account}-${this.region}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.PUT, s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
        },
      ],
      lifecycleRules: [
        {
          prefix: 'uploads/',
          expiration: Duration.days(14),
        },
        {
          prefix: 'exports/',
          expiration: Duration.days(14),
        },
      ],
    });
  }
}
