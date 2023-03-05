import * as admin from 'firebase-admin';
import { Bucket } from '@google-cloud/storage';
import { Database } from '@/src/mod/database';
import { GLOBAL_SETTING } from '@/src/mod/setting_adapter';
import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { operation } from '@/src/mod/logger';

export class Firebase {
   /**
    * constructor. authentication with secret key.
    * @param token
    * @param db
    */
   bucket: Bucket;
   constructor(private db: Database) {
      //get secret key
      const keyPath = path.join('settings', 'private', 'firebase-secret.json');
      const key = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
      console.log('firebase auth start');
      admin.initializeApp({
         credential: admin.credential.cert(key as admin.ServiceAccount),
         storageBucket: GLOBAL_SETTING.FIREBASE.BUCKET_NAME,
      });
      this.bucket = admin.storage().bucket();
      console.log('firebase auth end');
   }

   /**
    * get filename and upload Text to firebase.
    * @param guildId
    * @param guildName
    * @param content
    * @returns
    */
   async writeFireBaseFile(guildId: string, guildName: string, content: string) {
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
         const FILE_NAME_LENGTH = 10;
         while (true) {
            //get random string as fileName
            const filenameTemp = crypto.randomBytes(FILE_NAME_LENGTH).reduce((p, i) => p + (i % 32).toString(32), '') + '.txt';
            //Check duplicate file name
            const result = await this.db.fileNameIsExist(filenameTemp);
            if (!result) {
               //new file name
               fileName = filenameTemp;
               break;
            }
         }
      }
      const firebasePath = GLOBAL_SETTING.FIREBASE.FILE_ROOT_PATH + fileName;
      const result = await this.uploadToFirebase(content, firebasePath);
      if (!result) return false;
      if (newFile) {
         const fireBaseUrl = await this.getFirebaseUrl(firebasePath);
         if (!fireBaseUrl) return false;
         //record new guild url
         this.db.textLinkCreate(guildId, guildName, fileName, fireBaseUrl);
      }
      return true;
   }

   /**
    * upload Text to firebase.
    * @param guildId
    * @param guildName
    * @param content
    * @returns
    */
   async uploadToFirebase(content: string, FirebasePath: string) {
      //upload Text to firebase
      const file = this.bucket.file(FirebasePath); //path
      try {
         await file.save(content, {
            gzip: false,
            contentType: 'text/plain',
         });
      } catch (err) {
         console.log(err);
         operation.warn(err);
         return false;
      }
      return true;
   }
   /**
    * get download url of text file.
    * @param FirebasePath
    * @returns
    */
   async getFirebaseUrl(FirebasePath: string) {
      //upload Text to firebase
      try {
         //get download url
         const url = await this.bucket.file(FirebasePath).getSignedUrl({
            action: 'read',
            expires: '12-31-3000', //set after 1000 year (actually, forever)
         });
         const urlString = url[0];
         return urlString;
      } catch (err) {
         console.log(err);
         operation.warn(err);
      }
      return null;
   }
}
