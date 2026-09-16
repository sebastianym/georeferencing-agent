import { CfnOutput, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';

/**
 * A minimal Cognito User Pool for gating the demo behind a login. Accounts
 * are admin-created (no public sign-up) since this is a client demo, not a
 * public product — see the AWS CLI commands used to create the first user
 * after deploy.
 */
export class AuthStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'georeferencing-agent',
      selfSignUpEnabled: false,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
    });

    this.userPoolClient = this.userPool.addClient('WebClient', {
      authFlows: {
        // Frontend posts username/password directly to Cognito's
        // InitiateAuth over HTTPS (no SRP client library needed) — the
        // client has no secret, so this is safe for a browser context.
        userPassword: true,
        userSrp: false,
        adminUserPassword: false,
        custom: false,
      },
      generateSecret: false,
      accessTokenValidity: undefined,
    });

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'UserPoolClientId', { value: this.userPoolClient.userPoolClientId });
  }
}
