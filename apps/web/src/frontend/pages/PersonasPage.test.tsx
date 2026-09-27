import { expect, test } from "bun:test";
import type { Persona } from "@kelvoy/engine";
import { renderToStaticMarkup } from "react-dom/server";
import { StaticRouter } from "react-router-dom/server";
import { canEditPersona } from "../persona-access";
import { PersonaCard } from "./PersonasPage";

const persona: Persona = {
  persona_id: "c_official", owner_id: null, version: 1,
  name: "阿澄", desc: "虚构角色", locked: ["脸型"], default_outfit: "外套",
  refs: [], style: { lut: "warm", title_style: "clean" },
};

test("official card is labeled and has no edit link", () => {
  const html = renderToStaticMarkup(<StaticRouter location="/personas"><PersonaCard persona={persona} /></StaticRouter>);
  expect(html).toContain("官方角色");
  expect(html).not.toContain("/edit");
  expect(canEditPersona(persona)).toBe(false);
});

test("private card retains its edit link and edit-page permission", () => {
  const privatePersona = { ...persona, persona_id: "c_private", owner_id: "u_owner" };
  const html = renderToStaticMarkup(<StaticRouter location="/personas"><PersonaCard persona={privatePersona} /></StaticRouter>);
  expect(html).toContain("/personas/c_private/edit");
  expect(canEditPersona(privatePersona)).toBe(true);
});
