import { lazy, Suspense, useEffect, useState } from "react";
const GlobeCanvas = lazy(() => import("@/components/globe/globe-canvas"));

function GlobeLoader() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-bg" role="status" aria-label="Loading globe">
      <svg viewBox="0 0 120 120" className="skeleton w-24 rounded-full" aria-hidden>
        <circle cx="60" cy="60" r="34" fill="none" stroke="rgba(158,201,214,.4)" strokeWidth="1" />
        <ellipse cx="60" cy="60" rx="47" ry="18" fill="none" stroke="rgba(158,201,214,.3)" strokeWidth="1" transform="rotate(-18 60 60)" />
      </svg>
      <p className="text-xs uppercase tracking-label text-subtle">Preparing the globe…</p>
    </div>
  );
}

export function GlobeExperience() {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) {
    return <GlobeLoader />;
  }
  return (<Suspense fallback={<GlobeLoader />}>
    <GlobeCanvas />
  </Suspense>);
}
