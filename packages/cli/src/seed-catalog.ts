import { constants } from "node:fs";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { Destination, Persona } from "@kelvoy/engine";
import { getDestination, getPersona, getPersonaVersion, upsertDestination } from "@kelvoy/store";
import { importOfficialPersona } from "./import-persona";
import { validateDestination } from "./validate-destination";

interface Catalog { personas: Persona[]; destinations: Destination[] }
export interface SeedResult { personas: number; destinations: number; assets: number }

const DEMO_ROOT = resolve(import.meta.dir, "../../../assets/demo");
const SHARED_ROOT = resolve(import.meta.dir, "../../../assets/shared");
const SHARED_PATHS = ["music/calm_morning.mp3", "music/city_walk.mp3",
  "music/bright_travel.mp3", "music/night_neon.mp3", "music/wide_nature.mp3",
  "lut/warm_film.cube", "intro/kelvoy_open.mp4", "outro/kelvoy_close.mp4"];

function refs(catalog: Catalog): string[] {
  return [...catalog.personas.flatMap((persona) => persona.refs),
    ...catalog.destinations.flatMap((destination) => destination.landmarks.flatMap((landmark) => landmark.refs))];
}

/** Explicit production-safe starter catalog import: no accounts or episodes. */
export async function seedCatalog(projectsRoot = process.env.KELVOY_PROJECTS_ROOT ?? "projects"): Promise<SeedResult> {
  const catalog = JSON.parse(await readFile(join(DEMO_ROOT, "catalog.json"), "utf8")) as Catalog;
  if (catalog.personas.length !== 2 || catalog.destinations.length !== 5) throw new Error("starter catalog count changed");
  const paths = refs(catalog);
  if (new Set(paths).size !== 21 || paths.length !== 21) throw new Error("starter catalog asset list changed");
  const assets = [...paths.map((relative) => ({ relative, root: DEMO_ROOT })),
    ...SHARED_PATHS.map((relative) => ({ relative, root: SHARED_ROOT }))];
  for (const destination of catalog.destinations) {
    const parsed = validateDestination(destination);
    if (!parsed.valid) throw new Error(parsed.errors.join("; "));
    const existing = await getDestination(destination.destination_id);
    if (existing && JSON.stringify(existing) !== JSON.stringify(destination)) {
      throw new Error(`destination ID collision: ${destination.destination_id}`);
    }
  }
  for (const persona of catalog.personas) {
    const existing = await getPersona(persona.persona_id);
    if (existing && existing.owner_id !== null) throw new Error(`persona ID collision: ${persona.persona_id}`);
    if (existing) {
      const initial = await getPersonaVersion(persona.persona_id, 1);
      if (JSON.stringify(initial) !== JSON.stringify({ ...persona, version: 1 })) {
        throw new Error(`persona ID collision: ${persona.persona_id}`);
      }
    }
  }
  // Check all existing files before any write. Never replace an existing path:
  // older persona revisions may still point to it.
  const missing: string[] = [];
  for (const { relative, root } of assets) {
    if (!/^(persona|dest)\/[a-z0-9_-]+\/[a-z0-9_-]+\.jpg$/.test(relative) &&
        !SHARED_PATHS.includes(relative)) throw new Error(`unsafe asset path: ${relative}`);
    const source = await readFile(join(root, relative));
    const target = Bun.file(join(projectsRoot, relative));
    if (!(await target.exists())) { missing.push(relative); continue; }
    const present = await target.arrayBuffer();
    if (!Buffer.from(present).equals(source)) throw new Error(`asset collision: ${relative}`);
  }
  for (const relative of missing) {
    const target = join(projectsRoot, relative);
    await mkdir(dirname(target), { recursive: true });
    const root = SHARED_PATHS.includes(relative) ? SHARED_ROOT : DEMO_ROOT;
    await copyFile(join(root, relative), target, constants.COPYFILE_EXCL);
  }
  let personaCount = 0;
  for (const persona of catalog.personas) {
    if (await getPersona(persona.persona_id)) continue;
    const result = await importOfficialPersona(persona);
    if (!result.ok) throw new Error(result.errors.join("; "));
    if (result.changed) personaCount++;
  }
  let destinationCount = 0;
  for (const destination of catalog.destinations) {
    if (await getDestination(destination.destination_id)) continue;
    await upsertDestination(destination);
    destinationCount++;
  }
  return { personas: personaCount, destinations: destinationCount, assets: missing.length };
}
