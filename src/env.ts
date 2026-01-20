import * as dotenv from 'dotenv';

dotenv.config();

function readEnvString(key: string): string {
   const value = process.env[key];
   if (value === undefined || value === '') {
      throw new Error(`Environment variable ${key} is not set`);
   }
   return value;
}

function readEnvNumber(key: string): number {
   const num = parseInt(readEnvString(key), 10);
   if (Number.isNaN(num)) {
      throw new Error(`Environment variable ${key} is not a valid number`);
   }
   return num;
}

type R2Config = {
   bucketName: string;
   accessKeyId: string;
   secretKey: string;
   endpointUrl: string;
};

type Env = {
   general: {
      dataUpdateCheckIntervalSec: number;
      tokenExpirePeriodSec: number;
   };
   r2: {
      botSeparatePath: string;
      vrcPublic: R2Config & { baseUrl: string };
      backupPrivate: R2Config;
   };
   cdn: {
      zoneId: string;
      purgeApiKey: string;
   };
   discord: {
      token: string;
   };
};

export const env: Env = {
   general: {
      dataUpdateCheckIntervalSec: readEnvNumber('DATA_UPDATE_CHECK_INTERVAL_SEC'),
      tokenExpirePeriodSec: readEnvNumber('TOKEN_EXPIRE_PERIOD_SEC'),
   },
   r2: {
      botSeparatePath: readEnvString('R2_BOT_SEPARATE_PATH'),
      vrcPublic: {
         baseUrl: readEnvString('R2_VRC_BASE_URL'),
         bucketName: readEnvString('R2_VRC_BUCKET_NAME'),
         accessKeyId: readEnvString('R2_VRC_ACCESS_KEY_ID'),
         secretKey: readEnvString('R2_VRC_SECRET_KEY'),
         endpointUrl: readEnvString('R2_VRC_ENDPOINT_URL'),
      },
      backupPrivate: {
         bucketName: readEnvString('R2_BACKUP_BUCKET_NAME'),
         accessKeyId: readEnvString('R2_BACKUP_ACCESS_KEY_ID'),
         secretKey: readEnvString('R2_BACKUP_SECRET_KEY'),
         endpointUrl: readEnvString('R2_BACKUP_ENDPOINT_URL'),
      },
   },
   cdn: {
      zoneId: readEnvString('CDN_ZONE_ID'),
      purgeApiKey: readEnvString('CDN_PURGE_API_KEY'),
   },
   discord: {
      token: readEnvString('DISCORD_TOKEN'),
   },
};
