import { Client, SlashCommandBuilder, PermissionFlagsBits, GatewayIntentBits, ChatInputCommandInteraction, Guild, Collection, GuildMember, MessageFlags } from 'discord.js';
import { SettingAdapter } from '@/src/mod/setting_adapter';
import { Database } from '@/src/mod/database';
import * as log from '@/src/mod/logger';
import * as jwt from '@/src/mod/jwt_generate';
import { sha256hashAsync } from '@/src/mod/utility';
import * as crypto from 'node:crypto';
import { getPublicKey } from '@/src/mod/jwt_generate';
import { CloudflareForWorld } from '@/src/mod/cloudflare';
import { env } from '@/src/env';

//types
type GuildsUpdateFlag = { [key: string]: boolean }; //key is guild id
type GuildsRefreshCounter = { [key: string]: number }; //key is guild id

/**
 * data for generate text bytes
 */
type TextDataInfo = {
   validText: boolean;
   data: {
      randomSalt: number;
      botRoleHashes: Buffer[];
      vrcNameHashes: Buffer[];
      memberRoleBitFields: number[];
   };
};

/**
 * discord process class
 * check bot roles, check member roles,
 * manage VRChat names, and so on.
 */
export class DiscordProcess {
   bot: Client;
   guildsUpdateFlag: GuildsUpdateFlag = {};
   guildsRefreshCounter: GuildsRefreshCounter = {};
   guildsLastFetchTime: { [key: string]: number } = {};
   GUILD_MEMBERS_RATE_LIMIT_MS = 30000;
   botUserId: string;
   MAX_BOT_ROLE_NUM = 8;
   MAX_MEMBER_NUM = 3000;
   TOKEN_REFRESH_INTERVAL_COUNT = Math.trunc(env.general.tokenExpirePeriodSec / env.general.dataUpdateCheckIntervalSec / 3 - 1);

   //----------------------constructor. initialize and register events-------------------------
   constructor(
      private db: Database,
      private setting: SettingAdapter,
      private cloudflare: CloudflareForWorld
   ) {
      this.botUserId = '';
      this.bot = new Client({
         intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
      });

      // -----------------------------process when launch bot----------------------
      this.bot.once('clientReady', async () => {
         try {
            if (this.bot.user != null) {
               this.botUserId = this.bot.user.id;
            } else {
               this.endProgramProcess('bot user id is not found.');
            }
            await this.initializeGuildInfo();
            console.log('Logged in as ' + this.bot.user?.tag + ' (ID: ' + this.botUserId + ')');
            //start interval events
            setInterval(async () => {
               await this.textUpdateAllGuildsInterval();
            }, env.general.dataUpdateCheckIntervalSec * 1000);
         } catch (error) {
            console.error('Error during bot initialization:', error);
            log.operation.error('Error during bot initialization: ' + error);
         }
      });

      // -----------------------------when interact command----------------------
      /**
       * Reaction for slash commands by users.
       */
      this.bot.on('interactionCreate', async (interact) => {
         if (interact.isCommand()) {
            const interaction = interact as ChatInputCommandInteraction;
            try {
               let lengthIsOk = false;
               switch (interaction.commandName) {
                  case 'set_vrc_name':
                     const inputVrcName = interaction.options.get('vrc_name')?.value as string;
                     lengthIsOk = await this.checkInputStringLength(interaction, inputVrcName, 50);
                     if (!lengthIsOk) return;
                     await this.setVrcName(interaction, inputVrcName);
                     break;
                  case 'get_vrc_name':
                     await this.getVrcName(interaction);
                     break;
                  case 'get_bot_role':
                     await this.sendBotRole(interaction);
                     break;
                  case 'get_unlock_link':
                     await this.sendTextLink(interaction);
                     break;
                  case 'get_public_key':
                     await this.sendPublicKey(interaction);
                     break;
                  case 'set_vrc_name_change_limit':
                     const limitTimes = interaction.options.get('limit_times')?.value as string;
                     lengthIsOk = await this.checkInputStringLength(interaction, limitTimes, 6);
                     if (!lengthIsOk) return;
                     await this.setVrcNameChangeLimitPerDay(interaction, limitTimes);
                     break;
                  case 'get_setting':
                     await this.getSettings(interaction);
                     break;
                  case 'relimit_vrc_name_change':
                     const inputUserName = interaction.options.get('user_name')?.value as string;
                     lengthIsOk = await this.checkInputStringLength(interaction, inputUserName, 64);
                     if (!lengthIsOk) return;
                     await this.relimitVrcNameChangeRemaining(interaction, inputUserName);
                     break;
                  case 'clear_limit_vrc_name_change':
                     await this.clearVrcNameChangeRemaining(interaction);
                     break;
                  case 'get_vrc_name_log':
                     await this.sendVrcNameLog(interaction);
                     break;
               }
            } catch (error) {
               console.error('Error handling command:', error);
               log.operation.error('Error handling command ' + interaction.commandName + ': ' + error);
               if (!interaction.replied && !interaction.deferred) {
                  await interaction.reply({ content: 'An error occurred while processing your command.', flags: MessageFlags.Ephemeral });
               }
            }
         }
      });

      // -----------------------------events ----------------------------------
      //when bot is added to the guild.
      this.bot.on('guildCreate', async (guild) => {
         try {
            console.log('guildCreate');
            const guildId = guild.id;
            this.setUpdateFlag(guild.id, true);
            //clean up databases.
            await this.databaseCleanUp();
            log.openCsvLogStream(guildId);
         } catch (error) {
            console.error('Error handling guildCreate:', error);
            log.operation.error('Error handling guildCreate: ' + error);
         }
      });

      //when bot is leave the guild.
      this.bot.on('guildDelete', async (guild) => {
         try {
            console.log('guildDelete');
            const guildId = guild.id;
            //clean up databases.
            await this.databaseCleanUp();
            if (!this.guildsUpdateFlag.hasOwnProperty(guildId)) delete this.guildsUpdateFlag[guild.id];
            log.closeCsvLogStream(guildId);
         } catch (error) {
            console.error('Error handling guildDelete:', error);
            log.operation.error('Error handling guildDelete: ' + error);
         }
      });

      // member is leave the guild
      this.bot.on('guildMemberRemove', async (member) => {
         try {
            console.log('guildMemberRemove');
            const guildId = member.guild.id;
            const guildName = member.guild.name;
            const userId = member.id;
            const userName = member.user.tag;
            const update = await this.checkUpdateFlagWhenMemberIsLeave(guildId, userId);
            this.setUpdateFlag(guildId, update);
            //delete user from db if exist
            await this.db.vrcNameDelete(guildId, guildName, userId, userName);
         } catch (error) {
            console.error('Error handling guildMemberRemove:', error);
            log.operation.error('Error handling guildMemberRemove: ' + error);
         }
      });

      //role is update (role name)
      this.bot.on('roleUpdate', async (oldRole, newRole) => {
         try {
            const guildId = newRole.guild.id;
            console.log('roleUpdate');
            const botRoleNames = this.getMemberAttachedRoleNames(guildId, this.botUserId);
            const update = botRoleNames.includes(oldRole.name); //old name is in bot roles
            this.setUpdateFlag(guildId, update);
         } catch (error) {
            console.error('Error handling roleUpdate:', error);
            log.operation.error('Error handling roleUpdate: ' + error);
         }
      });

      //member role is update (role name)
      this.bot.on('guildMemberUpdate', async (oldMember, newMember) => {
         try {
            console.log('guildMemberUpdate');
            //console.log('guildMemberUpdate');
            const guildId = newMember.guild.id;
            // If the role(s) are present on the old member object but no longer on the new one (i.e role(s) were removed)
            const removedRoles = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id));
            let removedRoleNames: string[] = [];
            removedRoles.forEach((role) => removedRoleNames.push(role.name));
            // If the role(s) are present on the new member object but are not on the old one (i.e role(s) were added)
            const addedRoles = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
            let addedRoleNames: string[] = [];
            addedRoles.forEach((role) => addedRoleNames.push(role.name));

            //any role add,delete
            if (removedRoleNames.length > 0 || addedRoleNames.length > 0) {
               const userId = newMember.id;
               if (userId === this.botUserId) {
                  this.setUpdateFlag(guildId, true);
                  //console.log('botRoleUpdate');
               } else {
                  const update = await this.checkUpdateFlagWhenRoleChange(guildId, userId, removedRoleNames, addedRoleNames);
                  this.setUpdateFlag(guildId, update);
                  //console.log('memberRoleUpdate');
               }
            }
         } catch (error) {
            console.error('Error handling guildMemberUpdate:', error);
            log.operation.error('Error handling guildMemberUpdate: ' + error);
         }
      });
   }

   checkTokenRefresh(guildId: string, updateFlag: boolean) {
      if (!this.guildsRefreshCounter.hasOwnProperty(guildId)) {
         this.guildsRefreshCounter[guildId] = 0;
         return updateFlag;
      } else {
         //counter update
         const tokenExpireRefresh = this.guildsRefreshCounter[guildId]++ > this.TOKEN_REFRESH_INTERVAL_COUNT;
         if (tokenExpireRefresh) {
            console.log('tokenExpireRefresh: ' + guildId);
         }
         if (updateFlag || tokenExpireRefresh) {
            //refresh
            this.guildsRefreshCounter[guildId] = 0;
            return true;
         } else {
            return false;
         }
      }
   }

   //----------------------initialize functions-------------------------

   /**
    * Fetch guild members with rate limit protection.
    * Discord limits REQUEST_GUILD_MEMBERS to once per 30 seconds per guild.
    */
   async safeFetchMembers(guild: Guild): Promise<boolean> {
      const now = Date.now();
      const lastFetch = this.guildsLastFetchTime[guild.id] || 0;
      if (now - lastFetch < this.GUILD_MEMBERS_RATE_LIMIT_MS) {
         console.log(`Skip fetch for ${guild.name}, rate limit cool down`);
         return false;
      }
      await guild.members.fetch();
      this.guildsLastFetchTime[guild.id] = now;
      return true;
   }

   /**
    * when launch bot.
    * Gather all guilds information to bot cache
    */
   async initializeGuildInfo() {
      await this.setCommands();
      //clean up databases.
      await this.databaseCleanUp();

      //get all guild info in bot
      const guilds = this.bot.guilds.cache;
      const setups = async () => {
         for (const [, guild] of guilds) {
            //console.log('guild names: ' + guild.name);
            const guildId = guild.id;
            await this.safeFetchMembers(guild);
            this.setUpdateFlag(guildId, true); //when launch, update text.
            log.openCsvLogStream(guildId); //open or create csv log files.
         }
      };
      await setups();
   }

   //------------------interval text update functions-------------------
   /**
    * when guild flag is true,
    * update text by bot and members information.
    * @param guild
    * @returns
    */
   async textUpdateGuild(guild: Guild) {
      const guildId = guild.id;
      const guildName = guild.name;
      //flag check and initialize.
      if (!this.guildsUpdateFlag.hasOwnProperty(guildId)) return; //no flag
      const update = this.checkTokenRefresh(guildId, this.guildsUpdateFlag[guildId]);
      if (!update) return; //no update
      //update is true.
      await this.safeFetchMembers(guild); //get members information
      this.guildsUpdateFlag[guildId] = false; //force false;
      console.log('updateTextGuildStart: ' + guildName);
      const startTime = performance.now(); // start stop watch
      const textDataInfo = await this.getTextInformation(guild);
      console.log(textDataInfo);
      let textBytes = this.makeTextBytes(textDataInfo);

      if (!textBytes) {
         textBytes = crypto.randomBytes(8); //if void , padding with random
      }

      //get hash and token
      const hashData = await sha256hashAsync(textBytes);
      console.log('hash: ' + hashData.toString('hex'));
      const token = jwt.getJwtToken(hashData.toString('hex'), env.general.tokenExpirePeriodSec);

      //convert base64
      const buffer = Buffer.from(textBytes);
      const base64 = buffer.toString('base64');

      //combine data
      const dataWithToken = base64 + '&' + token;

      //upload base64 text to github
      const uploadResult = await this.cloudflare.uploadWorldToken(guildId, guildName, dataWithToken);

      // end
      const endTime = performance.now(); // stop stop watch
      console.log('updateTextGuildEnd: ' + guildName);
      console.log('updateTime: ' + (endTime - startTime) + '[msec]'); // display process time
      if (!uploadResult) {
         //next period retry upload
         this.guildsUpdateFlag[guildId] = true;
      }
   }

   /**
    *
    * @param textDataInfo make text byte array from information
    * @returns
    */
   makeTextBytes(textDataInfo: TextDataInfo): Uint8Array | null {
      //-------------------------data prepare----------------------------
      if (!textDataInfo.validText) return null; //no valid text. all 0 (blank).
      //valid text.
      const randomSalt = textDataInfo.data.randomSalt;
      const vrcNameHashes = textDataInfo.data.vrcNameHashes;
      const botRoleHashes = textDataInfo.data.botRoleHashes;
      const memberRoleBitFields = textDataInfo.data.memberRoleBitFields;

      const randomSaltBytes = new Uint8Array(4); //uint to byte array
      for (let i = 0; i < randomSaltBytes.length; i++) {
         randomSaltBytes[i] = (randomSalt >> (8 * i)) & 0xff;
      } //little endian.

      const roleNum = botRoleHashes.length; //max 8
      const memberNum = vrcNameHashes.length; //max 5000
      const memberNumBytes = new Uint8Array([memberNum & 0xff, (memberNum >> 8) & 0xff]); //little endian
      const HASH_LENGTH = 32; //RSA256 hash byte length.
      let index = 0;
      //-------------------------make data----------------------------
      const tempBuff = new Uint8Array(200000); //200k Bytes for temp

      //-------------------------make header----------------------------
      tempBuff[index++] = randomSaltBytes[0]; //random salt
      tempBuff[index++] = randomSaltBytes[1];
      tempBuff[index++] = randomSaltBytes[2];
      tempBuff[index++] = randomSaltBytes[3];
      tempBuff[index++] = roleNum; // role number
      tempBuff[index++] = memberNumBytes[0]; //member num
      tempBuff[index++] = memberNumBytes[1];

      //-------------------------make role hashes----------------------------
      for (let i = 0; i < roleNum; i++) {
         tempBuff.set(botRoleHashes[i], index); // copy src bytes with offset dst index.
         index += HASH_LENGTH;
      }
      //-------------------------make vrc name hashes----------------------------
      for (let i = 0; i < memberNum; i++) {
         tempBuff.set(vrcNameHashes[i], index); // copy src bytes with offset dst index.
         index += HASH_LENGTH;
      }
      //-------------------------make bit fields----------------------------
      for (let i = 0; i < memberNum; i++) {
         tempBuff[index++] = memberRoleBitFields[i]; //bitfield is 1 byte.
      }
      //------------------------make result------------------------
      const resultBuff = tempBuff.slice(0, index);
      return resultBuff;
   }

   /**
    * make text information of guild from bot cache.
    * @param guild
    * @returns
    */
   async getTextInformation(guild: Guild): Promise<TextDataInfo> {
      const textDataInfo: TextDataInfo = {
         validText: false,
         data: {
            randomSalt: 0,
            botRoleHashes: [],
            vrcNameHashes: [],
            memberRoleBitFields: [],
         },
      };
      const guildId = guild.id;
      //get bot roles
      const botRoleNames = this.getMemberAttachedRoleNames(guildId, this.botUserId);
      if (botRoleNames.length == 0 || botRoleNames.length > this.MAX_BOT_ROLE_NUM) {
         const message = guild.name + ': no or over bot role num';
         console.log(message);
         return textDataInfo;
      }

      //get vrc name registered users
      //key is userId, value is hashVrcName
      const { registeredMembers, registeredIds } = await this.db.getAllMembersVrcName(guildId);
      if (registeredIds.length == 0 || registeredIds.length > this.MAX_MEMBER_NUM) {
         const message = guild.name + ': no or over vrc name register user.';
         console.log(message);
         return textDataInfo;
      }

      //extract users who bot role and VRC name with bitfield.
      const { userIds, roleBitFields } = this.extractTargetMembers(guildId, guild.members.cache, botRoleNames, registeredIds);
      if (userIds.length == 0) {
         const message = guild.name + ': no target member.';
         console.log(message);
         return textDataInfo;
      }

      //get randomSalt
      const randomSalt = crypto.randomBytes(4).readUInt32BE(0);
      const randomSaltString = randomSalt.toString();

      //get valid role Hashes
      const vrcNameHashes = await this.getTargetVrcNameHashes(userIds, registeredMembers, randomSaltString);

      //get role Hashes
      const roleHashes = await this.getBotRoleHashes(botRoleNames, randomSaltString);

      textDataInfo.validText = true;
      textDataInfo.data = {
         randomSalt,
         botRoleHashes: roleHashes,
         vrcNameHashes: vrcNameHashes,
         memberRoleBitFields: roleBitFields,
      };
      return textDataInfo;
   }

   /**
    * get member information who have registered VRChat name and have any bot roles.
    * @param guildId
    * @param guildMembers
    * @param botRoleNames
    * @param registeredIds
    * @returns
    */
   extractTargetMembers(guildId: string, guildMembers: Collection<string, GuildMember>, botRoleNames: string[], registeredIds: string[]): { userIds: string[]; roleBitFields: number[] } {
      const userIds: string[] = [];
      const roleBitFields: number[] = [];
      const registeredIdSet = new Set(registeredIds);

      guildMembers.forEach((member) => {
         const userId = member.id;
         const memberRoleNames = this.getMemberAttachedRoleNames(guildId, member.id);
         const roleBitField = this.getRoleBitField(botRoleNames, memberRoleNames);
         // member registered vrcName and have bot roles.
         if (registeredIdSet.has(userId) && roleBitField != 0) {
            userIds.push(userId);
            roleBitFields.push(roleBitField);
         }
      });
      return { userIds, roleBitFields };
   }

   /**
    * get all registered VRChat hash by userIds.
    * @param userIds
    * @param registeredMembers
    * @returns
    */
   async getTargetVrcNameHashes(userIds: string[], registeredMembers: { [key: string]: string }, randomSaltString: string) {
      const vrcNameHashes = await Promise.all(
         userIds.map(async (userId) => {
            return await sha256hashAsync(randomSaltString + registeredMembers[userId]);
         })
      );
      return vrcNameHashes;
   }

   /**
    * bit field represent user role position of bot roles.
    * @param botRoleNames
    * @param memberRoleNames
    * @returns
    */
   getRoleBitField(botRoleNames: string[], memberRoleNames: string[]) {
      let bitField: number = 0;
      const memberRoleSet = new Set(memberRoleNames);
      for (let i = 0; i < botRoleNames.length; i++) {
         if (memberRoleSet.has(botRoleNames[i])) {
            bitField |= 1 << i;
         }
      }
      return bitField;
   }

   /**
    * convert bot all roles to hash
    * @param botRoleNames
    * @returns
    */
   async getBotRoleHashes(botRoleNames: string[], randomSaltString: string) {
      const botRoleHashes = await Promise.all(
         botRoleNames.map(async (name) => {
            return await sha256hashAsync(randomSaltString + name);
         })
      );
      return botRoleHashes;
   }

   /**
    * Do interval. all guild text update.(if update flag is true)
    */
   async textUpdateAllGuildsInterval() {
      console.log('Start all guild text update check');
      const guilds = this.bot.guilds.cache;
      const guildsTextUpdate = async () => {
         for (const [, guild] of guilds) {
            await this.textUpdateGuild(guild);
         }
      };
      await guildsTextUpdate();
      console.log('End all guild text update');
   }

   //----------------------update flag functions-------------------------
   setUpdateFlag(guildId: string, update: boolean) {
      if (!this.guildsUpdateFlag.hasOwnProperty(guildId)) {
         this.guildsUpdateFlag[guildId] = update;
         if (update) {
            console.log('update flag is true. guild id :' + guildId);
         }
         return;
      }
      //exist flag
      if (update) {
         this.guildsUpdateFlag[guildId] = true;
         console.log('update flag is true');
      }
   }

   getIsDuplicate(arr1: string[], arr2: string[]) {
      return [...arr1, ...arr2].filter((item) => arr1.includes(item) && arr2.includes(item)).length > 0;
   }

   async checkUpdateFlagWhenMemberIsLeave(guildId: string, userId: string) {
      const vrcNameHash = await this.db.getVrcName(guildId, userId);
      if (!vrcNameHash) {
         return false; //no name.
      }
      const leaveMemberNames = this.getMemberAttachedRoleNames(guildId, userId);
      const botRoleNames = this.getMemberAttachedRoleNames(guildId, this.botUserId);
      return this.getIsDuplicate(leaveMemberNames, botRoleNames);
   }

   /**
    *
    * @param guildId check if member change is effect update flag.
    * @param user_id
    * @returns
    */
   async checkUpdateFlagWhenRoleChange(guildId: string, userId: string, removedRoleNames: string[], addedRoleNames: string[]): Promise<boolean> {
      //name check
      let vrcNameIsExist = false;
      const vrcNameHash = await this.db.getVrcName(guildId, userId);
      if (vrcNameHash) {
         vrcNameIsExist = true;
      } else {
         return false; //no name.
      }

      //role check
      let roleNameIsChanged = false;

      const botRoleNames = this.getMemberAttachedRoleNames(guildId, this.botUserId);
      if (botRoleNames.length == 0) {
         return false; //no bot roles
      }

      //botRoleNames is exist
      if (removedRoleNames.length > 0) {
         roleNameIsChanged = this.getIsDuplicate(removedRoleNames, botRoleNames);
      }
      if (addedRoleNames.length > 0) {
         roleNameIsChanged = this.getIsDuplicate(addedRoleNames, botRoleNames);
      }

      if (vrcNameIsExist && roleNameIsChanged) {
         return true;
      }

      return false;
   }

   checkUpdateFlagWhenVrcNameChange(guildId: string, userId: string) {
      //role check
      let roleNameIsExistInBot = false;
      const botRoleNames = this.getMemberAttachedRoleNames(guildId, this.botUserId);
      const memberRoleNames = this.getMemberAttachedRoleNames(guildId, userId);
      if (botRoleNames.length == 0 || memberRoleNames.length == 0) {
         return false; //no roles
      }
      roleNameIsExistInBot = this.getIsDuplicate(botRoleNames, memberRoleNames);

      return roleNameIsExistInBot;
   }

   getMemberAttachedRoleNames(guildId: string, user_id: string) {
      const guild = this.bot.guilds.cache.get(guildId);
      const self = guild?.members.cache.find((mem) => mem.id == user_id);
      const roles = self?.roles.cache.filter((role) => !role.tags?.hasOwnProperty('botId') && role.name !== '@everyone');
      let names: string[] = [];
      roles?.forEach((role) => names.push(role.name));
      const uniqueNames = Array.from(new Set(names)); //delete duplicate role names.
      return uniqueNames;
   }

   //----------------------database functions-------------------------
   async databaseCleanUp() {
      //get now real guilds
      const guildInfos: { [key: string]: string } = {}; //key is guild id
      const guildIds: string[] = []; //key is guild id

      this.bot?.guilds?.cache?.forEach((guild) => {
         guildInfos[guild.id] = guild.name;
         guildIds.push(guild.id);
      });
      if (Object.keys(guildInfos).length > 0) {
         //text database
         await this.db.cleanupTextLinkGuilds(guildIds);
         //setting database
         await this.db.cleanupSettingGuilds(guildInfos, this.setting.DEFAULT_SETTING);
         //vrcName database
         await this.db.cleanupVrcNameGuilds(guildIds);
      }
   }

   //----------------------define program start and end functions-------------------------

   start() {
      //bot start
      this.bot.login(env.discord.token);
   }

   endProgramProcess(endMessage: any) {
      console.log('end program process:');
      log.operation.info(endMessage);
      console.log(endMessage);
      log.shutdownAfterLogFlush();
   }
   //----------------------Command create functions-------------------------
   /**
    * Set slash command for discord
    */
   private async setCommands() {
      await this.bot.application?.commands.set([
         //all members commands
         new SlashCommandBuilder()
            .setName('set_vrc_name')
            .setDescription('Set or Change your VRChat Display name.')
            .addStringOption((option) => option.setName('vrc_name').setDescription('Your VRChat display name').setRequired(true)),
         new SlashCommandBuilder().setName('get_vrc_name').setDescription('Get your VRChat Display name.'),
         //administrator commands
         new SlashCommandBuilder().setName('get_bot_role').setDescription('Get role name, used to pass').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
         new SlashCommandBuilder().setName('get_unlock_link').setDescription('Get unlock link URL for world gimmick').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
         new SlashCommandBuilder().setName('get_public_key').setDescription('Get public key for world gimmick').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
         new SlashCommandBuilder()
            .setName('set_vrc_name_change_limit')
            .setDescription('Set limit times that changing VRChat Display name per day.')
            .addStringOption((option) => option.setName('limit_times').setDescription('Change limit times').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
         new SlashCommandBuilder()
            .setName('relimit_vrc_name_change')
            .setDescription('Reset limit that changing VRChat Display name per day by user name.')
            .addStringOption((option) => option.setName('user_name').setDescription('User name with #number').setRequired(true))
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
         new SlashCommandBuilder()
            .setName('clear_limit_vrc_name_change')
            .setDescription('Reset limit that changing VRChat Display name per day to all member.')
            .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
         new SlashCommandBuilder().setName('get_setting').setDescription('Get setting of this bot where this guild.').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
         new SlashCommandBuilder().setName('get_vrc_name_log').setDescription('Get member registration history of VRChat name').setDefaultMemberPermissions(PermissionFlagsBits.Administrator),
      ]);
   }
   //----------------------Command process functions-------------------------

   /**
    * Check if the interaction is in a guild context and return guild info.
    * Returns null and replies with error if not in a guild.
    */
   private async checkGuildContext(interaction: ChatInputCommandInteraction): Promise<{ guildId: string; guildName: string } | null> {
      if (!interaction.guildId || !interaction.guild) {
         await interaction.reply({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
         return null;
      }
      return { guildId: interaction.guildId, guildName: interaction.guild.name };
   }

   /**
    * Check if the interaction is in a guild context (for deferred replies).
    * Returns null and follows up with error if not in a guild.
    */
   private async checkGuildContextDeferred(interaction: ChatInputCommandInteraction): Promise<{ guildId: string; guildName: string } | null> {
      if (!interaction.guildId || !interaction.guild) {
         await interaction.followUp({ content: 'This command can only be used in a server.', flags: MessageFlags.Ephemeral });
         return null;
      }
      return { guildId: interaction.guildId, guildName: interaction.guild.name };
   }

   async checkInputStringLength(interaction: ChatInputCommandInteraction, input: string, limit: number): Promise<boolean> {
      if (input.length > limit) {
         await interaction.reply({ content: 'Your input is too long.', flags: MessageFlags.Ephemeral });
         return false;
      }
      return true;
   }

   async setVrcName(interaction: ChatInputCommandInteraction, inputVrcName: string) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const ctx = await this.checkGuildContextDeferred(interaction);
      if (!ctx) return;
      const { guildId, guildName } = ctx;
      const userId = interaction.user.id;
      const userName = interaction.user.tag;
      const inputVrcNameTrimmed = inputVrcName.trim();
      const length = inputVrcNameTrimmed.length;
      //check vrc name length
      if (length < 1) {
         await interaction.followUp({ content: '**Registration failed**\nYour display name is too short.(available 1 to 37 characters)', flags: MessageFlags.Ephemeral });
         return;
      }
      if (length > 37) {
         await interaction.followUp({ content: '**Registration failed**\nYour display name is too long.(available 1 to 37 characters)', flags: MessageFlags.Ephemeral });
         return;
      }
      const result = await this.db.vrcNameRegister(guildId, guildName, userId, userName, inputVrcNameTrimmed);
      const setting = await this.setting.getGuildSetting(guildId);
      const vrcNameChangeLimitPerDay = setting.vrcNameChangeLimitPerDay;
      const discordDisplayVrcName = this.replaceDecorativeCharactersToSymbol(inputVrcNameTrimmed);

      //reply
      let msg = '';
      switch (result) {
         case 'REGISTERED':
            msg = 'Thank you! I registered to "' + discordDisplayVrcName + '" as your VRChat display name.';
            if (vrcNameChangeLimitPerDay > 0) {
               msg += '\n(You can change your display name until ' + vrcNameChangeLimitPerDay + ' times per day)';
            }
            break;
         case 'CHANGED':
            msg = 'Thank you! I changed to "' + discordDisplayVrcName + '" as your display name.';
            if (vrcNameChangeLimitPerDay > 0) {
               msg += '\n(You can change your display name until ' + vrcNameChangeLimitPerDay + ' times per day)';
            }
            break;
         case 'REACH_LIMIT':
            msg = '**Registration failed**\n';
            if (vrcNameChangeLimitPerDay > 0) {
               msg += 'You have exceeded the limit of ' + vrcNameChangeLimitPerDay + ' times display name changing per day.\n **Please wait until next day** (Japan Standard Time).';
            } else {
               msg += "You can't change registered name.\nBecause bot is set as restricted mode.\nIf you really want to change it, please try to ask bot administrator.";
            }
            break;
         case 'SAME_VRC_NAME':
            msg = '**Registration failed**\n"' + discordDisplayVrcName + '" is same of registered.';
            break;
         case 'ERROR': //unknown error
            msg = '**Registration failed**\nUnknown error.';
            break;
      }
      await interaction.followUp({ content: msg, flags: MessageFlags.Ephemeral });
      if (result == 'REGISTERED' || result == 'CHANGED') {
         //vrc name registered. check update flag.
         const update = this.checkUpdateFlagWhenVrcNameChange(guildId, userId);
         this.setUpdateFlag(guildId, update);
      }
   }

   async getVrcName(interaction: ChatInputCommandInteraction) {
      const ctx = await this.checkGuildContext(interaction);
      if (!ctx) return;
      const { guildId } = ctx;
      const userId = interaction.user.id;
      const vrcName = await this.db.getVrcName(guildId, userId);
      if (vrcName) {
         const discordDisplayVrcName = this.replaceDecorativeCharactersToSymbol(vrcName);
         await interaction.reply({ content: 'Your VRChat name is: "' + discordDisplayVrcName + '"', flags: MessageFlags.Ephemeral });
      } else {
         await interaction.reply({ content: 'You are not registered yet.\nPlease command "set_vrc_name" to register.', flags: MessageFlags.Ephemeral });
      }
   }

   //Replace Discord's decorative characters with real symbols
   private replaceDecorativeCharactersToSymbol(input: string): string {
      return input.replaceAll(`_`, '\\_').replaceAll(`*`, '\\*').replaceAll(`#`, '\\#').replaceAll(`-`, '\\-').replaceAll(`~`, '\\~').replaceAll(`\``, '\\\`').replaceAll(`|`, '\\|');
   }

   async sendVrcNameLog(interaction: ChatInputCommandInteraction) {
      const ctx = await this.checkGuildContext(interaction);
      if (!ctx) return;
      const { guildId, guildName } = ctx;
      const userName = interaction.user.tag;

      const logPath = log.getVrcNameLogPath(guildId);
      await interaction.reply({ content: 'This is VRChat name log of your guild.', files: [logPath], flags: MessageFlags.Ephemeral });
      this.db.logNonTargetCommand(guildId, 'get_vrc_name_log', userName, guildName, '-');
   }

   async sendBotRole(interaction: ChatInputCommandInteraction) {
      const ctx = await this.checkGuildContext(interaction);
      if (!ctx) return;
      const { guildId } = ctx;
      const roleNames = this.getMemberAttachedRoleNames(guildId, this.botUserId);
      if (roleNames.length == 0) {
         await interaction.reply({ content: 'None: Bot have not attached role.', flags: MessageFlags.Ephemeral });
      } else if (roleNames.length > this.MAX_BOT_ROLE_NUM) {
         await interaction.reply({ content: 'Failed: Bot have too many role. Limit is ' + this.MAX_BOT_ROLE_NUM + '.', flags: MessageFlags.Ephemeral });
      } else {
         const names = roleNames.join('\n');
         await interaction.reply({ content: 'Bot have ' + roleNames.length + ' roles:\n' + names, flags: MessageFlags.Ephemeral });
      }
   }

   async sendTextLink(interaction: ChatInputCommandInteraction) {
      const ctx = await this.checkGuildContext(interaction);
      if (!ctx) return;
      const { guildId } = ctx;
      const textLink = await this.db.getTextLink(guildId);
      if (textLink) {
         await interaction.reply({ content: '<' + textLink + '>', flags: MessageFlags.Ephemeral });
      } else {
         await interaction.reply({ content: 'Failed: Still generating URL.\nPlease wait 3 minutes', flags: MessageFlags.Ephemeral });
      }
   }

   async sendPublicKey(interaction: ChatInputCommandInteraction) {
      const publicKey = getPublicKey();
      await interaction.reply({ content: publicKey, flags: MessageFlags.Ephemeral });
   }

   async setVrcNameChangeLimitPerDay(interaction: ChatInputCommandInteraction, limit: string) {
      const ctx = await this.checkGuildContext(interaction);
      if (!ctx) return;
      const { guildId, guildName } = ctx;
      const userName = interaction.user.tag;

      const { result, value } = await this.setting.setGuildVrcNameChangeLimitPerDay(guildId, limit);
      if (result === 'SUCCESS:') {
         await this.db.clearVrcNameChangeRemaining(guildId, guildName, userName);
         this.db.logNonTargetCommand(guildId, 'set_vrc_name_change_limit', userName, guildName, value.toString());
      }
      await this.replyInteraction(interaction, result, value.toString());
   }

   async getSettings(interaction: ChatInputCommandInteraction) {
      const ctx = await this.checkGuildContext(interaction);
      if (!ctx) return;
      const { guildId } = ctx;
      const { result, value } = await this.setting.getGuildSettingResult(guildId);
      if (result === 'SUCCESS:') {
         await interaction.reply({ content: 'Setting of this guild:\n' + value, flags: MessageFlags.Ephemeral });
      }
   }

   async relimitVrcNameChangeRemaining(interaction: ChatInputCommandInteraction, inputUserName: string) {
      const ctx = await this.checkGuildContext(interaction);
      if (!ctx) return;
      const { guildId, guildName } = ctx;
      const userName = interaction.user.tag;
      const result = await this.db.relimitVrcNameChangeRemaining(guildId, guildName, inputUserName, userName);
      await this.replyInteraction(interaction, result);
   }

   async clearVrcNameChangeRemaining(interaction: ChatInputCommandInteraction) {
      const ctx = await this.checkGuildContext(interaction);
      if (!ctx) return;
      const { guildId, guildName } = ctx;
      const userName = interaction.user.tag;
      const result = await this.db.clearVrcNameChangeRemaining(guildId, guildName, userName);
      await this.replyInteraction(interaction, result);
   }

   async replyInteraction(interaction: ChatInputCommandInteraction, result: string, value: string = '') {
      let suffix = '';
      if (result === 'SUCCESS:') {
         suffix = ' set: ' + value;
      }
      await interaction.reply({ content: result + suffix, flags: MessageFlags.Ephemeral });
   }
}
