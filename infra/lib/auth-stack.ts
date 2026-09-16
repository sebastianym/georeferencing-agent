import { CfnOutput, Duration, Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

/**
 * Cognito User Pool for gating the demo behind a login. No public sign-up:
 * accounts only come from an authenticated admin (@cnid.co) using the
 * app's /admin page, which calls AdminCreateUser through the API — see
 * requireCnidCoAdmin in apps/api. The PreSignUp trigger (see
 * services/lambdas/pre-signup) still runs on that path too and rejects
 * anything outside the allowed domain as a second, server-side check that
 * doesn't rely on the API remembering to enforce it correctly.
 */
export class AuthStack extends Stack {
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const repoRoot = path.join(__dirname, '../../');
    const preSignUpFn = new nodejs.NodejsFunction(this, 'PreSignUpFunction', {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      timeout: Duration.seconds(10),
      projectRoot: repoRoot,
      depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
      bundling: { minify: true, sourceMap: false },
      entry: path.join(__dirname, '../../services/lambdas/pre-signup/src/index.ts'),
      environment: {
        ALLOWED_EMAIL_DOMAIN: 'cnid.co',
      },
    });

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
      lambdaTriggers: {
        preSignUp: preSignUpFn,
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
