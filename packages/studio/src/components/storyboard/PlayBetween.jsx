"use client";

// "Play between shots" (package 05, §4.4): the end of the previous shot's approved
// take, this take, then the start of the next shot. A neighbour without an approved
// video shows its approved picture (or its first reference) for two seconds.
import { useEffect, useMemo, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { dzThumb } from "../../api.js";
import { isVideoUrl } from "../../dzFilm.js";
import { useEscLayer } from "../studio/ui.jsx";

const EDGE = 2; // seconds of each neighbour

function partOf(film, shot, side) {
  if (!shot) return null;
  const approved = film.media?.[shot.id]?.approved || [];
  const video = approved.find(isVideoUrl);
  if (video) return { kind: "video", url: video, side, label: `Shot ${shot.n}` };
  const pic = approved.find((u) => !isVideoUrl(u)) || (shot.refs || []).find((r) => r.kind !== "video")?.url;
  return pic ? { kind: "image", url: pic, side, label: `Shot ${shot.n}` } : null;
}

export default function PlayBetween({ film, take, prev, next, onClose }) {
  useEscLayer(true, onClose);
  const parts = useMemo(() => [partOf(film, prev, "end"), { kind: "video", url: take.url, side: "all", label: "This take" }, partOf(film, next, "start")].filter(Boolean), [film, take, prev, next]);
  const [i, setI] = useState(0);
  const [round, setRound] = useState(0);
  const video = useRef(null);
  const part = parts[i];
  const advance = () => setI((n) => (n + 1 < parts.length ? n + 1 : n));
  useEffect(() => {
    if (!part) return undefined;
    if (part.kind === "image") { const t = setTimeout(advance, EDGE * 1000); return () => clearTimeout(t); }
    return undefined;
  }, [i, round]); // eslint-disable-line react-hooks/exhaustive-deps
  const onMeta = (e) => {
    const v = e.currentTarget;
    if (part.side === "end") v.currentTime = Math.max(0, v.duration - EDGE);
    v.play().catch(() => {});
  };
  const onTime = (e) => { if (part.side === "start" && e.currentTarget.currentTime >= EDGE) advance(); };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim p-8" onClick={onClose} role="dialog" aria-label="Play between shots">
      <div className="relative w-[min(1100px,100%)]" onClick={(e) => e.stopPropagation()}>
        <div className="aspect-video w-full overflow-hidden rounded-xl bg-background">
          {part?.kind === "video" ? (
            <video key={`${round}-${i}-${part.url}`} ref={video} src={part.url} className="h-full w-full object-contain" muted={false} playsInline onLoadedMetadata={onMeta} onTimeUpdate={onTime} onEnded={advance} />
          ) : part ? <img key={i} src={dzThumb(part.url, 1600)} alt="" className="h-full w-full object-contain" /> : null}
        </div>
        <div className="mt-3 flex items-center gap-2">
          {parts.map((p, n) => (
            <button key={n} type="button" onClick={() => setI(n)} className={`h-7 rounded-md px-2.5 text-sm font-medium ${n === i ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:text-foreground"}`}>{p.label}{p.kind === "image" ? " · picture" : ""}</button>
          ))}
          <button type="button" onClick={() => { setI(0); setRound((r) => r + 1); }} className="ml-2 h-7 rounded-md px-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground">Play again</button>
          <button type="button" onClick={onClose} aria-label="Close" className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><X size={16} /></button>
        </div>
      </div>
    </div>
  );
}
