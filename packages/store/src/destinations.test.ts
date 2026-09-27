import { afterEach, beforeEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Destination } from "@kelvoy/engine";
import { close, open } from "./db";
import { getDestination, getDestinationVersion, getDestinationVersionInfo, listDestinations, upsertDestination } from "./destinations";

function fixture(id: string, name: string): Destination {
  return {
    destination_id: id,
    version: 1,
    name,
    city: "无锡",
    type: "scenic_area",
    season_best: ["春"],
    landmarks: [
      { id: "l1", name: "地标", refs: ["a.jpg", "b.jpg", "c.jpg"], best_time: "上午", must_keep: ["x"] },
    ],
    route: [],
    food: [],
    transport: "",
    stay: "",
  };
}

beforeEach(() => {
  open(":memory:");
});

afterEach(() => {
  close();
});

test("returns null for a missing destination", async () => {
  expect(await getDestination("d_missing")).toBeNull();
});

test("round-trips an upserted destination", async () => {
  await upsertDestination(fixture("d_1", "灵山大佛"));
  const result = await getDestination("d_1");
  expect(result?.name).toBe("灵山大佛");
  expect(result?.landmarks.length).toBe(1);
});

test("upserting the same id again overwrites in place", async () => {
  await upsertDestination(fixture("d_2", "旧名字"));
  await upsertDestination({ ...fixture("d_2", "新名字"), version: 2 });
  const result = await getDestination("d_2");
  expect(result?.name).toBe("新名字");
  expect(result?.version).toBe(2);
  expect((await getDestinationVersion("d_2", 1))?.name).toBe("旧名字");
  expect((await getDestinationVersion("d_2", 2))?.name).toBe("新名字");
  expect((await getDestinationVersionInfo("d_2", 1))?.compatibility_approximation).toBe(false);
});

test("cannot rewrite a destination revision after an episode may have used it", async () => {
  await upsertDestination(fixture("d_3", "原名"));
  await expect(upsertDestination(fixture("d_3", "被覆盖"))).rejects.toThrow("revision");
  expect((await getDestinationVersion("d_3", 1))?.name).toBe("原名");
});

test("legacy missing revisions are marked approximate and migration runs once", async () => {
  close();
  const dir = mkdtempSync(join(tmpdir(), "kelvoy-destination-migrate-"));
  const path = join(dir, "old.db");
  try {
    const old = new Database(path);
    old.exec(`create table destinations (destination_id text primary key, version integer not null,
      doc text not null, updated_at text not null default (datetime('now')));
      create table episodes (episode_id text primary key, owner_id text not null,
      row_version integer not null default 1, doc text not null,
      updated_at text not null default (datetime('now')));`);
    old.query("insert into destinations (destination_id, version, doc) values (?, ?, ?)")
      .run("d_old", 3, JSON.stringify({ ...fixture("d_old", "当前景点"), version: 3 }));
    old.query("insert into episodes (episode_id, owner_id, doc) values (?, ?, ?)")
      .run("e_old", "u_1", JSON.stringify({ destination_id: "d_old", destination_version: 1 }));
    old.close();
    open(path);
    expect((await getDestinationVersionInfo("d_old", 1))?.compatibility_approximation).toBe(true);
    expect((await getDestinationVersionInfo("d_old", 3))?.compatibility_approximation).toBe(false);
    const frozen = await getDestinationVersion("d_old", 1);
    await upsertDestination({ ...fixture("d_old", "更新景点"), version: 4 });
    close();
    open(path);
    expect(await getDestinationVersion("d_old", 1)).toEqual(frozen);
    expect((await getDestinationVersion("d_old", 4))?.name).toBe("更新景点");
  } finally {
    close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listDestinations returns everything (shared official data, no owner filter)", async () => {
  await upsertDestination(fixture("d_1", "灵山大佛"));
  await upsertDestination(fixture("d_2", "拈花湾"));

  const result = await listDestinations();
  expect(result.map((d) => d.destination_id).sort()).toEqual(["d_1", "d_2"]);
});

test("listDestinations returns an empty array when none exist", async () => {
  expect(await listDestinations()).toEqual([]);
});
