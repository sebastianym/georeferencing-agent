#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { NetworkStack } from '../lib/network-stack';
import { DataStack } from '../lib/data-stack';
import { AgentStack } from '../lib/agent-stack';
import { ProcessingStack } from '../lib/processing-stack';
import { ApiStack } from '../lib/api-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const network = new NetworkStack(app, 'GeoAgent-Network', { env });
const data = new DataStack(app, 'GeoAgent-Data', { env });
const agent = new AgentStack(app, 'GeoAgent-Agent', { env });

const processing = new ProcessingStack(app, 'GeoAgent-Processing', {
  env,
  addressesTable: data.addressesTable,
  hereSecretName: 'georeferencing-agent/here-api-key',
  googleMapsSecretName: 'georeferencing-agent/google-maps-api-key',
  arcgisSecretName: 'georeferencing-agent/arcgis-api-key',
  guardrail: agent.guardrail,
  guardrailVersion: agent.guardrailVersion,
});

new ApiStack(app, 'GeoAgent-Api', {
  env,
  vpc: network.vpc,
  jobsTable: data.jobsTable,
  addressesTable: data.addressesTable,
  dataBucket: data.bucket,
  validationStateMachine: processing.validationStateMachine,
  normalizationStateMachine: processing.normalizationStateMachine,
});
