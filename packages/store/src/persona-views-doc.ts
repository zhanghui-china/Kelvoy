import { validatePersona } from "@kelvoy/engine";
import type { Persona, ThreeViews, ViewsGeneration, ViewsStatus } from "@kelvoy/engine";
import { getDb } from "./db";

/**
 * 三视图在 Persona 文档里的读写（ADR-0017）。默认穿搭（outfitId = null）的三视图记在 Persona 自身，
 * 其 source 是 `refs[0]`；自建穿搭记在 `outfits[]` 对应项，source 是 `outfit.source`。
 * 只供 persona-views-jobs 使用，不对外导出（index.ts 不 re-export）。
 */

export type ViewsState = { views?: ThreeViews; views_status?: ViewsStatus; views_gen?: ViewsGeneration };

export function readLivePersona(personaId: string): Persona | null {
  const row = getDb().query<{ doc: string }, [string]>(
    "select doc from personas where persona_id = ? and deleted_at is null",
  ).get(personaId);
  return row ? JSON.parse(row.doc) as Persona : null;
}

type Target = { source: string | undefined; state: ViewsState };

export function readTarget(persona: Persona, outfitId: string | null): Target | null {
  if (outfitId === null) return { source: persona.refs[0], state: pick(persona) };
  const outfit = persona.outfits?.find((o) => o.outfit_id === outfitId);
  return outfit ? { source: outfit.source, state: pick(outfit) } : null;
}

function pick(owner: ViewsState): ViewsState {
  const state: ViewsState = {};
  if (owner.views !== undefined) state.views = owner.views;
  if (owner.views_status !== undefined) state.views_status = owner.views_status;
  if (owner.views_gen !== undefined) state.views_gen = owner.views_gen;
  return state;
}

/** 整体替换目标的三个 views 字段（缺省的键会被删掉，保持「views 仅 ready 时存在」）。 */
export function withViewsState(persona: Persona, outfitId: string | null, state: ViewsState): Persona {
  const replace = <T extends ViewsState>(owner: T): T => {
    const { views: _v, views_status: _s, views_gen: _g, ...rest } = owner;
    return { ...rest, ...pick(state) } as T;
  };
  if (outfitId === null) return replace(persona);
  return { ...persona, outfits: persona.outfits?.map((o) => (o.outfit_id === outfitId ? replace(o) : o)) };
}

/**
 * 与穿搭编辑一致：每次改动都是一条普通修订（version + 1，追加 persona_versions），旧修订及其引用的文件原样保留。
 * 写入前过 engine 的 validatePersona，views 一致性规则只在 engine 一处定义。
 */
export function writePersonaRevision(current: Persona, next: Persona): Persona | null {
  const updated: Persona = { ...next, version: current.version + 1 };
  if (!validatePersona(updated).valid) return null;
  const doc = JSON.stringify(updated);
  const database = getDb();
  database.query("update personas set version = ?, doc = ?, updated_at = datetime('now') where persona_id = ?")
    .run(updated.version, doc, updated.persona_id);
  database.query("insert into persona_versions (persona_id, version, doc) values (?, ?, ?)")
    .run(updated.persona_id, updated.version, doc);
  return updated;
}
