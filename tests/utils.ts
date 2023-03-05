/*import { Database as Sqlite3Database } from 'sqlite3';
import { Database, open } from 'sqlite';

export async function createTestDb(): Promise<Database> {
   const db = await open({ filename: ':memory:', driver: Sqlite3Database });
   await db.migrate();
   return db;
}

export function clearDb(db: Database): Promise<void> {
   return db.exec(
      `
      DELETE FROM vrc_name_list;
      DELETE FROM pin_limit;
      DELETE FROM pin_log;
      DELETE FROM vrc_name_log;
      DELETE FROM command_log;
      `
   );
}*/
