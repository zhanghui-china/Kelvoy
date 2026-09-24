/*
 * 描边线条 SVG 图标（M2-12，#40）。新设计稿把侧栏导航从纯文字换成图标 +
 * 文字，这里就是那套图标——手写内联 SVG，不引入图标库依赖（CLAUDE.md：加
 * 依赖先过 ADR，这几个图标不值得为此开 ADR）。
 *
 * 风格统一：24x24 视口、无填充、描边用 currentColor（跟随调用处的文字色）、
 * 1.5 线宽、圆头圆角——跟设计稿的线条图标一致。新增图标照这个规格加，不要
 * 混入实心/双色图标。
 */

export interface IconProps {
  size?: number;
  className?: string;
}

const BASE_PROPS = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function icon(size: number | undefined, className: string | undefined) {
  return { ...BASE_PROPS, width: size ?? 20, height: size ?? 20, className, "aria-hidden": true };
}

export function HomeIcon({ size, className }: IconProps) {
  return (
    <svg {...icon(size, className)}>
      <path d="M3.5 10.5 12 3.5l8.5 7" />
      <path d="M5.5 9v10.5h13V9" />
      <path d="M9.75 19.5v-6h4.5v6" />
    </svg>
  );
}

export function NewEpisodeIcon({ size, className }: IconProps) {
  return (
    <svg {...icon(size, className)}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2.5" />
      <path d="M12 9.5v5M9.5 12h5" />
    </svg>
  );
}

export function PersonaIcon({ size, className }: IconProps) {
  return (
    <svg {...icon(size, className)}>
      <circle cx="12" cy="8.25" r="3.25" />
      <path d="M5.25 19.5c0-3.45 3.02-6.25 6.75-6.25s6.75 2.8 6.75 6.25" />
    </svg>
  );
}

export function DestinationIcon({ size, className }: IconProps) {
  return (
    <svg {...icon(size, className)}>
      <path d="M12 21s6.5-6.13 6.5-11.25A6.5 6.5 0 0 0 5.5 9.75C5.5 14.87 12 21 12 21Z" />
      <circle cx="12" cy="9.5" r="2.25" />
    </svg>
  );
}

export function WorksIcon({ size, className }: IconProps) {
  return (
    <svg {...icon(size, className)}>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M3.5 9.5h17M8.25 5v4.5M15.75 5v4.5" />
    </svg>
  );
}

export function TemplateIcon({ size, className }: IconProps) {
  return (
    <svg {...icon(size, className)}>
      <rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.5" />
      <rect x="13" y="3.5" width="7.5" height="4.5" rx="1.5" />
      <rect x="13" y="10.5" width="7.5" height="10" rx="1.5" />
      <rect x="3.5" y="13.5" width="7.5" height="7" rx="1.5" />
    </svg>
  );
}

export function UsageIcon({ size, className }: IconProps) {
  return (
    <svg {...icon(size, className)}>
      <path d="M4.5 19.5v-6M11 19.5v-11M17.5 19.5V8" />
      <path d="M4.5 19.5h15" />
    </svg>
  );
}

export function SettingsIcon({ size, className }: IconProps) {
  return (
    <svg {...icon(size, className)}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.75v2.1M12 18.15v2.1M20.25 12h-2.1M5.85 12h-2.1M17.66 6.34l-1.49 1.49M7.83 16.17l-1.49 1.49M17.66 17.66l-1.49-1.49M7.83 7.83 6.34 6.34" />
    </svg>
  );
}

export function LogoutIcon({ size, className }: IconProps) {
  return (
    <svg {...icon(size, className)}>
      <path d="M9.5 20H6a1.5 1.5 0 0 1-1.5-1.5v-13A1.5 1.5 0 0 1 6 4h3.5" />
      <path d="M15.5 16l4-4-4-4M19 12H9.5" />
    </svg>
  );
}

/**
 * 品牌标志（新设计稿第二版）——抽象山形，呼应 PRD 的旅行主题，颜色固定用
 * `--color-brand`（品牌红），跟错误态的 `--color-danger` 是两个独立变量，
 * 即使当前两者同值也不共用同一个 token 名字。落在侧栏顶部和登录页。
 */
export function LogoMark({ size = 28, className }: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden
      style={{ color: "var(--color-brand)" }}
    >
      <circle cx="12" cy="12" r="11" fill="currentColor" opacity={0.12} />
      <path
        d="M5.5 16.5 10 8.75l2.7 4.5 1.6-2.4 4.2 5.65H5.5Z"
        fill="currentColor"
        stroke="none"
      />
    </svg>
  );
}
