import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

export type StoredMeasurement = {
  deviceId: string;
  timestamp: number;
  mode: "simulator" | "hardware";
  payload: string;
};

export function createEnergyStore(databasePath: string) {
  const inMemory = databasePath === ":memory:";
  const resolvedPath = inMemory ? databasePath : resolve(databasePath);
  if (!inMemory) mkdirSync(dirname(resolvedPath), { recursive: true });
  const database = new DatabaseSync(resolvedPath);
  database.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS measurements (
      id INTEGER PRIMARY KEY,
      device_id TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('simulator', 'hardware')),
      payload TEXT NOT NULL,
      UNIQUE (device_id, timestamp)
    );
    CREATE INDEX IF NOT EXISTS measurements_timestamp_idx ON measurements(timestamp);
  `);
  const insert = database.prepare("INSERT OR IGNORE INTO measurements (device_id, timestamp, mode, payload) VALUES (?, ?, ?, ?)");
  const selectSince = database.prepare("SELECT device_id AS deviceId, timestamp, mode, payload FROM measurements WHERE timestamp >= ? ORDER BY timestamp ASC LIMIT ? OFFSET ?");
  const selectSinceMode = database.prepare("SELECT device_id AS deviceId, timestamp, mode, payload FROM measurements WHERE timestamp >= ? AND mode = ? ORDER BY timestamp ASC LIMIT ? OFFSET ?");
  const selectLatest = database.prepare("SELECT device_id AS deviceId, timestamp, mode, payload FROM measurements ORDER BY timestamp DESC LIMIT ?");
  const countSince = database.prepare("SELECT COUNT(*) AS count FROM measurements WHERE timestamp >= ?");
  const countSinceMode = database.prepare("SELECT COUNT(*) AS count FROM measurements WHERE timestamp >= ? AND mode = ?");
  const pruneBefore = database.prepare("DELETE FROM measurements WHERE timestamp < ?");

  return {
    insert(record: StoredMeasurement) {
      return insert.run(record.deviceId, record.timestamp, record.mode, record.payload).changes === 1;
    },
    listSince(timestamp: number, limit = 300, offset = 0, mode?: "simulator" | "hardware"): StoredMeasurement[] {
      return (mode ? selectSinceMode.all(timestamp, mode, limit, offset) : selectSince.all(timestamp, limit, offset)) as StoredMeasurement[];
    },
    countSince(timestamp: number, mode?: "simulator" | "hardware"): number {
      return Number(((mode ? countSinceMode.get(timestamp, mode) : countSince.get(timestamp)) as { count: number }).count);
    },
    pruneBefore(timestamp: number): number {
      return Number(pruneBefore.run(timestamp).changes);
    },
    latest(limit = 900): StoredMeasurement[] {
      return (selectLatest.all(limit) as StoredMeasurement[]).reverse();
    },
    close() {
      database.close();
    },
  };
}

export const energyStore = createEnergyStore(process.env.ENERGY_DB_PATH || (process.env.NODE_ENV === "test" ? ":memory:" : "data/hybrid-power.sqlite"));