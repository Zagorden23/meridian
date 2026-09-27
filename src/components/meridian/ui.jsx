// Shared MERIDIAN UI atoms: panel shell, source label, error/empty states.
// Keeps the observatory aesthetic: thin borders, translucency, blur.
import { cn } from "@/lib/utils";
import { ageLabel } from "@/lib/meridian/data-freshness.js";

export function Panel({ title, kicker, action, children, className }) {
  return (
    <section className={cn("rounded-2xl bg-surface/92 p-4 text-fg shadow-border backdrop-blur-md", className)}>
      {(title || kicker) && (
        <header className="mb-3 flex items-start justify-between gap-2">
          <div>
            {kicker && <p className="text-[11px] font-medium uppercase tracking-label text-muted">{kicker}</p>}
            {title && <h3 className="font-display mt-0.5 text-xl italic">{title}</h3>}
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

export function ErrorState({ message }) {
  return (
    <div role="alert" className="rounded-xl border border-border bg-surface-raised/60 px-3 py-2.5 text-sm text-muted">
      {message ?? "Something unavailable right now."}
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

export function Stat({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-[11px] uppercase tracking-label text-subtle">{label}</p>
      <p className="truncate text-sm font-medium text-fg">{value ?? "—"}</p>
    </div>
  );
}
