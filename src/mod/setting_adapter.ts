import { Database } from '@/src/mod/database';
import { Setting } from '@prisma/client';

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
      await this.db.createDefaultGuildSettingIfNone(guildId, guildName, this.DEFAULT_SETTING);
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
      const setting = await this.db.getSetting(guildId);
      if (!setting) {
         return { result: 'FAILED: NO_SETTING_ON_THIS_GUILD', value: '' };
      }
      let settingSt = 'vrc_name_change_limit_per_day: ' + setting.vrcNameChangeLimitPerDay;
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
