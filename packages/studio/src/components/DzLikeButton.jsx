"use client";

// DZ: heart button on a result card (Library likes, kept on the server).
import { useState } from "react";
import { dzLibrary } from "../dzLibrary.js";

export default function DzLikeButton({ id, liked: initial, onChange, className = "" }) {
  const [liked, setLiked] = useState(Boolean(initial));
  const [shownFor, setShownFor] = useState(initial);
  if (initial !== shownFor) { setShownFor(initial); setLiked(Boolean(initial)); }
  if (!id) return null;
  const toggle = async (e) => {
    e.stopPropagation();
    const next = !liked;
    setLiked(next);
    try {
      if (onChange) await onChange(id, next);
      else await dzLibrary.like(id, next);
    } catch { setLiked(!next); }
  };
  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={liked}
      aria-label={liked ? "Remove from Liked" : "Add to Liked"}
      title={liked ? "Remove from Liked" : "Add to Liked"}
      className={`flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-black/60 backdrop-blur-md transition-all hover:bg-[#22d3ee] hover:text-black ${liked ? "text-[#f43f5e]" : "text-white"} ${className}`}
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill={liked ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2.2" strokeLinejoin="round">
        <path d="M12 20.5s-7.5-4.6-9.3-9.2C1.6 8.4 3.4 5 6.8 5c2 0 3.5 1.1 4.2 2.5h2C13.7 6.1 15.2 5 17.2 5c3.4 0 5.2 3.4 4.1 6.3-1.8 4.6-9.3 9.2-9.3 9.2z" />
      </svg>
    </button>
  );
}

// Placeholder card body for a job that is still running or has failed.
// A job in progress: slow-drifting soft colour (cheap: two blurred blobs moved
// by CSS transforms, paused for people who ask for less motion) and a short
// label — "Generating" or "Upscaling". A failed job shows why.
const PENDING_CSS = `
@keyframes dz-drift-a { 0%,100% { transform: translate(-20%,-10%) scale(1); } 50% { transform: translate(25%,20%) scale(1.25); } }
@keyframes dz-drift-b { 0%,100% { transform: translate(20%,15%) scale(1.1); } 50% { transform: translate(-25%,-20%) scale(0.9); } }
@keyframes dz-breathe { 0%,100% { opacity: .55; } 50% { opacity: 1; } }
.dz-pend-a { animation: dz-drift-a 7s ease-in-out infinite; }
.dz-pend-b { animation: dz-drift-b 9s ease-in-out infinite; }
.dz-pend-t { animation: dz-breathe 2.4s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) { .dz-pend-a, .dz-pend-b, .dz-pend-t { animation: none; } }
`;
export function DzPendingTile({ status, error, className = "", label }) {
  if (status === "failed") {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-red-500/[0.06] p-4 text-center ${className}`}>
        <span className="text-base font-semibold text-red-300">Failed</span>
        {error && <span className="line-clamp-3 text-base text-red-200/70">{error}</span>}
      </div>
    );
  }
  return (
    <div className={`relative isolate flex items-center justify-center overflow-hidden bg-[#0b0d12] ${className}`} title="It keeps going if you close the page">
      <style>{PENDING_CSS}</style>
      <span aria-hidden className="dz-pend-a absolute left-1/4 top-1/4 h-2/3 w-2/3 rounded-full bg-[#22d3ee]/35 blur-3xl" />
      <span aria-hidden className="dz-pend-b absolute bottom-1/4 right-1/4 h-2/3 w-2/3 rounded-full bg-violet-500/30 blur-3xl" />
      <span className="dz-pend-t relative z-10 rounded-full bg-black/35 px-3 py-1 text-base font-semibold text-white/90 backdrop-blur-sm">{label || "Generating"}</span>
    </div>
  );
}
