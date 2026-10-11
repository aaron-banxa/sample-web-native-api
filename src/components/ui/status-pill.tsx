"use client";

import { useEffect, useRef } from "react";

export type PillTone = "ok" | "amber" | "red";

/** Compact live status above the widget (Cult UI · Dynamic Island). */
export function StatusPill({ text, meta, tone = "ok" }: { text: string; meta?: string; tone?: PillTone }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.classList.remove("bump");
    void el.offsetWidth; // restart the animation
    el.classList.add("bump");
  }, [text]);

  return (
    <div ref={ref} className="island" role="status" aria-live="polite">
      <span className={`island-dot${tone === "ok" ? "" : ` ${tone}`}`} />
      <span>{text}</span>
      {meta && <span className="island-meta">{meta}</span>}
    </div>
  );
}
