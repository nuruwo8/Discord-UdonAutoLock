import { formatInTimeZone } from 'date-fns-tz';
import * as crypto from 'node:crypto';

// -----------------------------get time----------------------
const FORMAT_SEC = 'yyyy-MM-dd HH-mm-ss';
const FORMAT_DAY = 'yyyy-MM-dd';
const TIME_ZONE_TOKYO = 'Asia/Tokyo';

export function getNowJst(): string {
   return formatInTimeZone(new Date(), TIME_ZONE_TOKYO, FORMAT_SEC);
}

export function getToDayJst(): string {
   return formatInTimeZone(new Date(), TIME_ZONE_TOKYO, FORMAT_DAY);
}

export function getNowAndToDayJst(): { nowJst: string; todayJst: string } {
   const now = new Date();
   const nowJst = formatInTimeZone(now, TIME_ZONE_TOKYO, FORMAT_SEC);
   const todayJst = formatInTimeZone(now, TIME_ZONE_TOKYO, FORMAT_DAY);
   return { nowJst: nowJst, todayJst: todayJst };
}

// -----------------------------async sleep----------------------
import { setTimeout } from 'node:timers/promises';
export function asyncSleepSec(sec: number): Promise<void> {
   return setTimeout(sec * 1000);
}

// -----------------------------async hash library----------------------
export async function sha256hashAsync(input: string | Uint8Array) {
   let uint8Data: Uint8Array<ArrayBuffer>;
   if (typeof input === 'string') {
      uint8Data = new TextEncoder().encode(input);
   } else {
      uint8Data = new Uint8Array(input);
   }
   const digest = await crypto.subtle.digest('SHA-256', uint8Data);
   return Buffer.from(digest);
}
