import { afterEach, beforeEach, expect, test } from "bun:test";
import { outfitSheetKey } from "@kelvoy/engine";
import type { Persona, PersonaOutfit, ThreeViews, ViewsGeneration } from "@kelvoy/engine";
import { getCreditAction, getCreditBalance, grantCredits } from "./credits";
import { close, getDb, open } from "./db";
import {
  addPersonaOutfit, canReadPersonaAsset, deletePersona, getPersona, getPersonaVersion, insertPersona,
  updatePersona, upsertOfficialPersona,
} from "./personas";
import {
  VIEWS_JOB_MAX_ATTEMPTS, cancelViewsJob, claimViewsJob, completeViewsJob, createViewsJob, failViewsJob,
  getViewsJob, listViewsJobs, renewViewsJobLease,
} from "./persona-views-jobs";
import { createUser } from "./users";

let owner = "";
let other = "";
const base = (): Persona => ({
  persona_id: "c_1", owner_id: owner, version: 1, name: "小岛", desc: "", locked: [], default_outfit: "衬衫",
  refs: ["persona/c_1/base.png"], style: { lut: "x", title_style: "y" },
});
// addPersonaOutfit 仍按旧路径要求 refs 1–3 张（source-only 穿搭的创建入口不在本任务范围），所以夹具带一张 refs。
const outfit = (id: string): PersonaOutfit =>
  ({ outfit_id: id, name: id, desc: "", seasons: ["秋"], refs: [`persona/c_1/${id}.png`], source: `persona/c_1/${id}-src.png` });
const views = (tag: string): ThreeViews => ({ front: `v/${tag}-f.jpg`, side: `v/${tag}-s.jpg`, back: `v/${tag}-b.jpg`, sheet: `v/${tag}-sheet.jpg` });
const gen: ViewsGeneration = { provider: "local", model: "qwen-image-edit", version: "1", seed: 7 };

beforeEach(async () => {
  open(":memory:");
  const a = await createUser({ username: "a", password_hash: "h" });
  const b = await createUser({ username: "b", password_hash: "h" });
  if (!a.ok || !b.ok) throw new Error("fixture");
  owner = a.user.user_id; other = b.user.user_id;
  grantCredits(owner, 20, "g1");
  grantCredits(other, 20, "g2");
  await insertPersona(base());
  expect(addPersonaOutfit({ persona_id: "c_1", owner_id: owner, outfit: outfit("o_1") }).ok).toBe(true);
});
afterEach(() => close());

const create = (outfit_id: string | null = null, regenerate = false) =>
  createViewsJob({ persona_id: "c_1", owner_id: owner, outfit_id, regenerate });
const created = async (outfit_id: string | null = null, regenerate = false) => {
  const r = await create(outfit_id, regenerate);
  if (!r.ok) throw new Error(r.error);
  return r.job;
};
async function finish(tag = "a") {
  const claimed = (await claimViewsJob())!;
  const done = await completeViewsJob({ job_id: claimed.job_id, lease_token: claimed.lease_token,
    expected_version: claimed.version, views: views(tag), views_gen: gen });
  return { claimed, done };
}

test("create reserves credits, marks the default outfit pending and bumps the persona revision", async () => {
  const job = await created();
  expect(job).toMatchObject({ status: "pending", attempt: 1, outfit_id: null, source_key: "persona/c_1/base.png",
    persona_version: 3, credit_action_id: job.job_id });
  expect(getCreditBalance(owner)).toEqual({ available: 17, reserved: 3 });
  expect(getCreditAction(job.job_id)).toMatchObject({ kind: "persona_view", price: 3, status: "reserved" });
  expect(await getPersona("c_1")).toMatchObject({ version: 3, views_status: "pending" });
  expect((await getPersonaVersion("c_1", 3))?.views_status).toBe("pending");
});

test("outfit target uses outfit.source and only touches that outfit", async () => {
  const job = await created("o_1");
  expect(job.source_key).toBe("persona/c_1/o_1-src.png");
  const persona = (await getPersona("c_1"))!;
  expect(persona.views_status).toBeUndefined();
  expect(persona.outfits![0]!.views_status).toBe("pending");
});

test("creating twice for the same target is idempotent and reserves once", async () => {
  const first = await create();
  const second = await create();
  expect(first.ok && second.ok && second.repeated && second.job.job_id === first.job.job_id).toBe(true);
  expect(getCreditBalance(owner)).toEqual({ available: 17, reserved: 3 });
  expect((await getPersona("c_1"))!.version).toBe(3); // outfit add (2) + one pending bump
  expect(await listViewsJobs("c_1", owner)).toHaveLength(1);
  await created("o_1"); // a different target is independent
  expect(getCreditBalance(owner).reserved).toBe(6);
});

test("the partial unique index rejects a second in-flight row for the same target and source", async () => {
  const job = await created();
  expect(() => getDb().query(`insert into persona_asset_jobs (job_id, persona_id, owner_id, outfit_id, persona_version,
    source_key, generation_id, credit_action_id) values ('dup', 'c_1', ?, null, 3, ?, 'g', 'dup')`)
    .run(owner, job.source_key)).toThrow();
});

test("an in-flight job for another source of the same target blocks a new one", async () => {
  await created();
  getDb().query("update persona_asset_jobs set source_key = 'persona/c_1/older.png'").run();
  expect(await create()).toEqual({ ok: false, error: "job_active" });
});

test("rejections: other tenant, official persona, missing outfit, missing source", async () => {
  expect(await createViewsJob({ persona_id: "c_1", owner_id: other, outfit_id: null })).toEqual({ ok: false, error: "not_found" });
  expect(await createViewsJob({ persona_id: "nope", owner_id: owner, outfit_id: null })).toEqual({ ok: false, error: "not_found" });
  await upsertOfficialPersona({ ...base(), persona_id: "off_1", owner_id: null });
  expect(await createViewsJob({ persona_id: "off_1", owner_id: owner, outfit_id: null })).toEqual({ ok: false, error: "not_found" });
  expect(await create("o_missing")).toEqual({ ok: false, error: "outfit_not_found" });
  getDb().query("update personas set doc = json_remove(doc, '$.outfits[0].source') where persona_id = 'c_1'").run();
  expect(await create("o_1")).toEqual({ ok: false, error: "no_source" });
  expect(getCreditBalance(owner)).toEqual({ available: 20, reserved: 0 });
});

test("insufficient credits roll back the whole creation", async () => {
  getDb().query("update credit_accounts set available = 2 where user_id = ?").run(owner);
  const before = (await getPersona("c_1"))!.version;
  expect(await create()).toEqual({ ok: false, error: "insufficient_credits" });
  expect(await getPersona("c_1")).toMatchObject({ version: before });
  expect((await getPersona("c_1"))!.views_status).toBeUndefined();
  expect(await listViewsJobs("c_1", owner)).toHaveLength(0);
  expect(getCreditBalance(owner)).toEqual({ available: 2, reserved: 0 });
});

test("a job is invisible to other tenants", async () => {
  const job = await created();
  expect(await getViewsJob(job.job_id, other)).toBeNull();
  expect(await listViewsJobs("c_1", other)).toEqual([]);
  expect(await cancelViewsJob(job.job_id, other)).toEqual({ ok: false, error: "not_found" });
  expect((await getViewsJob(job.job_id, owner))?.status).toBe("pending");
});

test("claim then complete writes ready views, settles credits and finishes the job", async () => {
  const job = await created();
  const { claimed, done } = await finish();
  expect(claimed).toMatchObject({ job_id: job.job_id, status: "processing", attempt: 1 });
  expect(done.ok && done.job).toMatchObject({ status: "succeeded", result: { views: views("a"), views_gen: gen } });
  const persona = (await getPersona("c_1"))!;
  expect(persona).toMatchObject({ views_status: "ready", views: views("a"), views_gen: gen, version: 4 });
  expect(outfitSheetKey(persona, null)).toBe("v/a-sheet.jpg");
  expect(getCreditBalance(owner)).toEqual({ available: 17, reserved: 0 });
  expect(getCreditAction(job.job_id)?.status).toBe("settled");
  expect(await claimViewsJob()).toBeNull();
});

test("complete is fenced by lease token, job version and expiry", async () => {
  await created();
  const claimed = (await claimViewsJob())!;
  const args = { job_id: claimed.job_id, views: views("a"), views_gen: gen };
  expect(await completeViewsJob({ ...args, lease_token: "lease_other", expected_version: claimed.version }))
    .toEqual({ ok: false, error: "lease_lost" });
  expect(await completeViewsJob({ ...args, lease_token: claimed.lease_token, expected_version: claimed.version + 1 }))
    .toEqual({ ok: false, error: "version_conflict" });
  expect(await renewViewsJobLease(claimed.job_id, claimed.lease_token)).toBe(true);
  getDb().query("update persona_asset_jobs set lease_until = 1").run();
  expect(await renewViewsJobLease(claimed.job_id, claimed.lease_token)).toBe(false);
  expect(await completeViewsJob({ ...args, lease_token: claimed.lease_token, expected_version: claimed.version }))
    .toEqual({ ok: false, error: "lease_lost" });
  expect(getCreditBalance(owner).reserved).toBe(3);
});

test("a malformed result is rejected without side effects", async () => {
  await created();
  const claimed = (await claimViewsJob())!;
  const result = await completeViewsJob({ job_id: claimed.job_id, lease_token: claimed.lease_token,
    expected_version: claimed.version, views: { ...views("a"), sheet: "" }, views_gen: gen });
  expect(result).toEqual({ ok: false, error: "invalid_result" });
  expect((await getPersona("c_1"))!.views_status).toBe("pending");
  expect(getCreditBalance(owner).reserved).toBe(3);
});

test("failure retries once, then fails terminally, releases credits and marks the target failed", async () => {
  const job = await created();
  const first = (await claimViewsJob())!;
  const r1 = await failViewsJob({ job_id: first.job_id, lease_token: first.lease_token, error: "gpu busy" });
  expect(r1).toMatchObject({ ok: true, outcome: "requeued", job: { status: "pending", attempt: 2, error: "gpu busy" } });
  expect(getCreditBalance(owner).reserved).toBe(3);
  expect((await getPersona("c_1"))!.views_status).toBe("pending");
  const second = (await claimViewsJob())!;
  expect(second.attempt).toBe(VIEWS_JOB_MAX_ATTEMPTS);
  expect(await failViewsJob({ job_id: second.job_id, lease_token: first.lease_token, error: "x" }))
    .toEqual({ ok: false, error: "lease_lost" });
  const r2 = await failViewsJob({ job_id: second.job_id, lease_token: second.lease_token, error: "gpu busy" });
  expect(r2).toMatchObject({ ok: true, outcome: "failed", job: { status: "failed" } });
  expect(getCreditBalance(owner)).toEqual({ available: 20, reserved: 0 });
  expect(getCreditAction(job.job_id)?.status).toBe("released");
  expect((await getPersona("c_1"))!.views_status).toBe("failed");
  expect(await claimViewsJob()).toBeNull();
  expect((await create()).ok).toBe(true); // a new request after a terminal failure is allowed
});

test("expired leases are reclaimed once, and fail terminally after the last attempt", async () => {
  const job = await created();
  await claimViewsJob();
  getDb().query("update persona_asset_jobs set lease_until = 1").run();
  const again = (await claimViewsJob())!;
  expect(again).toMatchObject({ job_id: job.job_id, attempt: 2 });
  getDb().query("update persona_asset_jobs set lease_until = 1").run();
  expect(await claimViewsJob()).toBeNull();
  expect((await getViewsJob(job.job_id, owner))?.status).toBe("failed");
  expect(getCreditBalance(owner)).toEqual({ available: 20, reserved: 0 });
  expect((await getPersona("c_1"))!.views_status).toBe("failed");
});

test("cancel releases credits and clears pending; a late worker commit is refused", async () => {
  const job = await created();
  const claimed = (await claimViewsJob())!;
  expect(await cancelViewsJob(job.job_id, owner)).toMatchObject({ ok: true, repeated: false, job: { status: "cancelled" } });
  expect(await cancelViewsJob(job.job_id, owner)).toMatchObject({ ok: true, repeated: true });
  expect(getCreditBalance(owner)).toEqual({ available: 20, reserved: 0 });
  expect((await getPersona("c_1"))!.views_status).toBeUndefined();
  expect(await completeViewsJob({ job_id: job.job_id, lease_token: claimed.lease_token,
    expected_version: claimed.version, views: views("a"), views_gen: gen })).toEqual({ ok: false, error: "lease_lost" });
});

test("a finished job cannot be cancelled", async () => {
  const job = await created();
  await finish();
  expect(await cancelViewsJob(job.job_id, owner)).toEqual({ ok: false, error: "not_cancellable" });
});

test("regenerate needs a flag, keeps old files readable, and cancel restores the old ready views", async () => {
  await created();
  await finish("old");
  expect(await create()).toEqual({ ok: false, error: "already_ready" });
  const job = await created(null, true);
  const during = (await getPersona("c_1"))!;
  expect(during.views_status).toBe("pending");
  expect(during.views).toBeUndefined();
  expect(await canReadPersonaAsset("c_1", "v/old-sheet.jpg", owner)).toBe(true); // retained revision still authorizes
  await cancelViewsJob(job.job_id, owner);
  expect(await getPersona("c_1")).toMatchObject({ views_status: "ready", views: views("old"), views_gen: gen });
  const again = await created(null, true);
  await finish("new");
  expect(outfitSheetKey((await getPersona("c_1"))!, null)).toBe("v/new-sheet.jpg");
  expect(await canReadPersonaAsset("c_1", "v/old-sheet.jpg", owner)).toBe(true);
  expect((await getViewsJob(again.job_id, owner))?.status).toBe("succeeded");
});

test("a failed regenerate falls back to the previous ready views", async () => {
  await created();
  await finish("old");
  await created(null, true);
  for (let i = 0; i < VIEWS_JOB_MAX_ATTEMPTS; i++) {
    const c = (await claimViewsJob())!;
    await failViewsJob({ job_id: c.job_id, lease_token: c.lease_token, error: "boom" });
  }
  expect(await getPersona("c_1")).toMatchObject({ views_status: "ready", views: views("old") });
});

test("completing after the source image changed abandons the job and releases credits", async () => {
  const job = await created();
  const claimed = (await claimViewsJob())!;
  await updatePersona("c_1", { refs: ["persona/c_1/other.png"] });
  const result = await completeViewsJob({ job_id: job.job_id, lease_token: claimed.lease_token,
    expected_version: claimed.version, views: views("a"), views_gen: gen });
  expect(result).toEqual({ ok: false, error: "source_changed" });
  expect((await getViewsJob(job.job_id, owner))?.status).toBe("cancelled");
  expect(getCreditBalance(owner)).toEqual({ available: 20, reserved: 0 });
  expect((await getPersona("c_1"))!.views_status).toBeUndefined();
});

test("unrelated persona edits during generation do not discard the result", async () => {
  await created();
  const claimed = (await claimViewsJob())!;
  await updatePersona("c_1", { name: "改名了" });
  const done = await completeViewsJob({ job_id: claimed.job_id, lease_token: claimed.lease_token,
    expected_version: claimed.version, views: views("a"), views_gen: gen });
  expect(done.ok).toBe(true);
  expect(await getPersona("c_1")).toMatchObject({ name: "改名了", views_status: "ready" });
});

test("deleting the persona cancels in-flight jobs and refunds the reservation", async () => {
  const job = await created();
  const claimed = (await claimViewsJob())!;
  const version = (await getPersona("c_1"))!.version;
  expect(await deletePersona("c_1", owner, version)).toEqual({ ok: true });
  expect((await getViewsJob(job.job_id, owner))?.status).toBe("cancelled");
  expect(getCreditBalance(owner)).toEqual({ available: 20, reserved: 0 });
  expect(await completeViewsJob({ job_id: job.job_id, lease_token: claimed.lease_token,
    expected_version: claimed.version, views: views("a"), views_gen: gen })).toEqual({ ok: false, error: "lease_lost" });
  expect(await create()).toEqual({ ok: false, error: "not_found" });
});

test("outfit views are readable by the owner only; free text cannot authorize a foreign key", async () => {
  const job = await created("o_1");
  expect(await canReadPersonaAsset("c_1", "persona/c_1/o_1-src.png", owner)).toBe(true);
  expect(await canReadPersonaAsset("c_1", "persona/c_1/o_1-src.png", other)).toBe(false);
  expect(await canReadPersonaAsset("c_1", views("z").sheet, owner)).toBe(false);
  const claimed = (await claimViewsJob())!;
  await completeViewsJob({ job_id: job.job_id, lease_token: claimed.lease_token,
    expected_version: claimed.version, views: views("z"), views_gen: gen });
  for (const key of Object.values(views("z"))) {
    expect(await canReadPersonaAsset("c_1", key, owner)).toBe(true);
    expect(await canReadPersonaAsset("c_1", key, other)).toBe(false);
  }
  expect(await canReadPersonaAsset("c_2", views("z").sheet, owner)).toBe(false);
  await updatePersona("c_1", { desc: "persona/secret/x.png", name: "persona/secret/x.png" });
  expect(await canReadPersonaAsset("c_1", "persona/secret/x.png", owner)).toBe(false);
});

test("default-outfit views are readable; official personas stay readable by everyone", async () => {
  await created();
  await finish("d");
  expect(await canReadPersonaAsset("c_1", "v/d-f.jpg", owner)).toBe(true);
  expect(await canReadPersonaAsset("c_1", "v/d-f.jpg", other)).toBe(false);
  await upsertOfficialPersona({ ...base(), persona_id: "off_1", owner_id: null, refs: ["official/a.png"] });
  expect(await canReadPersonaAsset("off_1", "official/a.png", other)).toBe(true);
  expect(await canReadPersonaAsset("off_1", "official/b.png", other)).toBe(false);
});

test("the migration is additive: new table, partial unique index, migration id, no price row", () => {
  const names = getDb().query<{ name: string }, []>("select name from sqlite_master where tbl_name = 'persona_asset_jobs'").all()
    .map((r) => r.name);
  expect(names).toContain("persona_asset_jobs");
  expect(names).toContain("idx_persona_asset_jobs_active_target");
  expect(getDb().query("select 1 from schema_migrations where migration_id = 'persona_asset_jobs_v1'").get()).not.toBeNull();
  expect(getDb().query("select 1 from credit_prices where kind = 'persona_view'").get()).toBeNull();
});
