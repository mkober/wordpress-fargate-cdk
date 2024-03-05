import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as cm from 'aws-cdk-lib/aws-certificatemanager';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';

import { aws_ecs as ecs } from 'aws-cdk-lib';

import { Construct } from 'constructs';
import { ConfigProps } from './config';

type WordpressStackProps = cdk.StackProps & {
  config: Readonly<ConfigProps>
}

export class WordpressStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: WordpressStackProps) {
    super(scope, id, props);

    // Route53 Domain Zone
    const domainZone = route53.HostedZone.fromLookup(this, 'Domain', {
      domainName: props.config.DOMAIN 
    });

    // Certificate
    const certificate = new cm.Certificate(this, 'Certificate', {
      domainName: props.config.DOMAIN,
      validation: cm.CertificateValidation.fromDns(domainZone),
      subjectAlternativeNames: [props.config.DOMAIN_WILDCARD]
    });

    const natGatewayProvider = ec2.NatInstanceProvider.instance({
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MICRO),
      machineImage: ec2.MachineImage.lookup({
          name: 'fck-nat-amzn2-*-arm64-ebs',
          owners: ['568608671756'],
      })
    });

    // Create a VPC with 2 AZs with public and private subnets
    const vpc = new ec2.Vpc(this, props.config.VPC, {
      natGateways: 2,
      natGatewayProvider,
      createInternetGateway: true,
      enableDnsHostnames: true,
      enableDnsSupport: true,
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: cdk.aws_ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
    });


    // Too many secrets
    const wordpressSecret = new secretsmanager.Secret(this, 'WordpressSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: props.config.DATABASE_USER }),
        generateStringKey: 'password',
        excludeCharacters: '/@"',
      },
    });

    const dbInstance = new rds.DatabaseInstance(this, props.config.DATABASE_NAME, {
      credentials: {
        username: wordpressSecret.secretValueFromJson('username').unsafeUnwrap(),
        password: wordpressSecret.secretValueFromJson('password')
      },
      databaseName: props.config.DATABASE_NAME,
      engine: rds.DatabaseInstanceEngine.mysql({
        version: rds.MysqlEngineVersion.VER_8_0_28,
      }),
      instanceIdentifier: props.config.DATABASE_INSTANCE,
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO,
      ),
      port: 3306,
      publiclyAccessible: false,
      vpc: vpc,
      //multiAz: true,
      vpcSubnets: {
        onePerAz: true,
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }
    });
    
    const fileSystem = new efs.FileSystem(this, 'FileSystem', {
      vpc,
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
    })

    fileSystem.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: [
          'elasticfilesystem:ClientMount',
          'elasticfilesystem:ClientWrite',
          'elasticfilesystem:ClientRootAccess'
        ],
        principals: [new iam.AnyPrincipal()],
        conditions: {
          Bool: {
            'elasticfilesystem:AccessedViaMountTarget': 'true'
          }
        }
      })
    )

    
    const accessPoint = new efs.AccessPoint(this, 'WordpressAccessPoint', {
      fileSystem: fileSystem,
      path: '/bitnami',
      createAcl: {
        ownerUid: '1000',
        ownerGid: '1000',
        permissions: '0777',
      },
      posixUser: {
        uid: '1000',
        gid: '1000',
      },
    });

    // Configure the Fargate service with a load balancer
    const albFargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, 'FargateService', {
      listenerPort: 443,
      cpu: 256, 
      capacityProviderStrategies: [{
        capacityProvider: 'FARGATE_SPOT',
        base: 2,
        weight: 2
      }],
      desiredCount: 2,
      enableExecuteCommand: true,
      taskImageOptions: { 
        image: ecs.ContainerImage.fromRegistry("bitnami/wordpress"),
        containerName: 'WordpressContainer',
        containerPort: 8080,
        enableLogging: true,
        environment: {
          "MARIADB_HOST": dbInstance.dbInstanceEndpointAddress,
          "WORDPRESS_DATABASE_USER": props.config.DATABASE_USER,
          "WORDPRESS_DATABASE_PASSWORD": wordpressSecret.secretValueFromJson('password').unsafeUnwrap(),
          "WORDPRESS_DATABASE_NAME": props.config.DATABASE_NAME,
          "PHP_MEMORY_LIMIT": "512M",
          "enabled": "false",
        },
      },
      memoryLimitMiB: 512,
      publicLoadBalancer: true,
      certificate: certificate,
      taskSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      vpc: vpc
    });

    // Add the EFS volume to the Fargate task
    albFargateService.taskDefinition.addVolume(
      {
        name: "WordpressVolume",
        efsVolumeConfiguration: {
          fileSystemId: fileSystem.fileSystemId,
          transitEncryption: "ENABLED",
          authorizationConfig: {
            accessPointId: accessPoint.accessPointId,
            iam: "DISABLED",
          }
        }
      }
    )
    
    // Mount the EFS volume in the container at the exected volume path
    const wordpressContainer = albFargateService.taskDefinition.findContainer("WordpressContainer");
    wordpressContainer?.addMountPoints({
      containerPath: "/bitnami/wordpress",
      sourceVolume: "WordpressVolume",
      readOnly: false
    });

    // Add redirect from port 80 to 443
    albFargateService.loadBalancer.addListener("PortEightyListener", {
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        host: props.config.DOMAIN,
        protocol: 'HTTPS',
        port: '443'
      })
    })

    // 30 secs for the deregistration process to complete 
    albFargateService.targetGroup.setAttribute('deregistration_delay.timeout_seconds', '30');

    const aliasRecord = new route53.ARecord(this, 'AliasRecord', {
      zone: domainZone,
      target: route53.RecordTarget.fromAlias(new targets.LoadBalancerTarget(albFargateService.loadBalancer))
    });

    natGatewayProvider.securityGroup.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.allTraffic());

    // Allow access to RDS from Fargate ECS
    dbInstance.connections.allowDefaultPortFrom(albFargateService.service.connections);

    // Allow access to EFS from Fargate ECS
    fileSystem.grantRootAccess(albFargateService.taskDefinition.taskRole.grantPrincipal);
    fileSystem.connections.allowDefaultPortFrom(albFargateService.service.connections);

  }
}
