"use client";

// Package 06, A2: the one drop overlay. Whole window, sidebar and header included; a dashed
// signal-colour frame 10 px from the edge (radius 14, 2 px, dash 12 / gap 12 with round ends,
// fitted to the perimeter so the seam has no short dash), drawn as SVG — a CSS dashed border
// lets the browser choose the dash. A solid orange frame means selection; this one, "drop here".
import { useEffect, useState } from "react";
import { UploadSimple } from "@phosphor-icons/react";

const INSET = 10;
const R = 14;
const PERIOD = 24; // 10 dash + 14 gap with round 1 px caps on both ends ≈ 12 / 12

export default function DropOverlay({ title = "Drop files here", line = "" }) {
  const [size, setSize] = useState(() => (typeof window === "undefined" ? { w: 1440, h: 900 } : { w: window.innerWidth, h: window.innerHeight }));
  useEffect(() => {
    const on = () => setSize({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  const w = Math.max(0, size.w - INSET * 2);
  const h = Math.max(0, size.h - INSET * 2);
  const perimeter = 2 * (w + h) - (8 - 2 * Math.PI) * R;
  const n = Math.max(1, Math.round(perimeter / PERIOD));
  return (
    <div className="pointer-events-none fixed inset-0 z-[100] flex items-center justify-center bg-overlay/[.62] backdrop-blur-[6px]" role="status" aria-live="polite">
      <svg className="absolute left-0 top-0" width={size.w} height={size.h} aria-hidden="true">
        <rect x={INSET + 1} y={INSET + 1} width={Math.max(0, w - 2)} height={Math.max(0, h - 2)} rx={R - 1} pathLength={n * PERIOD}
          fill="none" stroke="hsl(var(--signal))" strokeWidth="2" strokeDasharray="10 14" strokeLinecap="round" />
      </svg>
      <div className="flex flex-col items-center text-center text-overlay-foreground">
        <span className="flex h-16 w-16 items-center justify-center rounded-[18px] bg-overlay-foreground/10"><UploadSimple size={22} /></span>
        <p className="mt-4 text-lg font-semibold">{title}</p>
        {line && <p className="mt-1 text-base opacity-70">{line}</p>}
      </div>
    </div>
  );
}
