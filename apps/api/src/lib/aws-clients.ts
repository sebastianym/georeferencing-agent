import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { S3Client } from '@aws-sdk/client-s3';
import { SFNClient } from '@aws-sdk/client-sfn';
import { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
export const s3 = new S3Client({});
export const sfn = new SFNClient({});
export const cognito = new CognitoIdentityProviderClient({});

export const env = {
  jobsTable: process.env.JOBS_TABLE!,
  addressesTable: process.env.ADDRESSES_TABLE!,
  dataBucket: process.env.DATA_BUCKET!,
  validationStateMachineArn: process.env.VALIDATION_STATE_MACHINE_ARN!,
  normalizationStateMachineArn: process.env.NORMALIZATION_STATE_MACHINE_ARN!,
  userPoolId: process.env.COGNITO_USER_POOL_ID!,
};
