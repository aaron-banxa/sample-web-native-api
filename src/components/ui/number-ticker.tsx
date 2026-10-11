"use client";

import { useEffect, useRef, useState } from "react";

/** Animates between numeric values (Magic UI · Number Ticker). */
export function NumberTicker({ value, decimals = 2, duration = 600 }: { value: number; decimals?: number; duration?: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);

  useEffect(() => {
    const start = performance.now();
    const initial = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const k = Math.min((now - start) / duration, 1);
      const next = initial + (value - initial) * (1 - Math.pow(1 - k, 3));
      setShown(next);
      from.current = next;
      if (k < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);

  return <>{shown.toLocaleString("en-AU", { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</>;
}
