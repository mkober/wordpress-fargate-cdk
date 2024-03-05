#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { WordpressStack } from '../lib/wordpress-stack';

import { getConfig } from "../lib/config";

const config = getConfig();

const app = new cdk.App();
new WordpressStack(app, 'WordpressStack', {
  env: {
    region: config.REGION,
    account: config.ACCOUNT
  },
  config
});
