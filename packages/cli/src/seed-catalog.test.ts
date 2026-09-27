import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { close, getDestination, getPersona, getTemplate, open, updatePersona } from "@kelvoy/store";
import { seedCatalog } from "./seed-catalog";

const tempDirs: string[] = [];
afterEach(async () => {
  close();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

test("catalog seed copies real assets and imports stable records without version churn", async () => {
  open(":memory:");
  const root = await mkdtemp(join(tmpdir(), "kelvoy-seed-"));
  tempDirs.push(root);
  const first = await seedCatalog(root);
  expect(first.personas).toBe(2);
  expect(first.destinations).toBe(5);
  expect(first.templates).toBe(6);
  expect(first.assets).toBe(29);
  const asset = await readFile(join(root, "dest", "huangshan", "01.jpg"));
  expect(asset.length).toBeGreaterThan(1000);
  expect((await readFile(join(root, "music", "calm_morning.mp3"))).length).toBeGreaterThan(1000);
  const second = await seedCatalog(root);
  expect(second).toEqual({ personas: 0, destinations: 0, templates: 0, assets: 0 });
  expect((await getTemplate("t_official_mountain_summit"))?.owner_id).toBeNull();
  expect((await getPersona("c_official_aching"))?.version).toBe(1);
  expect((await getDestination("d_official_huangshan"))?.version).toBe(1);
  await updatePersona("c_official_aching", { name: "运营更新" });
  expect((await seedCatalog(root)).personas).toBe(0);
  expect((await getPersona("c_official_aching"))?.name).toBe("运营更新");
  await writeFile(join(root, "dest", "huangshan", "01.jpg"), "collision");
  await expect(seedCatalog(root)).rejects.toThrow();
});
