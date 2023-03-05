import { formatToTimeZone } from 'date-fns-timezone';
import * as crypto from 'node:crypto';

// -----------------------------get time----------------------
const FORMAT_SEC = 'YYYY-MM-DD HH-mm-ss';
const FORMAT_DAY = 'YYYY-MM-DD';
const TIME_ZONE_TOKYO = 'Asia/Tokyo';

export function getNowJst(): string {
   return formatToTimeZone(new Date(), FORMAT_SEC, { timeZone: TIME_ZONE_TOKYO });
}

export function getToDayJst(): string {
   return formatToTimeZone(new Date(), FORMAT_DAY, { timeZone: TIME_ZONE_TOKYO });
}

export function getNowAndToDayJst(): { nowJst: string; todayJst: string } {
   const now = new Date();
   const nowJst = formatToTimeZone(now, FORMAT_SEC, { timeZone: TIME_ZONE_TOKYO });
   const todayJst = formatToTimeZone(now, FORMAT_DAY, { timeZone: TIME_ZONE_TOKYO });
   return { nowJst: nowJst, todayJst: todayJst };
}

// -----------------------------async sleep----------------------
import { setTimeout } from 'node:timers/promises';
export function asyncSleepSec(sec: number): Promise<void> {
   return setTimeout(sec * 1000);
}

// -----------------------------async hash libraly----------------------
export async function sha256hashAsync(input: string | Uint8Array) {
   let uint8Data: Uint8Array;
   if (typeof input === 'string') {
      uint8Data = new TextEncoder().encode(input);
   } else {
      uint8Data = input;
   }
   const digest = await crypto.subtle.digest('SHA-256', uint8Data);
   return Buffer.from(digest);
}
