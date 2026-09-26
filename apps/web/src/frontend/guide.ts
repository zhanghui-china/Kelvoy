/** Stable help anchors shared by the guide and contextual workspace hints. */
export const GUIDE_SECTIONS = [
  {
    id: "create",
    number: "01",
    title: "创建一期",
    summary: "选角色、目的地和模板，确认本期创作方向与预估积分。",
    href: "/episodes/new",
    action: "前往新建一期",
    steps: [
      "可以直接选官方角色；只有想固定自己的原创形象时，才去创建角色并上传参考图。",
      "在目的地库看地标和实景参考，在模板页了解骨架与画面风格。新建时选择目的地、季节、语气、创作要求；高级设置可改模板、穿搭和禁止项。",
      "画幅默认 9:16 竖屏，也可选 16:9 横屏。每镜候选数可选 1–3；候选越多，生成用量通常越高。提交前看表单给出的预估积分，实际用量可在用量页查看。",
    ],
    review: "确认角色形象、景区、画幅和要求都符合这期作品；创建后进入同一期的审核流程。",
  },
  {
    id: "script",
    number: "02",
    title: "审核脚本",
    summary: "检查故事顺序、地标、动作、字幕和关键帧提示词。",
    href: "/works",
    action: "在我的作品中继续",
    steps: [
      "等待脚本生成后，打开对应作品的“审核 1 · 脚本”。在脚本视图或故事板视图逐镜查看。",
      "可编辑镜头字段、调整顺序或删除镜头；当前至少保留 24 镜，不能在这里新增镜头。也可写优化指令按指令优化，或重新生成整份脚本。",
      "确认角色动作、地标、场景衔接与字幕后，点击“继续 → 生成素材与关键帧”。",
    ],
    review: "重点看镜头之间是否连贯、地标是否准确、提示词是否能产生想要的画面。",
  },
  {
    id: "keyframes",
    number: "03",
    title: "审核关键帧",
    summary: "为每镜人工选一张图，再进入视频生成。",
    href: "/works",
    action: "打开待审作品",
    steps: [
      "在“审核 2 · 关键帧”中，对照角色与地标参考图，逐镜点击一张候选图。策划稿只供查看，不是审核点。",
      "候选图按生成顺序显示，没有自动质量排名或不可选标记。效果不合适时可直接重生成，或修改关键帧 prompt 后重生成。",
      "全部镜头都选定后，点击“继续 → 生成视频”。",
    ],
    review: "逐镜核对角色一致性、地标形态、构图和画面瑕疵；不要把候选顺序当成质量分数。",
  },
  {
    id: "clips",
    number: "04",
    title: "审核片段",
    summary: "逐镜预览选段，并逐条确认质量红线。",
    href: "/works",
    action: "打开待审作品",
    steps: [
      "新建作品采用每镜 1 秒剪辑，起点按 30 fps 的帧格调整。拖动滑块预览，起点保存后再继续。旧版作品沿用原有节拍切点，可先转换为新版 1 秒剪辑并重新确认每镜。",
      "逐镜检查脸不崩、手部正常、地标形态正确、物理合理、无可读文字这五项。五项都确认后才能通过这一镜。",
      "坏镜可标记重生成；首次报告坏镜可免费重生成一次。全部片段通过后进入合成设置。",
    ],
    review: "观看实际视频动作和选中的片段，不要只凭关键帧判断。任何一项不合格就先重生成。",
  },
  {
    id: "compose",
    number: "05",
    title: "合成与预览",
    summary: "保存标题、配乐等设置，再开始合成。",
    href: "/works",
    action: "打开待合成作品",
    steps: [
      "在新建作品的“合成设置”中检查标题、字幕、转场、配乐、片头和片尾。旧版合成设置不提供字幕和转场开关，仍可调整标题、配乐与片头片尾。修改任何选项后先点“保存设置”。",
      "保存完成后“开始合成”才可用；提交后页面会刷新显示进度。成片生成后完整播放检查声音与画面，如启用字幕则检查字幕。",
      "若只需调整已完成作品的合成结果，可点“重新合成”；这不会重生成已通过的镜头。",
    ],
    review: "确认标题与画面一致、配乐合适，首尾没有缺帧或黑屏；新版作品还需检查字幕和转场。",
  },
  {
    id: "deliver",
    number: "06",
    title: "下载与分享",
    summary: "下载成片，或开启一个可关闭的公开分享链接。",
    href: "/works",
    action: "查看我的作品",
    steps: [
      "成片页可下载视频，并查看本期预估和实际积分用量；用量页可看账号的积分记录。",
      "需要给别人看时，点“开启分享”，复制分享链接；不再需要公开访问时点“关闭分享”。",
      "分享链接只打开可观看的分享页，不会自动发布到抖音、小红书等平台。平台发布需自行操作。",
    ],
    review: "打开分享链接检查播放是否正常；对外发送前确认作品已经完成并已通过自己的审核。",
  },
] as const;

export type GuideSectionId = (typeof GUIDE_SECTIONS)[number]["id"];

export const GUIDE_RESOURCES = [
  { id: "personas", title: "角色怎么选" },
  { id: "destinations", title: "目的地看什么" },
  { id: "templates", title: "模板如何搭配" },
  { id: "credits", title: "默认值与积分" },
  { id: "settings", title: "出片默认值" },
] as const;
export type GuideResourceId = (typeof GUIDE_RESOURCES)[number]["id"];
export type GuideId = GuideSectionId | GuideResourceId;

export function guideHref(id: GuideId): `/help#${GuideId}` {
  return `/help#${id}`;
}
