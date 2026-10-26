import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEnergyStore } from "./energyStore";

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("SQLite energy store", () => {
  it("persists readings and ignores duplicate device timestamps", () => {
    const directory = mkdtempSync(join(tmpdir(), "hybrid-power-test-"));
    directories.push(directory);
    const path = join(directory, "history.sqlite");
    const store = createEnergyStore(path);
    const record = { deviceId: "esp32-test", timestamp: 1_800_000_000_000, mode: "hardware" as const, payload: "{}" };
    expect(store.insert(record)).toBe(true);
    expect(store.insert(record)).toBe(false);
    store.close();

    const reopened = createEnergyStore(path);
    expect(reopened.latest()).toEqual([record]);
    expect(reopened.listSince(record.timestamp - 1)).toEqual([record]);
    reopened.close();
  });
});