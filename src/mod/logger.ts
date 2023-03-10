import * as Log4js from 'log4js';
import * as csv from 'csv-stringify/sync';
import * as fs from 'node:fs';
import * as path from 'node:path';

//----------------------opration rogger-----------------------

const operationLogPath = path.resolve('logs');
const operationLogFileName = operationLogPath + '/operation_log.txt';

Log4js.configure({
   appenders: {
      operationLog: { type: 'file', filename: operationLogFileName, layout: { type: 'pattern', pattern: '[%d] [%p] - %m' } },
   },
   categories: {
      default: { appenders: ['operationLog'], level: 'info' },
   },
});

export const operation = Log4js.getLogger('operationLog');

//----------------------csv logger------------------

//log data types
export type Command = {
   guildName: string;
   command: string;
   commanderName: string;
   target: string;
   note: string;
   guildId: string;
   datetime: string;
};
const commandLogHeader = '\ufeff' + 'guild_name,command,commander_name,target,note,guild_id,datetime\r\n'; //"\ufeff" is BOM

export type VrcName = {
   guildName: string;
   userName: string;
   vrcName: string;
   status: string;
   userId: string;
   changeRemaining: Number;
   guildId: string;
   datetime: string;
};
const vrcNameLogHeader = '\ufeff' + 'guild_name,user_name,vrc_name,status,user_id,change_remaining,guild_id,datetime\r\n'; //"\ufeff" is BOM

export type Text = {
   guildName: string;
   status: string;
   guildId: string;
   datetime: string;
};
const textLogHeader = '\ufeff' + 'guild_name,status,guild_id,datetime\r\n'; //"\ufeff" is BOM

type LogStream = { [key: string]: fs.WriteStream };
const commandLog: LogStream = {};
const vrcNameLog: LogStream = {};
const textLog: LogStream = {};
let logGuilds: string[] = [];

/**
 * create new folders and files(if not exists). for each channels
 * @param channelId
 */
function makeChannelLogPathAndFiles(guildId: string) {
   const logsFilePath = path.resolve('logs');
   if (!fs.existsSync(logsFilePath)) {
      fs.mkdirSync(logsFilePath);
   }
   const guildPath = path.resolve('logs', 'guilds');
   if (!fs.existsSync(guildPath)) {
      fs.mkdirSync(guildPath);
   }
   const commandPath = path.resolve('logs', 'guilds', guildId);
   if (!fs.existsSync(commandPath)) {
      fs.mkdirSync(commandPath);
   }
   const commandFilePath = getCommandLogPath(guildId);
   if (!fs.existsSync(commandFilePath)) {
      fs.writeFileSync(commandFilePath, commandLogHeader); //create new file with header.
   }
   const vrcNameFilePath = getVrcNameLogPath(guildId);
   if (!fs.existsSync(vrcNameFilePath)) {
      fs.writeFileSync(vrcNameFilePath, vrcNameLogHeader); //create new file with header.
   }
   const textLogPath = getTextLogPath(guildId);
   if (!fs.existsSync(textLogPath)) {
      fs.writeFileSync(textLogPath, textLogHeader); //create new file with header.
   }
}

export function getVrcNameLogPath(guildId: string): string {
   return path.resolve('logs', 'guilds', guildId) + '/vrc_name_log.csv';
}

function getCommandLogPath(guildId: string): string {
   return path.resolve('logs', 'guilds', guildId) + '/command_log.csv';
}

function getTextLogPath(guildId: string): string {
   return path.resolve('logs', 'guilds', guildId) + '/text_log.csv';
}

/**
 * create write log steream for each channel. Stream make as interval write mode to decrease disk access.
 * @param guildId
 */
export function openCsvLogStream(guildId: string) {
   if (logGuilds.indexOf(guildId) != -1) return; //already exist
   //make files
   makeChannelLogPathAndFiles(guildId);
   //make streams
   const commandFileStream = fs.createWriteStream(getCommandLogPath(guildId), { flags: 'a' });
   const vrcNameFileStream = fs.createWriteStream(getVrcNameLogPath(guildId), { flags: 'a' });
   const textFileStream = fs.createWriteStream(getTextLogPath(guildId), { flags: 'a' });

   // Buffering (wait save file until call uncork)
   commandFileStream.cork();
   vrcNameFileStream.cork();
   textFileStream.cork();
   commandLog[guildId] = commandFileStream;
   vrcNameLog[guildId] = vrcNameFileStream;
   textLog[guildId] = textFileStream;
   logGuilds.push(guildId);
}

/**
 * close stream for each channel.
 * @param guildId
 */
export function closeCsvLogStream(guildId: string) {
   if (logGuilds.indexOf(guildId) == -1) return; //not exist
   commandLog[guildId].end();
   vrcNameLog[guildId].end();
   textLog[guildId].end();
   delete commandLog[guildId];
   delete vrcNameLog[guildId];
   delete textLog[guildId];
   logGuilds = logGuilds.filter((item) => item !== guildId);
}

/**
 * close all log stream. it call from process end.
 */
function closeAllCsvLogStream() {
   logGuilds = [];
   for (const guildId in commandLog) {
      commandLog[guildId].end();
   }
   for (const guildId in vrcNameLog) {
      vrcNameLog[guildId].end();
   }
   for (const guildId in textLog) {
      textLog[guildId].end();
   }
}

/**
 * write log data to stream. these is write disk to uncork or close.
 * @param log
 */
export function writeCommand(log: Command) {
   if (logGuilds.indexOf(log.guildId) == -1) return; //not exist
   log.guildName = log.guildName.replace(',', '.');
   log.note = log.note.replace(',', '.');
   log.command = log.command.replace(',', '.');
   log.commanderName = log.commanderName.replace(',', '.');
   log.target = log.target.replace(',', '.');
   commandLog[log.guildId].write('=' + csv.stringify([log], { delimiter: ',=', header: false, quoted: true }));
}

export function writeVrcName(log: VrcName) {
   if (logGuilds.indexOf(log.guildId) == -1) return; //not exist
   log.status = log.status.replace(',', '.');
   log.guildName = log.guildName.replace(',', '.');
   log.userName = log.userName.replace(',', '.');
   log.vrcName = log.vrcName.replace(',', '.');
   vrcNameLog[log.guildId].write('=' + csv.stringify([log], { delimiter: ',=', header: false, quoted: true }));
}

export function writeText(log: Text) {
   if (logGuilds.indexOf(log.guildId) == -1) return; //not exist
   log.status = log.status.replace(',', '.');
   log.guildName = log.guildName.replace(',', '.');
   textLog[log.guildId].write('=' + csv.stringify([log], { delimiter: ',=', header: false, quoted: true }));
}

//---------------------------------
// Log data is fulshed per 10sec. one stream flush interval is depend on channel number.
//---------------------------------
const LOGGER_KIND_NUM = 3;
let logKindCounter = 0;
let guildCounter = 0;
let logflushIntarvalTimer = setInterval(() => {
   if (logGuilds.length > 0) {
      let logSt: fs.WriteStream | null = null;
      if (logKindCounter >= LOGGER_KIND_NUM) {
         logKindCounter = 0;
      }
      switch (logKindCounter) {
         case 0:
            logSt = commandLog[logGuilds[guildCounter]];
            break;
         case 1:
            logSt = vrcNameLog[logGuilds[guildCounter]];
            break;
         case 2:
            logSt = textLog[logGuilds[guildCounter]];
            break;
         default:
            break;
      }
      if (++guildCounter >= logGuilds.length) {
         guildCounter = 0;
         logKindCounter++;
      }
      logSt?.uncork(); // output file (flush)
      logSt?.cork(); // reBuffering
   }
}, 10000); //per 10sec

/**
 * require call when process is end.
 */
export function logProcessEnd() {
   clearInterval(logflushIntarvalTimer);
   closeAllCsvLogStream();
}

/**
 * require calling to write (flush) log file when process exit.
 */
export function shutdownAfterLogFlush() {
   Log4js.shutdown(function () {
      process.exit(1); //shut down.
   });
}
