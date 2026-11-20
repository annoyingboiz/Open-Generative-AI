// The assistant drawer on the Storyboard tab (package 05, §4.6): it sees what is open.
// A working screen reports itself (its composer); the overview screens report here.
import { useEffect } from "react";
import { dzSetStudioState } from "../../dzStudioState.js";

let moodSelection = 0;
let sceneSelection = null;
let lastFilm = null;
let lastTab = null;
const report = () => {
  if (!lastFilm) { dzSetStudioState("director", { model: null, prompt: "", writable: false }); return; }
  const f = lastFilm;
  const sees = lastTab === "mood"
    ? ["Moodboard", moodSelection ? `${moodSelection} selected` : `${(f.mood?.items || []).filter((x) => x.type === "image" || x.type === "video").length} pictures`].join(" · ")
    : sceneSelection ? `Scene ${sceneSelection.n}${sceneSelection.name ? ` · ${sceneSelection.name}` : ""} · ${sceneSelection.shots} shots` : `Storyboard · ${f.scenes.length} scenes · ${f.shots.length} shots`;
  dzSetStudioState("director", { model: null, prompt: "", writable: false, sees: `${sees}`, seesFull: `Storyboard “${f.name}”. ${sees}.${f.note ? ` Note: ${f.note}` : ""}${f.scene ? ` The brief (start): ${String(f.scene).slice(0, 1500)}` : ""}` });
};
export function setMoodSelection(n) { moodSelection = n; report(); }
export function setSceneSelection(s) { sceneSelection = s; report(); }

export function useStoryboardContext(film, nav, target) {
  useEffect(() => {
    if (target) return; // the working screen's composer reports
    lastFilm = film || null;
    lastTab = nav.tab;
    report();
  }, [film, nav.tab, target?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { lastFilm = null; dzSetStudioState("director", { model: null, prompt: "", writable: false }); }, []);
}
