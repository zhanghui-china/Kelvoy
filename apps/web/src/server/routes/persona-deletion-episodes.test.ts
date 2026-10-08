import { deletePersona, dequeueTask, getCreditBalance, insertEpisode, insertPersona,
  updatePersona, upsertDestination, upsertTemplate } from "@kelvoy/store";
import { expect, test } from "bun:test";
import type { Persona } from "@kelvoy/engine";
import { setupEpisodeRouteTests, buildApp, destinationFixture, fixture, login,
  personaFixture, templateFixture } from "./episode-test-fixtures";

setupEpisodeRouteTests();

test("deleted role cannot create an episode but existing episode retains its frozen role", async () => {
  const owner = await login("deleted_episode_owner");
  const other = await login("deleted_episode_other");
  const original = personaFixture("c_deleted", owner.ownerId);
  await insertPersona(original);
  await insertEpisode({ ...fixture("e_history", owner.ownerId), persona_id: original.persona_id });
  await upsertDestination(destinationFixture("d_1"));
  await upsertTemplate(templateFixture("t_1"));
  await updatePersona(original.persona_id, { name: "new", refs: [] });
  expect(await deletePersona(original.persona_id, owner.ownerId, 2)).toEqual({ ok: true });
  const app = buildApp();
  const history = await app.request("/api/episodes/e_history", { headers: { cookie: owner.cookie } });
  expect(history.status).toBe(200);
  expect((await history.json() as { persona: Persona }).persona).toEqual(original);
  expect((await app.request("/api/episodes/e_history", { headers: { cookie: other.cookie } })).status).toBe(404);
  const balance = getCreditBalance(owner.ownerId);
  const create = await app.request("/api/episodes", { method: "POST",
    headers: { cookie: owner.cookie, "content-type": "application/json" },
    body: JSON.stringify({ persona_id: original.persona_id, destination_id: "d_1", template_id: "t_1" }),
  });
  expect(create.status).toBe(404);
  expect((await create.json()).error).toBe("persona_not_found");
  expect(getCreditBalance(owner.ownerId)).toEqual(balance);
  expect(await dequeueTask()).toBeNull();
});
