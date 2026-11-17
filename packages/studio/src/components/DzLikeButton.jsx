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
export function DzPendingTile({ status, error, className = "" }) {
  if (status === "failed") {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-red-500/[0.06] p-4 text-center ${className}`}>
        <span className="text-[13px] font-semibold text-red-300">Failed</span>
        {error && <span className="line-clamp-3 text-[12px] text-red-200/70">{error}</span>}
      </div>
    );
  }
  return (
    <div className={`flex flex-col items-center justify-center gap-3 bg-white/[0.02] ${className}`}>
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-[#22d3ee]/25 border-t-[#22d3ee]" />
      <span className="text-[12px] text-white/50">Generating… it keeps going if you close the page</span>
    </div>
  );
}
