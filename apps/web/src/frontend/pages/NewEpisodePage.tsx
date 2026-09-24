import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  type ContentViolation,
  DEFAULT_CANDIDATES,
  type EpisodeMode,
  SETTINGS_CANDIDATES_MAX,
  SETTINGS_CANDIDATES_MIN,
} from "@kelvoy/engine";
import {
  createEpisode,
  getEstimate,
  getMySettings,
  isContentViolation,
  listDestinations,
  listPersonas,
  listTemplates,
} from "../api/client";
import { useApiResource } from "../hooks/useApiResource";
import { DESTINATION_TYPE_LABELS } from "../labels";
import "./NewEpisodePage.css";

// FR-01 语气快捷 chip，点一下直接填入(替换，不追加)。
const TONE_CHIPS = ["松弛", "治愈", "活力", "文艺"];

// M2-15 设置页开放的候选数范围（1–3），跟后端 /api/episodes/estimate 校验
// 用的是同一对常量。
const CANDIDATE_OPTIONS = Array.from(
  { length: SETTINGS_CANDIDATES_MAX - SETTINGS_CANDIDATES_MIN + 1 },
  (_, i) => SETTINGS_CANDIDATES_MIN + i,
);

// FR-01/§6 默认禁止项：示例词"可读文字"+ 硬规则"真人"，用户可删可加。
const DEFAULT_BANNED = ["可读文字", "真人"];

// 逗号/顿号/换行都算分隔符，去空白、丢空串，不做去重以外的处理。
function splitBannedInput(raw: string): string[] {
  return raw
    .split(/[,，、\n]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export default function NewEpisodePage() {
  const navigate = useNavigate();
  // 首页"灵感目的地"卡片点进来时带 ?destination=<id>（#42）。
  const [searchParams] = useSearchParams();
  const destinationParam = searchParams.get("destination");

  // M2-15：账号级出片默认值（语气/候选数/关键帧模式）。没设置过的账号回
  // 空对象，下面的预填就什么都不做，表单保持 M2-15 之前的初值。
  const settingsRes = useApiResource(getMySettings, []);
  const settings = settingsRes.data?.settings ?? null;

  const personasRes = useApiResource(listPersonas, []);
  const destinationsRes = useApiResource(listDestinations, []);
  const templatesRes = useApiResource(listTemplates, []);

  const personas = personasRes.data?.personas ?? [];
  const destinations = destinationsRes.data?.destinations ?? [];
  const templates = templatesRes.data?.templates ?? [];

  const [personaId, setPersonaId] = useState("");
  const [destinationId, setDestinationId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [seasonMode, setSeasonMode] = useState<"preset" | "custom">("preset");
  const [season, setSeason] = useState("");
  const [tone, setTone] = useState("");
  const [banned, setBanned] = useState<string[]>(DEFAULT_BANNED);
  const [bannedInput, setBannedInput] = useState("");
  const [outfitOverride, setOutfitOverride] = useState("");
  const [mode, setMode] = useState<EpisodeMode>("per_shot");
  const [candidates, setCandidates] = useState<number>(DEFAULT_CANDIDATES);

  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState<string[] | null>(null);
  const [violations, setViolations] = useState<ContentViolation[] | null>(null);

  // 出片默认值到位后预填一次。settings 的引用只在这次请求结束时变，所以
  // 不会覆盖用户之后的手动修改（同下面那几个"各选一次默认项"的 effect）。
  useEffect(() => {
    if (!settings) return;
    if (settings.default_tone !== undefined) setTone(settings.default_tone);
    if (settings.default_mode !== undefined) setMode(settings.default_mode);
    if (settings.default_candidates !== undefined) setCandidates(settings.default_candidates);
  }, [settings]);

  // 数据到位后各选一次默认项，不覆盖用户之后的手动改选。
  useEffect(() => {
    if (personas.length > 0 && personaId === "") setPersonaId(personas[0].persona_id);
  }, [personas, personaId]);

  // 目的地的默认项优先用 ?destination=<id> 预选；id 不在库里（或者库变了）
  // 就回落到第一个，不报错——这个入口只是省一次下拉选择。
  useEffect(() => {
    if (destinations.length === 0 || destinationId !== "") return;
    const preselected = destinations.find((d) => d.destination_id === destinationParam);
    setDestinationId(preselected?.destination_id ?? destinations[0].destination_id);
  }, [destinations, destinationId, destinationParam]);

  const selectedPersona = personas.find((p) => p.persona_id === personaId) ?? null;
  const selectedDestination = destinations.find((d) => d.destination_id === destinationId) ?? null;
  const selectedTemplate = templates.find((t) => t.template_id === templateId) ?? null;

  // FR-01"可从模板预填"：目的地变了、当前模板骨架跟目的地类型不再匹配时，
  // 换成第一个匹配的模板；用户手动选了别的骨架的模板会保留到下次目的地变化。
  useEffect(() => {
    if (!selectedDestination) return;
    if (selectedTemplate && selectedTemplate.skeleton === selectedDestination.type) return;
    const match = templates.find((t) => t.skeleton === selectedDestination.type);
    if (match) setTemplateId(match.template_id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDestination?.destination_id, templates]);

  // 季节默认取目的地的 season_best[0]，跟着目的地切换；"自定义"下不跟随。
  useEffect(() => {
    if (seasonMode !== "preset" || !selectedDestination) return;
    setSeason(selectedDestination.season_best[0] ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDestination?.destination_id, seasonMode]);

  // FR-01/FR-09：mode / 候选数一变就重新粗估，展示在提交按钮旁，只展示不
  // 拦截。候选数目前只进估价，不随建期请求落库——Episode 里还没有这个字段
  // （PRD §6），要让流水线真按 N 出候选是 M1 接真实图像模型时的事。
  const { data: estimateData, loading: estimateLoading } = useApiResource(
    () => getEstimate(mode, candidates),
    [mode, candidates],
  );
  const estimate = estimateData?.estimate ?? null;

  function addBannedTerms() {
    const terms = splitBannedInput(bannedInput);
    if (terms.length === 0) return;
    setBanned((prev) => Array.from(new Set([...prev, ...terms])));
    setBannedInput("");
  }

  function removeBanned(term: string) {
    setBanned((prev) => prev.filter((t) => t !== term));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setFormErrors(null);
    setViolations(null);

    const result = await createEpisode({
      persona_id: personaId,
      destination_id: destinationId,
      template_id: templateId,
      season: season.trim().length > 0 ? season : undefined,
      tone: tone.trim().length > 0 ? tone : undefined,
      banned,
      mode,
      outfit_override: outfitOverride.trim().length > 0 ? outfitOverride : undefined,
    });
    setSubmitting(false);

    if (!result.ok) {
      if (result.error === "content_blocked") {
        // violations 是内容违规 / FR-02 结构违规的联合类型（client.ts），
        // 建期这条路由只会回前者。
        setViolations((result.violations ?? []).filter(isContentViolation));
        return;
      }
      setFormErrors(
        Array.isArray(result.errors) ? (result.errors as string[]) : [result.error ?? "创建失败"],
      );
      return;
    }

    navigate(`/episodes/${result.episode.episode_id}`);
  }

  const loading =
    personasRes.loading || destinationsRes.loading || templatesRes.loading || settingsRes.loading;
  const loadError =
    personasRes.error ?? destinationsRes.error ?? templatesRes.error ?? settingsRes.error;

  if (loading) return <p className="k-empty">加载中…</p>;
  if (loadError) return <p className="k-error">加载失败：{loadError}</p>;

  if (personas.length === 0) {
    return (
      <p className="k-empty">
        还没有角色，先去<Link to="/personas">建一个角色</Link>。
      </p>
    );
  }
  if (destinations.length === 0) {
    return (
      <p className="k-empty">
        还没有目的地，先去<Link to="/destinations">看看目的地库</Link>。
      </p>
    );
  }
  if (templates.length === 0) {
    return (
      <p className="k-empty">
        还没有模板，先去<Link to="/templates">建一个模板</Link>。
      </p>
    );
  }

  return (
    <div>
      <div className="k-eyebrow">新的一期</div>
      <h1>新建一期</h1>

      <form onSubmit={handleSubmit} className="k-brief-form">
        <div className="k-brief-grid">
          <label className="k-field">
            角色
            <select value={personaId} onChange={(e) => setPersonaId(e.target.value)}>
              {personas.map((p) => (
                <option key={p.persona_id} value={p.persona_id}>
                  {p.name} v{p.version}
                </option>
              ))}
            </select>
          </label>

          <label className="k-field">
            目的地
            <select value={destinationId} onChange={(e) => setDestinationId(e.target.value)}>
              {destinations.map((d) => (
                <option key={d.destination_id} value={d.destination_id}>
                  {d.city} · {d.name}（{DESTINATION_TYPE_LABELS[d.type]}）
                </option>
              ))}
            </select>
          </label>

          <label className="k-field">
            模板
            <select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
              {templates.map((t) => (
                <option key={t.template_id} value={t.template_id}>
                  {t.name}
                  {selectedDestination && t.skeleton !== selectedDestination.type
                    ? "（骨架与目的地类型不同）"
                    : ""}
                </option>
              ))}
            </select>
          </label>
          {selectedTemplate && (
            <p className="k-card-meta k-brief-template-preview">
              LUT：{selectedTemplate.lut} · 片头：{selectedTemplate.intro ?? "无"} · 片尾：
              {selectedTemplate.outro ?? "无"} · 标题样式：{selectedTemplate.title_style}
            </p>
          )}

          <label className="k-field">
            季节
            <select
              value={seasonMode === "custom" ? "__custom__" : season}
              onChange={(e) => {
                if (e.target.value === "__custom__") {
                  setSeasonMode("custom");
                  return;
                }
                setSeasonMode("preset");
                setSeason(e.target.value);
              }}
            >
              {(selectedDestination?.season_best ?? []).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
              <option value="__custom__">自定义…</option>
            </select>
          </label>
          {seasonMode === "custom" && (
            <label className="k-field">
              自定义季节
              <input value={season} onChange={(e) => setSeason(e.target.value)} placeholder="例如：早春" />
            </label>
          )}

          <label className="k-field">
            语气
            <input value={tone} onChange={(e) => setTone(e.target.value)} placeholder="例如：松弛" />
          </label>
          <div className="k-brief-chips k-brief-tone-chips">
            {TONE_CHIPS.map((chip) => (
              <button type="button" key={chip} className="k-chip" onClick={() => setTone(chip)}>
                {chip}
              </button>
            ))}
          </div>

          <label className="k-field">
            穿搭覆盖（可选）
            <input
              value={outfitOverride}
              onChange={(e) => setOutfitOverride(e.target.value)}
              placeholder={selectedPersona?.default_outfit ?? ""}
            />
          </label>

          <label className="k-field">
            禁止项
            <div className="k-brief-banned-input">
              <input
                value={bannedInput}
                onChange={(e) => setBannedInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addBannedTerms();
                  }
                }}
                placeholder="按逗号/顿号/回车分隔多项"
              />
              <button type="button" className="k-btn k-btn-secondary" onClick={addBannedTerms}>
                添加
              </button>
            </div>
          </label>
          <div className="k-brief-chips">
            {banned.map((term) => (
              <span className="k-chip k-chip-removable" key={term}>
                {term}
                <button type="button" aria-label={`删除禁止项 ${term}`} onClick={() => removeBanned(term)}>
                  ×
                </button>
              </span>
            ))}
          </div>

          <label className="k-field">
            每镜候选数
            <select value={candidates} onChange={(e) => setCandidates(Number(e.target.value))}>
              {CANDIDATE_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="k-field k-brief-mode">
            <legend>关键帧模式</legend>
            <label className="k-brief-radio">
              <input
                type="radio"
                name="mode"
                value="per_shot"
                checked={mode === "per_shot"}
                onChange={() => setMode("per_shot")}
              />
              逐镜生成（默认）—— 质量高、可控，图片调用量 ×2
            </label>
            <label className="k-brief-radio">
              <input
                type="radio"
                name="mode"
                value="grid"
                checked={mode === "grid"}
                onChange={() => setMode("grid")}
              />
              网格直出 —— 省一步、更便宜，分辨率受限
            </label>
          </fieldset>

          <div className="k-field">
            画幅
            <div className="k-brief-aspect">9:16 竖屏 · 约 30 秒</div>
          </div>
        </div>

        {violations && violations.length > 0 && (
          <ul className="k-error" role="alert">
            {violations.map((v) => (
              <li key={`${v.field}-${v.term}`}>
                以下内容不允许出现：{v.field}: {v.term}
              </li>
            ))}
          </ul>
        )}
        {formErrors && (
          <ul className="k-error" role="alert">
            {formErrors.map((err) => (
              <li key={err}>{err}</li>
            ))}
          </ul>
        )}

        <div className="k-brief-submit-row">
          <div className="k-brief-estimate">
            {estimateLoading || !estimate ? (
              "预估中…"
            ) : (
              <>
                预估：约 <span className="k-mono">{Math.round(estimate.gpu_minutes)}</span> GPU
                分钟（M0 前占位估算）
              </>
            )}
          </div>
          <button type="submit" className="k-btn k-btn-primary" disabled={submitting}>
            {submitting ? "创建中…" : "创建这一期"}
          </button>
        </div>
      </form>
    </div>
  );
}
