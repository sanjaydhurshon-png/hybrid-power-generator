import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite");
const source = resolve(process.env.ENERGY_DB_PATH || "data/hybrid-power.sqlite");
const destination = process.argv[2] ? resolve(process.argv[2]) : "";

if (!destination || source === destination) {
  console.error("Usage: node scripts/backup-db.mjs <destination.sqlite>");
  process.exitCode = 1;
} else {
  mkdirSync(dirname(destination), { recursive: true });
  const database = new DatabaseSync(source);
  try {
    database.exec(`VACUUM INTO '${destination.replaceAll("'", "''")}'`);
    console.log(`SQLite backup created at ${destination}`);
  } finally {
    database.close();
  }
}