import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export function Button({ variant = "primary", className = "", type = "button", ...props }:
  ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" }) {
  return <button type={type} className={`k-btn k-btn-${variant} ${className}`.trim()} {...props} />;
}

export function Card({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`k-card ${className}`.trim()} {...props} />;
}

export function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <label className="k-field">{label}{children}</label>;
}

export function PageHeading({ title, eyebrow, children }: { title: string; eyebrow?: string; children?: ReactNode }) {
  return <header className="k-page-heading">
    {eyebrow && <div className="k-eyebrow">{eyebrow}</div>}
    <div className="k-page-heading-row"><h1>{title}</h1>{children}</div>
  </header>;
}

export function Status({ tone = "neutral", children }: {
  tone?: "neutral" | "info" | "success" | "warning" | "danger"; children: ReactNode;
}) {
  return <span className={`k-pill k-status-${tone}`}>{children}</span>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <p className="k-empty">{children}</p>;
}

export function LoadingState() {
  return <p className="k-empty" role="status" aria-live="polite">加载中…</p>;
}

export function ErrorState({ message, onRetry, retrying = false }: {
  message: string; onRetry?: () => void; retrying?: boolean;
}) {
  return <div className="k-error-state">
    <p className="k-error" role="alert">{message}</p>
    {onRetry && <Button variant="secondary" onClick={onRetry} disabled={retrying}>{retrying ? "重试中…" : "重试"}</Button>}
  </div>;
}
