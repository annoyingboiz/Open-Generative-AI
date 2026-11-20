"use client";

// Moodboard (package 05, §4.3). The canvas (Konva) loads only in the browser and only when
// the Moodboard is opened: it needs a real <canvas>, and its code is not in the first bundle.
import { lazy, Suspense, useEffect, useState } from "react";

const MoodCanvas = lazy(() => import("./MoodCanvas.jsx"));

export default function Mood(props) {
  const [client, setClient] = useState(false);
  useEffect(() => { setClient(true); }, []);
  if (!client) return null;
  return (
    <Suspense fallback={<div className="h-full w-full" />}>
      <MoodCanvas {...props} />
    </Suspense>
  );
}
