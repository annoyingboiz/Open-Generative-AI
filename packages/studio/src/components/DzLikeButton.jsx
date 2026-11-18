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
      className={`flex h-8 w-8 items-center justify-center rounded-full border border-overlay-foreground/10 bg-overlay/60 backdrop-blur-md transition-all hover:bg-primary hover:text-primary-foreground ${liked ? "text-signal" : "text-overlay-foreground"} ${className}`}
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
export function DzPendingTile({ status, error, className = "", label, note, onCancel }) {
  if (status === "failed") {
    return (
      <div className={`flex flex-col items-center justify-center gap-2 bg-destructive/[0.06] p-4 text-center ${className}`}>
        <span className="text-base font-semibold text-destructive">Failed</span>
        {error && <span className="line-clamp-3 text-base text-destructive">{error}</span>}
      </div>
    );
  }
  return (
    <div className={`relative isolate flex items-center justify-center overflow-hidden bg-card ${className}`} title="It keeps going if you close the page">
      <style>{PENDING_CSS}</style>
      <span aria-hidden className="dz-pend-a absolute left-1/4 top-1/4 h-2/3 w-2/3 rounded-full bg-signal/20 blur-3xl" />
      <span aria-hidden className="dz-pend-b absolute bottom-1/4 right-1/4 h-2/3 w-2/3 rounded-full bg-foreground/10 blur-3xl" />
      <span className="relative z-10 flex max-w-[92%] flex-col items-center gap-2 text-center">
        <span className="dz-pend-t rounded-full bg-overlay/35 px-3 py-1 text-base font-semibold text-overlay-foreground/90 backdrop-blur-sm">{label || "Generating"}</span>
        {/* e.g. "Waiting for the GPU: Meetbot is processing a meeting · 1 ahead" (this server) */}
        {note && <span className="line-clamp-3 rounded-lg bg-overlay/45 px-2.5 py-1 text-base leading-snug text-overlay-foreground/80 backdrop-blur-sm">{note}</span>}
        {onCancel && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onCancel(); }}
            className="rounded-lg border border-overlay-foreground/20 bg-overlay/40 px-3 py-1 text-base font-medium text-overlay-foreground/85 backdrop-blur-sm transition-colors hover:bg-overlay-foreground/10 hover:text-overlay-foreground">
            Cancel
          </button>
        )}
      </span>
    </div>
  );
}

// A sound in a grid: a square tile with its title and a player. Clicks on the
// player don't open the card.
export function DzAudioTile({ url, title, className = "", controls = true }) {
  return (
    <div className={`relative flex flex-col justify-between gap-3 bg-gradient-to-br from-primary/25 via-muted to-background p-3 ${className}`}>
      <div className="flex min-h-0 flex-1 items-center justify-center">
        <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" className="text-primary/80" aria-hidden="true"><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></svg>
      </div>
      {title && <p className="line-clamp-2 text-center leading-snug text-foreground/85">{title}</p>}
      {controls && <audio src={url} controls preload="none" className="h-9 w-full" onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} />}
    </div>
  );
}
