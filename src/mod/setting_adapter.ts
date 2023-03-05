import { Database } from '@/src/mod/database';
import { Setting } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';

/*--------------------------------global settings type (static)---------------------------------------------*/
type GeneralSettings = {
   DATA_UPDATE_CHECK_INTERVAL_SEC: number;
   TOKEN_EXPIRE_PERIOD_SEC: number;
};
type FireBaseSettings = {
   BUCKET_NAME: string;
   FILE_ROOT_PATH: string;
};

type GLOBAL_SETTINGS = {
   GENERAL: GeneralSettings;
   FIREBASE: FireBaseSettings;
};

const jsonPath = path.resolve('settings') + '/setting.json';
const jsonFile = fs.readFileSync(jsonPath, 'utf8').trim();

//read settings from Json file.
export const GLOBAL_SETTING = JSON.parse(jsonFile) as GLOBAL_SETTINGS;

/*--------------------------------guild settings (class instance)---------------------------------------------*/
export type SETTING_RESULT = 'SUCCESS:' | 'FAILED: NO_SETTING_ON_THIS_GUILD' | 'FAILED: VALUE_IS_NOT_A_NUMBER' | 'FAILED: VALUE_RANGE_IS_WRONG (Valid is between 0 to 100)' | 'ERROR'; // use as enum

export class SettingAdapter {
   //result when change settings
   //Default values
   constructor(private db: Database) {
      this.DEFAULT_SETTING = {
         guildId: '',
         guildName: '',
         vrcNameChangeLimitPerDay: 1,
      };
   }

   readonly DEFAULT_SETTING: Setting;
   /*-------------------------set settings functions. Call by bot commands ----------------------------------*/
   async createGuildDefaultSettingIfNone(guildId: string, guildName: string) {
      await this.db.createDefaltGuildSettingIfNone(guildId, guildName, this.DEFAULT_SETTING);
   }

   async setGuildVrcNameChangeLimitPerDay(guildId: string, limit: string): Promise<{ result: SETTING_RESULT; value: number }> {
      const num = parseInt(limit.trim(), 10);
      //validation
      if (Number.isNaN(num)) {
         return { result: 'FAILED: VALUE_IS_NOT_A_NUMBER', value: num };
      }
      //0 (strict mode) to 100
      if (num < 0 || num > 100) {
         return { result: 'FAILED: VALUE_RANGE_IS_WRONG (Valid is between 0 to 100)', value: num };
      }
      await this.db.updateVrcNameChangeLimitPerDay(guildId, num);
      return { result: 'SUCCESS:', value: num };
   }

   async getGuildSettingResult(guildId: string): Promise<{ result: SETTING_RESULT; value: string }> {
      const seting = await this.db.getSetting(guildId);
      if (!seting) {
         return { result: 'FAILED: NO_SETTING_ON_THIS_GUILD', value: '' };
      }
      let settingSt = 'vrc_name_change_limit_per_day: ' + seting.vrcNameChangeLimitPerDay;
      return { result: 'SUCCESS:', value: settingSt };
   }

   async getGuildSetting(guildId: string) {
      const setting = await this.db.getSetting(guildId);
      return setting;
   }

   async deleteGuildSetting(guildId: string) {
      await this.db.deleteSetting(guildId);
   }
}
