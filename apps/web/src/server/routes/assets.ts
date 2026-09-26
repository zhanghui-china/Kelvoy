import { join, relative, resolve, sep } from "node:path";
import { getPersona } from "@kelvoy/store";
import { Hono } from "hono";
import { requireOwner } from "../middleware/auth";

/**
 * FR-05 审片台要的共享参考图：地标实景图（Destination.landmarks[].refs，
 * 形如 `dest/lingshan/buddha_01.jpg`）和角色参考图（Persona.refs，形如
 * `persona/<persona_id>/front.png`）。两者都落在 projects 根目录下、不在
 * 某一期的目录里，所以 episodes.ts 的 `/:id/files/:path` 取不到它们
 * （那条路由把路径锁死在 `<root>/<episode_id>/` 里，本来就该锁死）。
 *
 * 只读、只允许这两个前缀——projects 根下还有各期的产物目录，不能从这里
 * 绕过 episodes.ts 的 owner 校验读到别人的期。
 */
const assets = new Hono();

assets.use("*", requireOwner);

// 和 episodes.ts / personas.ts 的 projectsRoot() 同一套约定，三个路由文件
// 各留一份而不是抽公共模块——episodes.ts 已经为同样的理由（4 行路径拼接
// 不值得为它跨 app 导入或新开一个模块）这么取舍过，这里沿用同一个决定。
function projectsRoot(): string {
  return process.env.KELVOY_PROJECTS_ROOT ?? "projects";
}

const DESTINATION_PREFIX = "dest/";
const PERSONA_PREFIX = "persona/";

/**
 * Authorize only a canonical asset key. URL parsers normalize literal dot
 * segments, but encoded slashes can reach this route as ".." segments after
 * Hono decodes the parameter. Checking the original prefix while resolving
 * a different file would expose another account's persona asset.
 */
export function resolveAssetPath(relativeKey: string | undefined): string | null {
  if (!relativeKey) return null;
  if (!relativeKey.startsWith(DESTINATION_PREFIX) && !relativeKey.startsWith(PERSONA_PREFIX)) {
    return null;
  }
  const root = resolve(projectsRoot());
  const filePath = resolve(join(root, relativeKey));
  if (!filePath.startsWith(root + sep)) return null;
  if (relative(root, filePath) !== relativeKey) return null;
  return filePath;
}

// Hono 这个版本里，混在路径参数后面的裸 "*" 不会填充命名参数，正则参数会
// ——和 episodes.ts 的 `/:id/files/:path{.+}` 同一个经验结论。
assets.get("/:path{.+}", async (c) => {
  const key = c.req.param("path");
  const filePath = resolveAssetPath(key);
  if (!filePath) return c.json({ ok: false, error: "invalid_path" }, 400);

  // 角色参考图是私人素材（§8 多租户隔离）：路径第二段就是 persona_id，
  // 拿它查归属。目的地是全局共享库（没有 owner_id），登录即可读。
  if (key.startsWith(PERSONA_PREFIX)) {
    const personaId = key.slice(PERSONA_PREFIX.length).split("/")[0];
    const persona = personaId ? await getPersona(personaId) : null;
    if (!persona || (persona.owner_id !== null && persona.owner_id !== c.get("ownerId"))) {
      return c.json({ ok: false, error: "not_found" }, 404);
    }
  }

  const file = Bun.file(filePath);
  if (!(await file.exists())) {
    return c.json({ ok: false, error: "not_found" }, 404);
  }
  return new Response(file);
});

export default assets;
