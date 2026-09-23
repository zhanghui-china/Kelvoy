#!/usr/bin/env bun
/**
 * Internal CLI (PRD §2, M1): `run <stage> --episode <id>`. Stays internal
 * long-term, not customer-facing. Episode load/save from Postgres + object
 * storage (PRD §6) is not wired — TODO once infra exists.
 */
import type { StageName } from "@kelvoy/engine";

function parseArgs(argv: string[]) {
  const [command, stage] = argv;
  const episodeIdx = argv.indexOf("--episode");
  const episodeId = episodeIdx >= 0 ? argv[episodeIdx + 1] : undefined;
  return { command, stage: stage as StageName | undefined, episodeId };
}

async function main() {
  const { command, stage, episodeId } = parseArgs(process.argv.slice(2));
  if (command !== "run" || !stage || !episodeId) {
    console.error("usage: kelvoy run <stage> --episode <episode_id>");
    process.exit(1);
  }
  console.error(`TODO: load episode ${episodeId}, run stage ${stage}`);
  throw new Error("not implemented");
}

main();
