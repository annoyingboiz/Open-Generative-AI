"use client";

import { useState } from "react";
import { dzThumb, dzPlay } from "../api.js";

// A video shown as its poster picture (package 10, M4): the page asks for the video
// itself only when the pointer is on it (play) — never on load. Videos from outside
// (no poster of ours) keep a plain <video> that loads its first frame only.
export function DzPosterVideo({ url, w = 480, className, play = false, alt = "" }) {
  const [on, setOn] = useState(false);
  if (typeof url !== "string" || !url.startsWith("/media/")) {
    return <video src={url} className={className} muted playsInline preload="metadata" />;
  }
  if (play && on) {
    return <video src={dzPlay(url)} poster={dzThumb(url, w)} className={className} muted loop playsInline autoPlay preload="auto" onMouseLeave={() => setOn(false)} />;
  }
  return <img src={dzThumb(url, w)} alt={alt} draggable={false} loading="lazy" decoding="async" className={className} onMouseEnter={play ? () => setOn(true) : undefined} />;
}
