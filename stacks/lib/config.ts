import * as dotenv from "dotenv";

import path = require("path");

dotenv.config({
  path: path.resolve(__dirname, "../.env")
});

export type ConfigProps = {
  REGION: string,
  ACCOUNT: string,
  VPC: string,
  DOMAIN: string,
  DOMAIN_WILDCARD: string,
  DATABASE_INSTANCE: string,
  DATABASE_NAME: string,
  DATABASE_USER: string,
};

export const getConfig = (): ConfigProps => ({
  REGION: process.env.REGION || "us-east-1",
  ACCOUNT: process.env.ACCOUNT || "",
  VPC: process.env.VPC || "Vpc",
  DOMAIN: process.env.DOMAIN || "",
  DOMAIN_WILDCARD: process.env.DOMAIN_WILDCARD || "",
  DATABASE_INSTANCE: process.env.DATABASE_INSTANCE || "db",
  DATABASE_NAME: process.env.DATABASE_NAME || "db",
  DATABASE_USER: process.env.DATABASE_USER || "admin",
});
