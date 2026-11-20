"use client";

// New film. Phase D (the entry window with file sorting) replaces this:
// before it, "New storyboard" opens an empty film on its Moodboard (package 05, §4.1).
import { useEffect, useRef } from "react";
import { useDzContext } from "../../dzContext.js";
import { dzStoryboards } from "../../dzFilm.js";

export default function Entry({ onClose, onCreated }) {
  const ctx = useDzContext();
  const once = useRef(false);
  useEffect(() => {
    if (once.current) return;
    once.current = true;
    dzStoryboards.create({ project: ctx.project?.id || undefined })
      .then(({ storyboard }) => onCreated(storyboard, "mood"))
      .catch((e) => { window.dispatchEvent(new CustomEvent("dz:notify", { detail: { type: "error", title: "Storyboard", message: e.message } })); onClose(); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}
