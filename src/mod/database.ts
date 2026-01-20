import { getNowJst, getNowAndToDayJst } from '@/src/mod/utility';
import { PrismaClient, Prisma, Setting } from '@prisma/client';
import * as log from '@/src/mod/logger';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { CloudflareForBackup } from './cloudflare';

export type RegisterVrcNameResult = 'REGISTERED' | 'CHANGED' | 'REACH_LIMIT' | 'SAME_VRC_NAME' | 'ERROR'; // use as enum
export type CommandResult = 'SUCCESS' | 'FAILED: CANT_FIND_TARGET' | 'ERROR'; // use as enum

// DB backup retry settings
const DB_BACKUP_RETRY_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
const DB_BACKUP_RETRY_MAX_COUNT = 72; // 12 hours / 10 minutes = 72 retries

export class Database {
   private cloudflareBackup: CloudflareForBackup;
   private dbBackupRetryTimer: NodeJS.Timeout | null = null;
   private dbBackupRetryCount = 0;

   constructor(private prisma: PrismaClient) {
      this.cloudflareBackup = new CloudflareForBackup();
   }

   // -----------------------------define vrc display name token function----------------------
   /**
    * Get VRChat name from database.
    * @param userId
    * @returns
    */
   async getVrcName(guildId: string, userId: string): Promise<string | null> {
      const vrcNameList = await this.prisma.vrcNameList.findUnique({ where: { guildId_userId: { guildId, userId } }, select: { vrcName: true } });
      if (!vrcNameList) {
         return null;
      } else {
         return vrcNameList.vrcName;
      }
   }

   async getAllMembersVrcName(guildId: string): Promise<{ registeredMembers: { [key: string]: string }; registeredIds: string[] }> {
      const registeredMembers: { [key: string]: string } = {};
      const registeredIds: string[] = [];
      const vrcNameList = await this.prisma.vrcNameList.findMany({
         where: { guildId },
         select: { userId: true, vrcName: true },
      });
      vrcNameList.forEach((val) => {
         registeredMembers[val.userId] = val.vrcName;
         registeredIds.push(val.userId);
      });
      return { registeredMembers, registeredIds };
   }

   async getFileName(guildId: string) {
      const result = await this.prisma.textLinks.findUnique({
         where: {
            guildId,
         },
         select: { fileName: true },
      });
      if (!result) {
         return null;
      } else {
         return result.fileName;
      }
   }

   async fileNameIsExist(fileName: string) {
      const result = await this.prisma.textLinks.count({
         where: {
            fileName,
         },
      });
      if (result <= 0) {
         return false;
      } else {
         return true;
      }
   }

   async textLinkCreate(guildId: string, guildName: string, fileName: string, textLink: string) {
      const nowJst = getNowJst();
      await this.prisma.textLinks.create({
         data: {
            guildId,
            guildName,
            fileName,
            textLink,
            createDate: nowJst,
            updateDate: '',
         },
      });

      //log
      const data: log.Text = {
         guildName,
         status: 'new: ' + textLink,
         guildId,
         datetime: nowJst,
      };

      log.writeText(data);
   }

   async textLinkUpdate(guildId: string, guildName: string) {
      const nowJst = getNowJst();
      await this.prisma.textLinks.update({
         where: {
            guildId,
         },
         data: {
            updateDate: nowJst,
         },
      });

      //log
      const data: log.Text = {
         guildName,
         status: 'update',
         guildId,
         datetime: nowJst,
      };

      log.writeText(data);
   }

   async getTextLink(guildId: string): Promise<string | null> {
      const result = await this.prisma.textLinks.findUnique({
         where: {
            guildId,
         },
         select: { textLink: true },
      });
      if (!result) {
         return null;
      } else {
         return result.textLink;
      }
   }

   /**
    * Register VRChat name. new or update.
    * @param userId
    * @param userName
    * @returns
    */
   async vrcNameRegister(guildId: string, guildName: string, userId: string, userName: string, registerVrcName: string): Promise<RegisterVrcNameResult> {
      const setting = await this.getSetting(guildId);
      const vrcNameChangeLimitPerDay = setting.vrcNameChangeLimitPerDay;
      return await this.prisma.$transaction(async (tx) => {
         const vrcNameList = await tx.vrcNameList.findUnique({
            where: {
               guildId_userId: { guildId, userId },
            },
            select: { vrcName: true, lastChangeDay: true, changeRemaining: true },
         });
         if (!vrcNameList) {
            // no vrcName. new name.
            return await this.newVrcNameRegister(tx, guildId, guildName, userId, userName, registerVrcName, vrcNameChangeLimitPerDay);
         } else {
            // exist vrcName. change name.
            return await this.changeVrcNameRegister(
               tx,
               guildId,
               guildName,
               userId,
               userName,
               registerVrcName,
               vrcNameList.vrcName,
               vrcNameList.lastChangeDay,
               vrcNameChangeLimitPerDay,
               vrcNameList.changeRemaining
            );
         }
      });
   }

   async newVrcNameRegister(
      tx: Prisma.TransactionClient,
      guildId: string,
      guildName: string,
      userId: string,
      userName: string,
      registerVrcName: string,
      vrcNameChangeLimitPerDay: number
   ): Promise<RegisterVrcNameResult> {
      // no vrc name, new register
      const { nowJst, todayJst } = getNowAndToDayJst();
      let logStatus = '';
      await tx.vrcNameList.create({
         data: {
            guildId,
            guildName,
            userId,
            userName,
            vrcName: registerVrcName,
            changeRemaining: vrcNameChangeLimitPerDay,
            lastChangeDay: todayJst,
         },
      });
      logStatus = 'New register VRChat name ';

      //log
      const data: log.VrcName = {
         guildName,
         userName,
         vrcName: registerVrcName,
         status: logStatus,
         userId,
         changeRemaining: vrcNameChangeLimitPerDay,
         guildId,
         datetime: nowJst,
      };
      log.writeVrcName(data);
      return 'REGISTERED';
   }

   async changeVrcNameRegister(
      tx: Prisma.TransactionClient,
      guildId: string,
      guildName: string,
      userId: string,
      userName: string,
      registerVrcName: string,
      registeredVrcName: string,
      lastChangeDay: string,
      vrcNameChangeLimitPerDay: number,
      nowChangeRemaining: number
   ): Promise<RegisterVrcNameResult> {
      const { nowJst, todayJst } = getNowAndToDayJst();
      let changeRemaining = nowChangeRemaining;
      let logStatus = '';
      //check vrc name and calc change remaining.
      if (registeredVrcName === registerVrcName) {
         return 'SAME_VRC_NAME';
      } else {
         //change vrc name
         if (lastChangeDay === todayJst) {
            logStatus = 'VRChat name is changed';
         } else {
            changeRemaining = vrcNameChangeLimitPerDay; //restrict mode is 0.
            logStatus = 'First change of today';
         }
      }
      if (--changeRemaining < 0) {
         return 'REACH_LIMIT';
      }

      await tx.vrcNameList.update({
         where: {
            guildId_userId: { guildId, userId },
         },
         data: {
            guildId,
            guildName,
            userId,
            userName,
            vrcName: registerVrcName,
            changeRemaining,
            lastChangeDay: todayJst,
         },
      });

      //log
      const data: log.VrcName = {
         guildName,
         userName,
         vrcName: registerVrcName,
         status: logStatus,
         userId,
         changeRemaining,
         guildId,
         datetime: nowJst,
      };
      log.writeVrcName(data);
      return 'CHANGED';
   }

   async checkVrcNameRegistered(guildId: string, userId: string) {
      const vrcNameList = await this.prisma.vrcNameList.findUnique({
         where: {
            guildId_userId: { guildId, userId },
         },
      });
      return !vrcNameList;
   }

   async guildDelete(guildId: string) {
      await this.prisma.$transaction(async (tx) => {
         const nowJst = getNowJst();
         const textLinks = await tx.textLinks.findUnique({
            where: {
               guildId,
            },
            select: { guildName: true },
         });
         if (!textLinks) return;
         await tx.textLinks.delete({
            where: {
               guildId,
            },
         });

         const logStatus = 'bot is left from guild';
         //log
         const data: log.Text = {
            guildName: textLinks.guildName,
            status: logStatus,
            guildId,
            datetime: nowJst,
         };

         log.writeText(data);
      });
   }

   async vrcNameDelete(guildId: string, guildName: string, userId: string, userName: string) {
      await this.prisma.$transaction(async (tx) => {
         const nowJst = getNowJst();
         const vrcNameList = await tx.vrcNameList.findUnique({
            where: {
               guildId_userId: { guildId, userId },
            },
            select: { vrcName: true },
         });
         if (!vrcNameList) return;
         await tx.vrcNameList.delete({
            where: {
               guildId_userId: { guildId, userId },
            },
         });

         const logStatus = 'VRChat name is deleted';
         //log
         const data: log.VrcName = {
            guildName,
            userName,
            vrcName: vrcNameList.vrcName,
            status: logStatus,
            userId,
            changeRemaining: 0,
            guildId,
            datetime: nowJst,
         };

         log.writeVrcName(data);
      });
   }

   async backUpDatabase() {
      const nowJst = getNowJst();
      const originalDbPath = path.join(path.resolve(), 'main.db');
      const buffer = fs.readFileSync(originalDbPath);
      const backUpDbFileName = 'main_bk_' + nowJst + '.db';
      const result = await this.cloudflareBackup.uploadDataBaseBackupDatabase(backUpDbFileName, buffer);

      if (result) {
         // success: clear retry timer
         if (this.dbBackupRetryTimer) {
            clearTimeout(this.dbBackupRetryTimer);
            this.dbBackupRetryTimer = null;
         }
         if (this.dbBackupRetryCount > 0) {
            log.operation.info(`DB backup succeeded after ${this.dbBackupRetryCount} retries`);
         }
         this.dbBackupRetryCount = 0;
      } else {
         // failed: schedule retry
         this.scheduleBackupRetry();
      }

      return;
   }

   private scheduleBackupRetry(): void {
      // already retrying, timer is running
      if (this.dbBackupRetryTimer) return;

      if (this.dbBackupRetryCount >= DB_BACKUP_RETRY_MAX_COUNT) {
         log.operation.error(`DB backup failed after ${DB_BACKUP_RETRY_MAX_COUNT} retries (12 hours). Giving up.`);
         this.dbBackupRetryCount = 0;
         return;
      }

      log.operation.warn(`DB backup failed. Will retry in 10 minutes (attempt ${this.dbBackupRetryCount + 1}/${DB_BACKUP_RETRY_MAX_COUNT})`);

      this.dbBackupRetryTimer = setTimeout(async () => {
         this.dbBackupRetryTimer = null;
         this.dbBackupRetryCount++;
         await this.backUpDatabase();
      }, DB_BACKUP_RETRY_INTERVAL_MS);
   }

   async cleanupTextLinkGuilds(nowGuildIds: string[]) {
      return await this.prisma.$transaction(async (tx) => {
         //get db guilds
         const dbGuildIds: string[] = [];
         const result = await tx.textLinks.findMany({
            select: { guildId: true },
         });
         result.forEach((element) => {
            dbGuildIds.push(element.guildId);
         });
         //delete no exist guilds
         const nonExistGuilds = dbGuildIds.filter((guildId) => !nowGuildIds.includes(guildId));
         const deletes = async () => {
            for (const guildId of nonExistGuilds) {
               await tx.textLinks.deleteMany({
                  where: { guildId },
               });
            }
         };
         await deletes();
         //text link automatically adding. so not create.
      });
   }

   async cleanupVrcNameGuilds(nowGuildIds: string[]) {
      return await this.prisma.$transaction(async (tx) => {
         //get db guilds
         const dbGuildIds: string[] = [];
         const result = await tx.vrcNameList.findMany({
            distinct: ['guildId'],
            select: { guildId: true },
         });
         result.forEach((element) => {
            dbGuildIds.push(element.guildId);
         });
         //delete no exist guilds
         const nonExistGuilds = dbGuildIds.filter((guildId) => !nowGuildIds.includes(guildId));
         const deletes = async () => {
            for (const guildId of nonExistGuilds) {
               await tx.vrcNameList.deleteMany({
                  where: { guildId },
               });
            }
         };
         await deletes();
         //vrcName manually adding. so not create.
      });
   }

   async cleanupSettingGuilds(nowGuildInfos: { [key: string]: string }, defaultSetting: Setting) {
      await this.prisma.$transaction(async (tx) => {
         //get db guilds
         const dbGuildIds: string[] = [];
         const result = await tx.setting.findMany({
            select: { guildId: true },
         });
         result.forEach((element) => {
            dbGuildIds.push(element.guildId);
         });
         //delete no exist guilds
         const nonExistGuilds = dbGuildIds.filter((guildId) => !nowGuildInfos.hasOwnProperty(guildId));
         const deletes = async () => {
            for (const guildId of nonExistGuilds) {
               await tx.setting.deleteMany({
                  where: { guildId },
               });
            }
         };
         await deletes();
         //add settings
         const newGuilds: { [key: string]: string } = {};
         for (const [key, value] of Object.entries(nowGuildInfos)) {
            if (!dbGuildIds.includes(key)) {
               newGuilds[key] = value;
            }
         }
         for (const [key, value] of Object.entries(newGuilds)) {
            if (!dbGuildIds.includes(key)) {
               await tx.setting.create({
                  data: {
                     guildId: key,
                     guildName: value,
                     vrcNameChangeLimitPerDay: defaultSetting.vrcNameChangeLimitPerDay,
                  },
               });
            }
         }
      });
   }

   /**
    * Reset VRChat change limit For channel all users.
    * (The channel is from sending command)
    * If strict mode(limit setting is 0), users get 1 time change limit.
    * @param commanderName
    * @param channelName
    * @param channelId
    * @returns
    */
   async clearVrcNameChangeRemaining(guildId: string, guildName: string, commanderName: string): Promise<CommandResult> {
      const { nowJst, todayJst } = getNowAndToDayJst();
      const setting = await this.getSetting(guildId);
      let remainingSetting = setting.vrcNameChangeLimitPerDay;
      if (remainingSetting === 0) {
         remainingSetting = 1;
      }

      return await this.prisma.$transaction(async (tx) => {
         //up date all users
         const result = await tx.vrcNameList.updateMany({
            data: { changeRemaining: remainingSetting, lastChangeDay: todayJst },
            where: { guildId },
         });

         if (result.count === 0) return 'FAILED: CANT_FIND_TARGET';

         //log
         const data: log.Command = {
            guildName,
            command: 'clear_limit_vrc_name_change',
            commanderName,
            target: 'all members',
            note: '-',
            guildId,
            datetime: nowJst,
         };
         log.writeCommand(data);

         return 'SUCCESS';
      });
   }

   /**
    * Reset VRChat change limit For specific user.
    * (The channel is from sending command)
    * If strict mode(limit setting is 0), user get 1 time change limit.
    * @param targetName
    * @param commanderName
    * @param channelName
    * @param channelId
    * @returns
    */
   async relimitVrcNameChangeRemaining(guildId: string, guildName: string, targetName: string, commanderName: string): Promise<CommandResult> {
      const setting = await this.getSetting(guildId);
      let remainingSetting = setting.vrcNameChangeLimitPerDay;
      if (remainingSetting === 0) {
         remainingSetting = 1;
      }

      return await this.prisma.$transaction(async (tx) => {
         const result = await tx.vrcNameList.updateMany({
            data: { changeRemaining: remainingSetting },
            where: { AND: { userName: targetName, guildId } },
         });
         if (result.count === 0) return 'FAILED: CANT_FIND_TARGET';

         const data: log.Command = {
            guildName,
            command: 'relimit_vrc_name_change',
            commanderName,
            target: targetName,
            note: '-',
            guildId,
            datetime: getNowJst(),
         };
         log.writeCommand(data);

         return 'SUCCESS';
      });
   }

   async createDefaultGuildSettingIfNone(guildId: string, guildName: string, defaultSetting: Setting) {
      await this.prisma.$transaction(async (tx) => {
         const count = await tx.setting.count({
            where: {
               guildId,
            },
         });
         if (count != 0) return; //setting is exist. non create.
         // new setting
         await tx.setting.create({
            data: {
               guildId,
               guildName,
               vrcNameChangeLimitPerDay: defaultSetting.vrcNameChangeLimitPerDay,
            },
         });
      });
   }

   async updateVrcNameChangeLimitPerDay(guildId: string, val: number) {
      await this.prisma.setting.update({
         where: {
            guildId,
         },
         data: { vrcNameChangeLimitPerDay: val },
      });
   }

   async getSetting(guildId: string) {
      const setting = await this.prisma.setting.findUnique({
         where: {
            guildId,
         },
      });
      return setting!;
   }

   async deleteSetting(guildId: string) {
      await this.prisma.setting.delete({
         where: {
            guildId,
         },
      });
   }

   /**
    * logCommand
    * @param command
    * @param commanderName
    * @param guildName
    * @param channelId
    * @param note
    */
   logNonTargetCommand(guildId: string, command: string, commanderName: string, guildName: string, note: string) {
      const data: log.Command = {
         guildName,
         command,
         commanderName,
         target: '-',
         note: note,
         guildId,
         datetime: getNowJst(),
      };
      log.writeCommand(data);
   }
}
