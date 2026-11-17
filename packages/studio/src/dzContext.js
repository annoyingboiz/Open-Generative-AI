"use client";

// DZ: the working context — Library (personal) or a project, plus the folder
// new work goes to. Set by the shell from the URL (/p/<slug>/<tab>); read by
// every studio, by uploads and by generation requests, so nothing needs to
// pass it around.
import { useEffect, useState } from "react";

const EVENT = "dz:context";
let current = { project: null, folder: null, folderPath: [], pending: false }; // project: { id, slug, name, color, role, archived }

export function dzGetContext() {
  return current;
}

export function dzSetContext(next) {
  const project = next.project ? { id: next.project.id, slug: next.project.slug, name: next.project.name, color: next.project.color, role: next.project.role, archived: Boolean(next.project.archived) } : null;
  const folder = project ? next.folder || null : null;
  const pending = Boolean(next.pending);
  // Names from the top folder down to the current one (for "Props / Rock Glass").
  const folderPath = folder && Array.isArray(next.folderPath) ? next.folderPath.map(String) : [];
  if (current.pending === pending && current.project?.id === project?.id && current.folder === folder && current.project?.name === project?.name && current.project?.color === project?.color && current.project?.archived === project?.archived && current.folderPath.join("\u0000") === folderPath.join("\u0000")) return;
  current = { project, folder, folderPath, pending };
  if (typeof window !== "undefined") {
    window.__DZ_CONTEXT__ = current;
    window.dispatchEvent(new CustomEvent(EVENT, { detail: current }));
  }
}

// Fields for requests: where new work goes.
// While a project switch is still loading, nothing is sent: it could land in the wrong place.
export function dzContextParams() {
  if (current.pending) throw new Error("Switching project — try again in a moment.");
  return current.project ? { project: current.project.id, folder: current.folder || undefined } : {};
}

// History scope for a studio panel: the project, or personal work only.
export function dzContextScope() {
  return current.project ? { project: current.project.id } : { project: "none" };
}

export function useDzContext() {
  const [ctx, setCtx] = useState(current);
  useEffect(() => {
    const on = (e) => setCtx(e.detail);
    window.addEventListener(EVENT, on);
    setCtx(current);
    return () => window.removeEventListener(EVENT, on);
  }, []);
  return ctx;
}
