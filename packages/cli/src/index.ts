#!/usr/bin/env bun
/**
 * Internal CLI (PRD §2, M1). Stays internal long-term, not customer-facing.
 *
 *   kelvoy run <stage> --episode <episode_id>
 *   kelvoy import-destination <path.json>
 */
import type { StageName } from "@kelvoy/engine";
import { importDestination } from "./import-destination";

function usage(): never {
  console.error("usage:");
  console.error("  kelvoy run <stage> --episode <episode_id>");
  console.error("  kelvoy import-destination <path.json>");
  process.exit(1);
}

async function runRun(argv: string[]): Promise<void> {
  const [stage] = argv;
  const episodeIdx = argv.indexOf("--episode");
  const episodeId = episodeIdx >= 0 ? argv[episodeIdx + 1] : undefined;
  if (!stage || !episodeId) usage();
  console.error(`TODO: load episode ${episodeId}, run stage ${stage as StageName}`);
  throw new Error("not implemented");
}

async function runImportDestination(argv: string[]): Promise<void> {
  const [path] = argv;
  if (!path) usage();
  const raw = await Bun.file(path).json();
  const result = await importDestination(raw);
  if (!result.ok) {
    console.error(`导入失败：${path}`);
    for (const err of result.errors ?? []) {
      console.error(`  - ${err}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`导入成功：${result.destination_id}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "run":
      return runRun(rest);
    case "import-destination":
      return runImportDestination(rest);
    default:
      usage();
  }
}

main();
