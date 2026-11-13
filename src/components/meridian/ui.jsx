// Shared MERIDIAN UI atoms: panel shell, source label, loading / error / empty
// states and form controls. Keeps the observatory aesthetic: thin borders,
// translucency, restrained blur.
import { RotateCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { ageLabel } from "@/lib/meridian/data-freshness.js";

// One look for every text input and select inside the panels.
export const inputClass = "w-full rounded-xl bg-surface-raised/70 px-3 py-2 text-sm text-fg outline-none transition-shadow duration-150 placeholder:text-subtle focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-50";
// Primary action inside a panel.
export const primaryButtonClass = "rounded-xl bg-accent px-3 py-2 text-sm font-medium text-accent-fg transition-[opacity,transform] duration-150 hover:opacity-90 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface disabled:opacity-40 disabled:active:scale-100";
export const quietButtonClass = "rounded-xl bg-surface-raised/70 px-3 py-2 text-sm text-muted transition-colors duration-150 hover:bg-surface-raised hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40";

export function Panel({ title, kicker, action, children, className }) {
  return (
    <section className={cn("rounded-2xl bg-surface/92 p-4 text-fg shadow-border backdrop-blur-md", className)}>
      {(title || kicker) && (
        <header className="mb-3 flex items-start justify-between gap-2">
          <div className="min-w-0">
            {kicker && <p className="text-[11px] font-medium uppercase tracking-label text-muted">{kicker}</p>}
            {title && <h3 className="font-display mt-0.5 truncate text-xl italic">{title}</h3>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function SourceLine({ source, fetchedAt, cached, stale }) {
  if (!source && !fetchedAt) return null;
  return (
    <p className="mt-2 text-[11px] leading-snug text-subtle">
      {source ? `Source: ${source}` : ""}
      {fetchedAt ? ` · Updated ${ageLabel(fetchedAt)}` : ""}
      {cached ? " · cached" : ""}
      {stale ? " · may be stale" : ""}
    </p>
  );
}

/** A failure the person can recover from: say what broke, offer the retry. */
export function ErrorState({ message, onRetry, retryLabel = "Try again" }) {
  return (
    <div role="alert" className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised/60 px-3 py-2.5 text-sm text-muted">
      <p className="min-w-0 flex-1">{message ?? "This isn't available right now."}</p>
      {onRetry && (
        <button type="button" onClick={onRetry}
          className="flex shrink-0 items-center gap-1.5 rounded-lg px-2 py-1 text-xs font-medium text-fg transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <RotateCw className="size-3.5" aria-hidden /> {retryLabel}
        </button>
      )}
    </div>
  );
}

export function EmptyState({ message }) {
  return <p className="px-1 py-2 text-sm text-subtle">{message ?? "Nothing here yet."}</p>;
}

export function Skeleton({ className, label = "Loading…" }) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn("skeleton min-h-10 rounded-xl", className)}
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}

/** A stack of list-row placeholders — one status announcement, not one per row. */
export function SkeletonRows({ rows = 4, label = "Loading…", className }) {
  return (
    <div role="status" aria-label={label} className={cn("space-y-1.5", className)}>
      <span className="sr-only">{label}</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} aria-hidden className="skeleton h-9 rounded-xl" style={{ width: `${100 - (i % 3) * 9}%` }} />
      ))}
    </div>
  );
}

export function Stat({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] uppercase tracking-label text-subtle">{label}</p>
      <p className="truncate text-sm font-medium text-fg">{value ?? "—"}</p>
    </div>
  );
}
