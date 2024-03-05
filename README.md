# Wordpress Hosted on AWS Fargate with EFS and CDK

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Overview
* **Purpose:** This CDK project will setup the AWS infrastructure for hosting a WordPress website using ECS Containers, RDS, and EFS.
* **AWS Services Used:** 
- Route53
- EC2 NAT Instances
- VPC with 2 AZs
- Secrets Manager
- RDS MySQL
- Elastic File System
- Application Load Balancer
- ECS Cluster with Fargate Spot
- Bitnami WordPress image

## Getting Started

### Prerequisites
* An AWS account 
* Node.js and npm (or another supported CDK language/package manager)
* AWS CLI, SSO Profile, or Access Keys
* AWS CDK Toolkit installed globally (`npm install -g aws-cdk`)

### Installation

1. Clone the repository:
   ```bash
   git clone [https://github.com/mkober/wordpress-fargate-cdk.git

2. Install dependencies for the stacks
   ```bash
   cd stacks
   npm install

3. Create .env file with the following:
   ```bash
   REGION: string,
   ACCOUNT: string,
   VPC: string,
   DOMAIN: string,
   DOMAIN_WILDCARD: string,
   DATABASE_INSTANCE: string,
   DATABASE_NAME: string,
   DATABASE_USER: string,

3. Sythesize the CloudFormation Template
   ```bash
   cdk synth

4. Deployment
   ```bash
   cdk deploy

### Configuration
In order to complete the WordPress setup you will need to edit the wp-config.php file to define the FORCE_SSL_ADMIN, WP_HOME, and WP_SITEURL.  This will be accessible in the EFS mounted volume under /bitnami. In order to make this modification you will need to remote into one of the Fargate tasks using the AWS CLI. 

#### AWS CLI command to remote into and run BASH in a Fargate Task:
```bash
aws ecs execute-command  \
    --region us-east-1 \
    --cluster [cluster-name] \
    --task [task id, for example 0f9de17a6465404e8b1b2356dc13c2f8] \
    --container WordpressContainer \
    --command "/bin/bash" \
    --interactive

#### Change the following lines in /bitnami/wordpress/wp-config.php 
```bash
define( 'FORCE_SSL_ADMIN', true); \
define( 'WP_HOME', 'https://' . $_SERVER['HTTP_HOST'] . '/' ); \
define( 'WP_SITEURL', 'https://' . $_SERVER['HTTP_HOST'] . '/' );

 
## License

This project is licensed under the MIT License - see the [license.txt](license.txt) file for details.
