import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as crypto from 'node:crypto';
import { Database } from '@/src/mod/database';
import { operation } from '@/src/mod/logger';
import { env } from '@/src/env';

interface CdnConfig {
   purgeApiUrl: string;
   purgeApiKey: string;
}

interface R2 {
   client: S3Client;
   bucketName: string;
}

export class CloudflareForWorld {
   private r2: R2 & { baseUrl: string };
   private cdnConfig: CdnConfig;
   botR2SeparatePath: string;

   constructor(private db: Database) {
      //read parameter from env
      this.botR2SeparatePath = env.r2.botR2SeparatePath;

      this.r2 = {
         client: new S3Client({
            region: 'auto',
            endpoint: env.r2.vrcPublic.endpointUrl,
            credentials: {
               accessKeyId: env.r2.vrcPublic.accessKeyId,
               secretAccessKey: env.r2.vrcPublic.secretKey,
            },
         }),
         bucketName: env.r2.vrcPublic.bucketName,
         baseUrl: env.r2.vrcPublic.baseUrl,
      };

      const purgeApiUrl = `https://api.cloudflare.com/client/v4/zones/${env.cdn.zoneId}/purge_cache`;
      this.cdnConfig = {
         purgeApiUrl,
         purgeApiKey: env.cdn.purgeApiKey,
      };
   }

   /**
    * get filename and upload Text to r2.
    * @param guildId
    * @param guildName
    * @param content
    * @returns
    */
   public async uploadWorldToken(guildId: string, guildName: string, content: string) {
      //check database created
      let newFile = true;
      let fileName = await this.db.getFileName(guildId); //filepath is path of github. contain filename.
      if (fileName) {
         newFile = false;
         //guild database is created. record update
         this.db.textLinkUpdate(guildId, guildName);
      } else {
         newFile = true;
         //guild database is not create
         while (true) {
            //get uuid string as fileName
            const filenameTemp = crypto.randomUUID() + '.bin';
            //Check duplicate file name
            const result = await this.db.fileNameIsExist(filenameTemp);
            if (!result) {
               //new file name
               fileName = filenameTemp;
               break;
            }
         }
      }
      const r2FileKey = this.botR2SeparatePath + fileName;
      const textLink = this.r2.baseUrl + r2FileKey;

      //upload object
      const result = await this.putObject(r2FileKey, content);
      if (!result) return false;
      if (newFile) {
         //record new guild url
         this.db.textLinkCreate(guildId, guildName, fileName, textLink);
      }

      //purge cache
      await this.purgeCacheSingleFile(textLink);
      return true;
   }

   private async putObject(key: string, body: Buffer | string | Uint8Array, contentType?: string): Promise<boolean> {
      try {
         await this.r2.client.send(
            new PutObjectCommand({
               Bucket: this.r2.bucketName,
               Key: key,
               Body: body,
               ContentType: contentType,
            })
         );
         return true;
      } catch (error) {
         console.warn('Error putObject:', error);
         return false;
      }
   }

   private async purgeCacheSingleFile(url: string): Promise<void> {
      await this.purgeCache([url]);
   }

   private async purgeCache(urls: string[]): Promise<void> {
      try {
         const response = await fetch(this.cdnConfig.purgeApiUrl, {
            method: 'POST',
            headers: {
               Authorization: `Bearer ${this.cdnConfig.purgeApiKey}`,
               'Content-Type': 'application/json',
            },
            body: JSON.stringify({
               files: urls,
            }),
         });

         if (!response.ok) {
            const errorData = await response.json();
            throw new Error(`Cloudflare cache purge failed: ${JSON.stringify(errorData)}`);
         }

         const result = (await response.json()) as {
            success: boolean;
            errors?: unknown[];
         };
         if (result.success) {
            console.log(`Successfully purged ${urls.length} URLs from Cloudflare cache`);
         } else {
            operation.warn('Cloudflare cache purge errors:', result.errors);
            throw new Error(`Cloudflare cache purge failed: ${JSON.stringify(result.errors)}`);
         }
      } catch (error) {
         operation.warn('Error purging Cloudflare cache:', error);
      }
   }
}

export class CloudflareForBackup {
   private r2: R2;
   botR2SeparatePath: string;

   constructor() {
      //read parameter from env
      this.r2 = {
         client: new S3Client({
            region: 'auto',
            endpoint: env.r2.backupPrivate.endpointUrl,
            credentials: {
               accessKeyId: env.r2.backupPrivate.accessKeyId,
               secretAccessKey: env.r2.backupPrivate.secretKey,
            },
         }),
         bucketName: env.r2.backupPrivate.bucketName,
      };
      this.botR2SeparatePath = env.r2.botR2SeparatePath;
   }

   public async uploadDataBaseBackup(fileName: string, dbData: Buffer | string | Uint8Array): Promise<boolean> {
      const r2FileKey = this.botR2SeparatePath + fileName;
      return await this.putObject(r2FileKey, dbData);
   }

   private async putObject(key: string, body: Buffer | string | Uint8Array, contentType?: string): Promise<boolean> {
      try {
         await this.r2.client.send(
            new PutObjectCommand({
               Bucket: this.r2.bucketName,
               Key: key,
               Body: body,
               ContentType: contentType,
            })
         );
         return true;
      } catch (error) {
         console.warn('Error putObject:', error);
         return false;
      }
   }
}
