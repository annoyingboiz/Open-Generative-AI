"use client";

// Texture filter control (handoff 17, §6): On / Off and strength 0–100 (default 60).
// Before generating it is a setting; on a finished video it re-renders the clean
// original on this server — free, never a new generation.
import { useEffect, useState } from "react";
import { Switch, Slider, Spinner, cn } from "../../ui/index.js";
import { lookData } from "../../dzCreate.js";

export const TEXTURE_DEFAULT = 60;
export const textureLabel = (preset) => (lookData().cameras || []).find((c) => c.texture === preset)?.label || preset;
// The texture preset of the camera chosen for a video, or null (Modern, Phone, no camera).
export const texturePresetOf = (look, kind) => (kind === "video" && look && look.on !== false ? (lookData().cameras || []).find((c) => c.id === look.camera)?.texture || null : null);

// value: { on, strength }; onChange(value) on every move; onCommit(value) when let go.
export function TextureControl({ preset, value, onChange, onCommit = null, busy = false, className = "" }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value?.on, value?.strength]); // eslint-disable-line react-hooks/exhaustive-deps
  const set = (next, commit) => { setV(next); onChange?.(next); if (commit) onCommit?.(next); };
  return (
    <div className={cn("space-y-2", className)}>
      <label className="flex items-center justify-between gap-3">
        <span className="min-w-0">
          <span className="text-base font-medium">Texture</span>
          <span className="text-sm text-muted-foreground"> · {textureLabel(preset)}</span>
        </span>
        <span className="flex items-center gap-2">
          {busy && <Spinner className="h-3.5 w-3.5" />}
          <Switch checked={v.on} disabled={busy} onCheckedChange={(on) => set({ ...v, on }, true)} aria-label="Texture" />
        </span>
      </label>
      <div className={cn("flex items-center gap-3", !v.on && "opacity-50")}>
        <Slider min={0} max={100} step={5} value={[v.strength]} disabled={!v.on || busy}
          onValueChange={([x]) => set({ ...v, strength: x }, false)} onValueCommit={([x]) => set({ ...v, strength: x }, true)} aria-label="Texture strength" />
        <span className="w-8 text-right text-sm tabular-nums text-muted-foreground">{v.strength}</span>
      </div>
      <p className="text-xs text-muted-foreground">Grain, noise and dust are added after the video is made. Changing it later costs nothing — the clean original is kept.</p>
    </div>
  );
}
