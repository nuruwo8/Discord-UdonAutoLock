import * as readline from 'node:readline';
import { PrismaClient } from '@prisma/client';
import { operation, shutdownAfterLogFlush, logProcessEnd } from '@/src/mod/logger';
import { Database } from '@/src/mod/database';
import { DiscordProcess } from '@/src/mod/discord_process';
import { SettingAdapter } from '@/src/mod/setting_adapter';
import * as cron from 'node-cron';
import { CloudflareForWorld } from '@/src/mod/cloudflare';
import { getBackupCronExpr } from '@/src/mod/utility';

//----------------------    run   -------------------------
(async () => {
   let prisma: PrismaClient;

   //uncaught root exception
   process.on('uncaughtException', async (err) => {
      if (err.name.startsWith('DiscordAPIError[50013]')) {
         //discord permission error. but not fatal error.
         const msg = err.name + ' Missing Permissions.';
         console.warn(err);
         operation.warn(msg);
         return; // back to process.
      }
      if (err.name.startsWith('DiscordAPIError')) {
         //something discord error. It is not regarded fatal.
         console.warn(err);
         operation.warn(err);
         return; // back to process.
      }

      //fatal error.
      console.error(err, 'Uncaught Exception thrown');
      operation.fatal(err);
      await prisma?.$disconnect();
      shutdownAfterLogFlush();
   });

   //call when process end (after process.exit()) in this function , not run asyncfunction.
   process.on('exit', function (code) {
      logProcessEnd();
      const exitCodeMessage = 'About to exit with code:' + code;
      console.log(exitCodeMessage);
   });

   // for catch ctrl+c exit
   if (process.platform === 'win32') {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.on('SIGINT', function () {
         process.emit('SIGINT');
      });
   }

   process.on('SIGINT', async function () {
      await prisma?.$disconnect();
      discordProcess.endProgramProcess('process exit by detect ctrl + c.');
   });

   //make exists guild logger
   operation.info('launch program');
   prisma = new PrismaClient();

   //connect db
   const db = new Database(prisma);
   const settingAdapter = new SettingAdapter(db);

   //get cloudflare
   const cloudflare = new CloudflareForWorld(db);

   //set discord and set interval
   const discordProcess = new DiscordProcess(db, settingAdapter, cloudflare);

   //backup database periodically
   cron.schedule(getBackupCronExpr(), async () => await db.backUpDatabase());

   //db back up when launch
   await db.backUpDatabase();

   //bot start
   discordProcess.start();
})();
