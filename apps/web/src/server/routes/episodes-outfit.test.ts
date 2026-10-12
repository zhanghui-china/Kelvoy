import { insertPersona, updatePersona, upsertDestination, upsertTemplate } from "@kelvoy/store";
import { expect, test } from "bun:test";
import type { Episode } from "@kelvoy/engine";
import { buildApp, destinationFixture, login, personaFixture, setupEpisodeRouteTests, templateFixture } from "./episode-test-fixtures";

setupEpisodeRouteTests();

async function setup(name: string) {
  const { cookie, ownerId } = await login(name);
  await insertPersona({ ...personaFixture("c_1", ownerId), outfits: [
    { outfit_id: "o_1", name: "风衣", desc: "", seasons: ["秋"], refs: ["persona/c_1/o.png"] },
  ] });
  await upsertDestination(destinationFixture("d_1"));
  await upsertTemplate(templateFixture("t_1"));
  return cookie;
}
const post = (cookie: string, extra: object) => buildApp().request("/api/episodes", {
  method: "POST", headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({ persona_id: "c_1", destination_id: "d_1", template_id: "t_1", ...extra }),
});

test("POST stores a valid outfit_id in the brief", async () => {
  const cookie = await setup("outfit-ok");
  const res = await post(cookie, { outfit_id: "o_1" });
  expect(res.status).toBe(201);
  expect(((await res.json()) as { episode: Episode }).episode.brief.outfit_id).toBe("o_1");
});

test("POST without outfit_id keeps the default outfit (no field written)", async () => {
  const cookie = await setup("outfit-default");
  const res = await post(cookie, {});
  expect(((await res.json()) as { episode: Episode }).episode.brief.outfit_id).toBeUndefined();
});

test("POST rejects an unknown outfit_id, including one removed from the latest version", async () => {
  const cookie = await setup("outfit-missing");
  expect((await post(cookie, { outfit_id: "o_nope" })).status).toBe(400);
  await updatePersona("c_1", { outfits: [] });
  const res = await post(cookie, { outfit_id: "o_1" });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: string }).error).toBe("outfit_not_found");
});
