"use client";

// Storyboard (package 05): the list of films (01, empty 13) and one film with its
// Moodboard and Storyboard tabs, and the working screens of a shot or a group.
// Any order: every tab and screen is reachable at any time; nothing is required.
import { useEffect, useState } from "react";
import { Plus, CaretLeft, DotsThree, MagnifyingGlass, FilmSlate } from "@phosphor-icons/react";
import { dzThumb } from "../api.js";
import { useDzContext } from "../dzContext.js";
import { DropdownMenuParts, cn } from "../ui/index.js";
import { useFilm, useFilms, dzStoryboards } from "../dzFilm.js";
import Board from "./storyboard/Board.jsx";
import Work from "./storyboard/Work.jsx";
import Mood from "./storyboard/Mood.jsx";
import Entry from "./storyboard/Entry.jsx";
import { EmptyState, InlineText } from "./storyboard/parts.jsx";
import { useStoryboardContext } from "./storyboard/assistant.js";
import { dzSetStudioState } from "../dzStudioState.js";

const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator } = DropdownMenuParts;
const notify = (detail) => window.dispatchEvent(new CustomEvent("dz:notify", { detail }));

// Where the user is, kept in the address (#film=…&tab=…&shot=… / &group=…): a refresh comes back here.
function readHash() {
  const p = new URLSearchParams((typeof window !== "undefined" ? window.location.hash : "").replace(/^#/, ""));
  return { film: p.get("film") || null, tab: p.get("tab") === "mood" ? "mood" : "board", shot: p.get("shot") || null, group: p.get("group") || null };
}
function writeHash(s) {
  const p = new URLSearchParams();
  if (s.film) p.set("film", s.film);
  if (s.film && s.tab) p.set("tab", s.tab);
  if (s.shot) p.set("shot", s.shot);
  if (s.group) p.set("group", s.group);
  const h = p.toString();
  const url = `${window.location.pathname}${window.location.search}${h ? `#${h}` : ""}`;
  if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, "", url);
}

const ago = (t) => {
  const d = Date.now() - t;
  if (d < 60_000) return "just now";
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} h ago`;
  if (d < 2 * 86_400_000) return "yesterday";
  return new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

function FilmCard({ f, onOpen }) {
  const [a, b, c] = f.covers || [];
  const pct = f.shots ? Math.round((f.videos / f.shots) * 100) : 0;
  return (
    <button type="button" onClick={onOpen} className="group overflow-hidden rounded-xl border border-border bg-card text-left transition-colors duration-state hover:border-input">
      <div className="grid h-[156px] grid-cols-[2fr_1fr] grid-rows-2 gap-px bg-border">
        <span className="row-span-2 overflow-hidden bg-muted">{a ? <img src={dzThumb(a, 640)} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-muted-foreground"><FilmSlate size={24} /></span>}</span>
        <span className="overflow-hidden bg-muted">{b && <img src={dzThumb(b, 320)} alt="" className="h-full w-full object-cover" />}</span>
        <span className="overflow-hidden bg-muted">{c && <img src={dzThumb(c, 320)} alt="" className="h-full w-full object-cover" />}</span>
      </div>
      <div className="p-3">
        <p className="truncate text-base font-semibold">{f.name}</p>
        <p className="mt-0.5 truncate text-sm text-muted-foreground">{f.scenes} scene{f.scenes === 1 ? "" : "s"} · {f.shots} shot{f.shots === 1 ? "" : "s"} · {ago(f.updated_at)}</p>
        {f.shots > 0 && (
          <>
            <span className="mt-2.5 block h-[3px] overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-foreground" style={{ width: `${pct}%` }} /></span>
            <p className="mt-1.5 text-sm text-muted-foreground">{f.videos} of {f.shots} videos ready</p>
          </>
        )}
      </div>
    </button>
  );
}

function FilmList({ onOpen, onNew, readOnly }) {
  const ctx = useDzContext();
  const { films } = useFilms(ctx.project?.id);
  const [q, setQ] = useState("");
  const shown = (films || []).filter((f) => !q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="custom-scrollbar h-full overflow-y-auto px-6 pb-10">
      <div className="flex items-center gap-3 pb-4 pt-6">
        <h1 className="text-xl font-semibold">Storyboard</h1>
        {films?.length > 0 && <span className="truncate text-sm text-muted-foreground">Plan a whole video: script, scenes, shots, cut</span>}
        {films?.length > 0 && !readOnly && <button type="button" onClick={onNew} className="ml-auto flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-base font-medium text-primary-foreground hover:bg-primary-hover"><Plus size={16} /> New storyboard</button>}
      </div>
      {films === null ? null : films.length === 0 ? (
        <EmptyState icon={FilmSlate} title="No storyboards yet" text="Plan a video before you pay for it: references, script, shots, a frame for each one — then the videos." className="pt-28">
          {!readOnly && <button type="button" onClick={onNew} className="flex h-8 items-center gap-2 rounded-md bg-primary px-3 text-base font-medium text-primary-foreground hover:bg-primary-hover"><Plus size={14} /> New storyboard</button>}
        </EmptyState>
      ) : (
        <>
          <div className="mb-4 flex h-9 w-[300px] items-center gap-2 rounded-md border border-input px-3">
            <MagnifyingGlass size={16} className="text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search storyboards" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground" />
          </div>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-4">
            {shown.map((f) => <FilmCard key={f.id} f={f} onOpen={() => onOpen(f.id)} />)}
          </div>
        </>
      )}
    </div>
  );
}

function FilmView({ id, nav, setNav, studioProps, onBack }) {
  const { film, error, edit, media, reload } = useFilm(id);
  const ctx = useDzContext();
  const [layer, setLayer] = useState("references");
  const [refView, setRefView] = useState("all");
  const [initial, setInitial] = useState(null); // what a working screen starts from (Make a video…)
  const target = nav.shot ? { kind: "shot", id: nav.shot } : nav.group ? { kind: "group", id: nav.group } : null;
  useStoryboardContext(film, nav, target);
  useEffect(() => { setInitial(null); }, [nav.shot, nav.group]);

  if (error) {
    return (
      <div className="px-6 pt-6">
        <button type="button" onClick={onBack} className="flex h-8 items-center gap-1 rounded-md px-2 text-base text-muted-foreground hover:bg-accent hover:text-foreground"><CaretLeft size={16} /> Storyboards</button>
        <EmptyState icon={FilmSlate} title="This storyboard can't be opened" text={error.message} />
      </div>
    );
  }
  if (!film) return null;
  if (target) {
    return (
      <Work film={film} edit={edit} media={media} target={target} studioProps={studioProps} initial={initial} setInitial={setInitial}
        onBack={() => setNav({ tab: nav.tab })} onNav={(shot) => setNav({ tab: nav.tab, shot })} />
    );
  }
  const refsN = (film.mood?.items || []).filter((x) => x.type === "image" || x.type === "video").length;
  const approved = film.shots.filter((s) => (film.media?.[s.id]?.approved || []).length).length;
  const meta = nav.tab === "mood"
    ? [refsN ? `${refsN} reference${refsN === 1 ? "" : "s"}` : null, ctx.project ? ctx.project.name : "Personal"]
    : [film.scenes.length ? `${film.scenes.length} scene${film.scenes.length === 1 ? "" : "s"}` : null, film.shots.length ? `${film.shots.length} shot${film.shots.length === 1 ? "" : "s"}` : null, layer === "generated" && approved ? `${approved} approved` : null, ctx.project ? ctx.project.name : "Personal"];
  const remove = async () => {
    if (!window.confirm(`Delete “${film.name}”? What was generated for it stays in your library.`)) return;
    try { await dzStoryboards.remove(film.id); onBack(); } catch (e) { notify({ type: "error", title: "Storyboard", message: e.message }); }
  };
  return (
    <div className="relative flex h-full flex-col">
      <div className="flex flex-shrink-0 items-center gap-2 px-6 pt-5">
        <button type="button" onClick={onBack} aria-label="All storyboards" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><CaretLeft size={16} /></button>
        <InlineText value={film.name} onChange={(v) => v && edit((f) => ({ ...f, name: v }))} placeholder="Untitled film" className="text-xl font-semibold" maxLength={80} />
        <span className="min-w-0 truncate text-sm text-muted-foreground">{meta.filter(Boolean).join(" · ")}</span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild><button type="button" aria-label="Storyboard menu" className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><DotsThree size={18} weight="bold" /></button></DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => window.open(dzStoryboards.printUrl(film.id), "_blank", "noopener")}>Print or save as PDF</DropdownMenuItem>
            <DropdownMenuItem onSelect={reload}>Reload</DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={remove}>Delete storyboard</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <div className="mt-3 flex h-10 flex-shrink-0 items-end gap-6 border-b border-border px-6" role="tablist" aria-label="Film">
        {[["mood", "Moodboard"], ["board", "Storyboard"]].map(([v, l]) => (
          <button key={v} type="button" role="tab" aria-selected={nav.tab === v} onClick={() => setNav({ tab: v })}
            className={cn("-mb-px h-10 border-b-2 text-base font-medium transition-colors duration-state", nav.tab === v ? "border-foreground text-foreground" : "border-transparent text-muted-foreground hover:text-foreground")}>{l}</button>
        ))}
      </div>
      {nav.tab === "mood" ? (
        <div className="relative min-h-0 flex-1"><Mood film={film} edit={edit} onOpenGroup={(group) => setNav({ tab: "mood", group })} /></div>
      ) : (
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6" id="dz-film-scroll">
          <Board film={film} edit={edit} onOpenShot={(shot) => setNav({ tab: "board", shot })} layer={layer} setLayer={setLayer} refView={refView} setRefView={setRefView} />
        </div>
      )}
    </div>
  );
}

export default function DzStoryboard(props) {
  const ctx = useDzContext();
  const readOnly = Boolean(ctx.project?.archived);
  const [nav, setNavState] = useState(() => readHash());
  const [entry, setEntry] = useState(false);
  // The place changed (another project): back to its list.
  const place = ctx.project?.id || "";
  const [lastPlace, setLastPlace] = useState(place);
  useEffect(() => { if (place !== lastPlace) { setLastPlace(place); setNavState({ film: null, tab: "board", shot: null, group: null }); } }, [place, lastPlace]);
  useEffect(() => { writeHash(nav); }, [nav]);
  // The film list: the assistant has no prompt to write into.
  useEffect(() => { if (!nav.film) dzSetStudioState("director", { model: null, prompt: "", writable: false, sees: "" }); }, [nav.film]);
  useEffect(() => {
    const on = () => setNavState(readHash());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const setNav = (s) => setNavState((cur) => ({ film: cur.film, tab: s.tab || cur.tab, shot: s.shot || null, group: s.group || null }));
  const open = (film, tab = "board") => setNavState({ film, tab, shot: null, group: null });

  // A new film (phase D: the entry window; "Skip, open empty" opens its empty Moodboard).
  const created = (film, tab) => { setEntry(false); open(film.id, tab || "mood"); };

  return (
    <div className="relative h-full w-full bg-background">
      {nav.film ? (
        <FilmView key={nav.film} id={nav.film} nav={nav} setNav={setNav} studioProps={props} onBack={() => setNavState({ film: null, tab: "board", shot: null, group: null })} />
      ) : (
        <FilmList onOpen={(id) => open(id)} onNew={() => setEntry(true)} readOnly={readOnly} />
      )}
      {entry && <Entry onClose={() => setEntry(false)} onCreated={created} />}
    </div>
  );
}
