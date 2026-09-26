import { type ChangeEvent, type DragEvent, type FormEvent, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { Persona } from "@kelvoy/engine";
import { AssetImage } from "../AssetImage";
import {
  assetUrl,
  createPersona,
  listPersonas,
  listTemplates,
  patchPersona,
  uploadPersonaRefs,
} from "../api/client";
import { useApiResource } from "../hooks/useApiResource";
import { canEditPersona } from "../persona-access";
import { describeWriteError } from "../review/errors";
import "./PersonaEditPage.css";

// §4："这三项是锁定的" —— 新建时默认全选；schema 是 string[]，用户可以
// 取消勾选（不做自由文本新增，设计稿只画了这三个可勾选标签）。
const DEFAULT_LOCKED_TRAITS = ["脸型", "发型", "体态"];

// 跟 personas.ts 的 MIN_REFS/MAX_REFS 同值——没有共享常量可 import（后端那
// 两个是路由文件内的局部量），跟 DestinationsPage.tsx 的 MIN_LANDMARK_REFS
// 一样各自本地定义一份。
const MIN_REFS = 3;
const MAX_REFS = 7;

/**
 * M2-13 (#41)：角色新建 `/personas/new` + 编辑 `/personas/:id/edit` 共用同
 * 一个表单组件。后端建角色是两步（POST /api/personas 拿 id，再 POST
 * .../refs 传图），这里把它做成一次提交：先建角色/存修改，成功后紧接着传
 * 参考图；如果传图这一步失败，角色/修改已经落库了，不能就地摔掉重来——
 * 把地址栏替换成 /personas/:id/edit，把这次提交里已经选好的文件留在页面
 * 上，让用户直接重试"保存"（这次会走 PATCH + 补传，不会建出第二个角色）。
 */
export default function PersonaEditPage() {
  const { id } = useParams<{ id: string }>();
  const isEdit = id !== undefined;
  const navigate = useNavigate();

  const personasRes = useApiResource(listPersonas, []);
  const templatesRes = useApiResource(listTemplates, []);

  const [savedPersona, setSavedPersona] = useState<Persona | null>(null);
  const listedPersona = isEdit
    ? (personasRes.data?.personas.find((p) => p.persona_id === id) ?? null)
    : null;
  // savedPersona 优先——它是这一页自己刚保存成功后拿到的最新数据，比
  // personasRes 那次一次性拉取（可能是打开页面时的旧快照）更新。
  const current = savedPersona ?? listedPersona;

  // 风格下拉：M2 阶段"可选项就是内置模板用到的那几个值"（issue #41），不做
  // 自由输入。官方模板（owner_id === null）用到的 lut/title_style 去重；
  // 角色已有的值（哪怕不在当前模板列表里，比如模板后来被删了）也并进去，
  // 不然编辑页会把一个合法的已存值渲染成一个选不中的空选项。
  const officialTemplates = (templatesRes.data?.templates ?? []).filter((t) => t.owner_id === null);
  const lutOptions = Array.from(
    new Set([...officialTemplates.map((t) => t.lut), ...(current ? [current.style.lut] : [])]),
  );
  const titleStyleOptions = Array.from(
    new Set([
      ...officialTemplates.map((t) => t.title_style),
      ...(current ? [current.style.title_style] : []),
    ]),
  );

  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [locked, setLocked] = useState<string[]>(DEFAULT_LOCKED_TRAITS);
  const [defaultOutfit, setDefaultOutfit] = useState("");
  const [lut, setLut] = useState("");
  const [titleStyle, setTitleStyle] = useState("");

  // 编辑页数据到位后，把表单填成角色当前的值——只做一次，不然每次
  // personasRes/savedPersona 变化都会把用户正在改的内容冲掉。
  const initedRef = useRef(false);
  useEffect(() => {
    if (initedRef.current || !current) return;
    setName(current.name);
    setDesc(current.desc);
    setLocked(current.locked);
    setDefaultOutfit(current.default_outfit);
    setLut(current.style.lut);
    setTitleStyle(current.style.title_style);
    initedRef.current = true;
  }, [current]);

  // 风格下拉数据到位后各选一次默认项（新建时還没有 current 可以拿默认
  // 值）——不覆盖用户之后的手动改选，跟 NewEpisodePage 同样的写法。
  useEffect(() => {
    if (lutOptions.length > 0 && lut === "") setLut(lutOptions[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lutOptions.join("|")]);
  useEffect(() => {
    if (titleStyleOptions.length > 0 && titleStyle === "") setTitleStyle(titleStyleOptions[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [titleStyleOptions.join("|")]);

  function toggleLocked(trait: string) {
    setLocked((prev) => (prev.includes(trait) ? prev.filter((t) => t !== trait) : [...prev, trait]));
  }

  // 待上传的参考图——选完/拖完先留在本地，提交时才真正发请求。
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);

  useEffect(() => {
    const urls = pendingFiles.map((f) => URL.createObjectURL(f));
    setPreviewUrls(urls);
    return () => {
      urls.forEach((u) => URL.revokeObjectURL(u));
    };
  }, [pendingFiles]);

  function addFiles(files: FileList | File[]) {
    // 先把 FileList 拷成数组再进 setState：input 的 files 是活引用，下面
    // handleFilePick 的 `e.target.value = ""` 一清空它就跟着空了，而
    // setState 的 updater 要到下一次渲染才执行——写在 updater 里读就永远
    // 读到空列表（点"选择文件"选图后什么都不出现）。
    const picked = Array.from(files);
    setPendingFiles((prev) => [...prev, ...picked]);
  }

  function handleFilePick(e: ChangeEvent<HTMLInputElement>) {
    if (e.target.files) addFiles(e.target.files);
    e.target.value = ""; // 允许再次选中同一个文件
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (e.dataTransfer.files) addFiles(e.dataTransfer.files);
  }

  function removePendingFile(index: number) {
    setPendingFiles((prev) => prev.filter((_, i) => i !== index));
  }

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * 提交前的张数校验，跟 personas.ts 的 [MIN_REFS, MAX_REFS] 语义对齐，纯
   * 前端算，不发请求——issue 验收"传 2 张就提交：前端拦下，不发请求"。
   * 编辑页不选新文件（pendingFiles 为空）时跳过：那就是纯改资料，不动
   * 参考图，角色现有张数不够也不该拦住这次保存（"编辑页可以补传"是可选
   * 动作，不是每次编辑都强制凑够）。
   */
  function validateRefsSelection(): string | null {
    if (pendingFiles.length === 0) {
      if (isEdit) return null;
      return "请至少上传 3 张参考图";
    }
    const existingCount = current?.refs.length ?? 0;
    const total = existingCount + pendingFiles.length;
    if (total < MIN_REFS || total > MAX_REFS) {
      return `参考图总数必须在 ${MIN_REFS}–${MAX_REFS} 张之间（当前已有 ${existingCount} 张，本次选择 ${pendingFiles.length} 张，合计 ${total} 张）`;
    }
    return null;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);

    const refsError = validateRefsSelection();
    if (refsError) {
      setError(refsError);
      return;
    }

    setSubmitting(true);
    const stylePayload = { lut, title_style: titleStyle };

    let targetId: string;
    if (id) {
      const patchResult = await patchPersona(id, { name, desc, locked, default_outfit: defaultOutfit, style: stylePayload });
      if (!patchResult.ok) {
        setSubmitting(false);
        setError(describeWriteError(patchResult));
        return;
      }
      targetId = id;
      setSavedPersona(patchResult.persona);
    } else {
      const createResult = await createPersona({
        name,
        desc,
        locked,
        default_outfit: defaultOutfit,
        style: stylePayload,
      });
      if (!createResult.ok) {
        setSubmitting(false);
        setError(describeWriteError(createResult));
        return;
      }
      targetId = createResult.persona.persona_id;
      setSavedPersona(createResult.persona);
      // 角色已经建好了——把地址栏换成编辑页，这样接下来传图失败也不会
      // 让用户以为"什么都没发生"再点一次提交，从而建出第二个角色。
      navigate(`/personas/${targetId}/edit`, { replace: true });
    }

    if (pendingFiles.length > 0) {
      const uploadResult = await uploadPersonaRefs(targetId, pendingFiles);
      setSubmitting(false);
      if (!uploadResult.ok) {
        setError(`角色信息已保存，但参考图上传失败：${describeWriteError(uploadResult)}`);
        return;
      }
      setSavedPersona(uploadResult.persona);
      setPendingFiles([]);
    } else {
      setSubmitting(false);
    }

    navigate("/personas");
  }

  if (personasRes.loading) return <p className="k-empty">加载中…</p>;
  if (personasRes.error) return <p className="k-error">加载失败：{personasRes.error}</p>;
  if (isEdit && !current) return <p className="k-error">找不到这个角色。</p>;
  if (isEdit && current && !canEditPersona(current)) {
    return (
      <div>
        <h1>{current.name}</h1>
        <p className="k-card-meta">官方角色由平台维护，可在新建期时选用。</p>
        <Link to="/personas">← 返回角色列表</Link>
      </div>
    );
  }
  if (templatesRes.loading) return <p className="k-empty">加载中…</p>;
  if (templatesRes.error) return <p className="k-error">加载失败：{templatesRes.error}</p>;

  return (
    <div>
      <div className="k-eyebrow">{isEdit ? "编辑角色" : "账号级资产 · 跨期复用"}</div>
      <h1>
        {isEdit ? current?.name : "新建角色"}
        {isEdit && current && <span className="k-pill k-persona-edit-version">v{current.version}</span>}
      </h1>
      <p>
        <Link to="/personas">← 返回角色列表</Link>
      </p>

      <form onSubmit={handleSubmit} className="k-persona-edit-form">
        <div className="k-card">
          <div className="k-persona-edit-grid">
            <label className="k-field">
              角色名
              <input value={name} onChange={(e) => setName(e.target.value)} required />
            </label>

            <label className="k-field">
              默认穿搭
              <input
                value={defaultOutfit}
                onChange={(e) => setDefaultOutfit(e.target.value)}
                placeholder="例如：米色风衣 + 白衬衫"
                required
              />
            </label>

            <label className="k-field k-persona-edit-span2">
              描述
              <textarea value={desc} onChange={(e) => setDesc(e.target.value)} required={!isEdit} />
            </label>

            <div className="k-field k-persona-edit-span2">
              锁定特征
              <div className="k-persona-edit-locked">
                {DEFAULT_LOCKED_TRAITS.map((trait) => {
                  const active = locked.includes(trait);
                  return (
                    <button
                      type="button"
                      key={trait}
                      className={`k-chip k-persona-edit-trait${active ? " k-persona-edit-trait-active" : ""}`}
                      aria-pressed={active}
                      onClick={() => toggleLocked(trait)}
                    >
                      {trait}
                    </button>
                  );
                })}
              </div>
            </div>

            <label className="k-field">
              LUT
              <select
                value={lut}
                onChange={(e) => setLut(e.target.value)}
                disabled={lutOptions.length === 0}
                required
              >
                {lutOptions.length === 0 && <option value="">暂无可选（先建一个模板）</option>}
                {lutOptions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>

            <label className="k-field">
              标题样式
              <select
                value={titleStyle}
                onChange={(e) => setTitleStyle(e.target.value)}
                disabled={titleStyleOptions.length === 0}
                required
              >
                {titleStyleOptions.length === 0 && <option value="">暂无可选（先建一个模板）</option>}
                {titleStyleOptions.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </div>

        <div className="k-card k-persona-edit-refs">
          <h2>参考图</h2>
          <p className="k-card-meta">
            允许上传真人照片，肖像权与合规责任由上传者自行确认并承担；系统不凭空生成与上传图无关的真实人物肖像。
          </p>
          <p className="k-card-meta">建议包含正 / 侧 / 全身 / 细节各至少一张，共 3–7 张。</p>

          {current && current.refs.length > 0 && (
            <>
              <div className="k-card-meta">
                已上传 {current.refs.length} 张
                {current.refs.length < MIN_REFS && (
                  <span className="k-pill k-persona-edit-insufficient">参考图不足</span>
                )}
              </div>
              <div className="k-persona-refs k-persona-edit-existing-refs">
                {current.refs.map((ref) => (
                  <AssetImage key={ref} src={assetUrl(ref)} alt={`${current.name} 参考图`} />
                ))}
              </div>
            </>
          )}

          <div className="k-persona-edit-dropzone" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
            <p className="k-card-meta">拖拽图片到这里，或</p>
            <label className="k-btn k-btn-secondary">
              选择文件
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                onChange={handleFilePick}
                hidden
              />
            </label>
          </div>

          {pendingFiles.length > 0 && (
            <div className="k-persona-edit-pending-refs">
              {pendingFiles.map((file, i) => (
                <div className="k-persona-edit-pending-item" key={`${file.name}-${i}`}>
                  <img src={previewUrls[i]} alt={file.name} />
                  <button type="button" aria-label={`移除 ${file.name}`} onClick={() => removePendingFile(i)}>
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {error && (
          <p className="k-error" role="alert">
            {error}
          </p>
        )}

        <div className="k-persona-edit-submit-row">
          <button type="submit" className="k-btn k-btn-primary" disabled={submitting}>
            {submitting ? "保存中…" : isEdit ? "保存修改" : "创建角色"}
          </button>
        </div>
      </form>
    </div>
  );
}
