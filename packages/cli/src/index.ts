#!/usr/bin/env bun
/**
 * Internal CLI (PRD §2, M1). Stays internal long-term, not customer-facing.
 *
 *   kelvoy run <stage> --episode <episode_id>
 *   kelvoy import-destination <path.json>
 *   kelvoy import-episode <path.json>
 *   kelvoy import-template <path.json>
 *   kelvoy create-user <username> <password>
 *   kelvoy set-password <username> <password>
 */
import type { StageName } from "@kelvoy/engine";
import { createUserAccount } from "./create-user";
import { importDestination } from "./import-destination";
import { importEpisode } from "./import-episode";
import { importTemplate } from "./import-template";
import { runEpisodeStage } from "./run-stage";
import { setUserPassword } from "./set-password";

function usage(): never {
  console.error("usage:");
  console.error("  kelvoy run <stage> --episode <episode_id>");
  console.error("  kelvoy import-destination <path.json>");
  console.error("  kelvoy import-episode <path.json>");
  console.error("  kelvoy import-template <path.json>");
  console.error("  kelvoy create-user <username> <password>");
  console.error("  kelvoy set-password <username> <password>");
  process.exit(1);
}

async function runRun(argv: string[]): Promise<void> {
  const [stage] = argv;
  const episodeIdx = argv.indexOf("--episode");
  const episodeId = episodeIdx >= 0 ? argv[episodeIdx + 1] : undefined;
  if (!stage || !episodeId) usage();

  const result = await runEpisodeStage(episodeId, stage as StageName);
  if (!result.ok) {
    console.error(result.error);
    process.exitCode = 1;
    return;
  }
  console.log(`阶段 ${stage} 完成，row_version=${result.row_version}`);
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

async function runImportEpisode(argv: string[]): Promise<void> {
  const [path] = argv;
  if (!path) usage();
  const raw = await Bun.file(path).json();
  const result = await importEpisode(raw);
  if (!result.ok) {
    console.error(`导入失败：${path}`);
    for (const err of result.errors ?? []) {
      console.error(`  - ${err}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`导入成功：${result.episode_id}`);
}

async function runImportTemplate(argv: string[]): Promise<void> {
  const [path] = argv;
  if (!path) usage();
  const raw = await Bun.file(path).json();
  const result = await importTemplate(raw);
  if (!result.ok) {
    console.error(`导入失败：${path}`);
    for (const err of result.errors ?? []) {
      console.error(`  - ${err}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`导入成功：${result.template_id}`);
}

async function runCreateUser(argv: string[]): Promise<void> {
  const [username, password] = argv;
  if (!username || !password) usage();
  const result = await createUserAccount(username, password);
  if (!result.ok) {
    console.error(`创建失败：${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`创建成功：${username}（${result.user_id}）`);
}

async function runSetPassword(argv: string[]): Promise<void> {
  const [username, password] = argv;
  if (!username || !password) usage();
  const result = await setUserPassword(username, password);
  if (!result.ok) {
    console.error(`修改失败：${result.error}`);
    process.exitCode = 1;
    return;
  }
  console.log(`密码已更新：${username}`);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "run":
      return runRun(rest);
    case "import-destination":
      return runImportDestination(rest);
    case "import-episode":
      return runImportEpisode(rest);
    case "import-template":
      return runImportTemplate(rest);
    case "create-user":
      return runCreateUser(rest);
    case "set-password":
      return runSetPassword(rest);
    default:
      usage();
  }
}

main();
