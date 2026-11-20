"use client";

// Working screen (package 05, §4.4): the existing Image tool — or the Video tool —
// opened for one shot (10, 11) or one Moodboard group (05). Its composer opens empty;
// what is generated here returns here (the target is in the job's meta).
import { useMemo, useState } from "react";
import { CaretLeft, CaretUp, CaretDown, Plus, Check, ArrowSquareUp, VideoCamera, Play, UploadSimple, ImageSquare, Shapes, FilmStrip } from "@phosphor-icons/react";
import DzStudio from "../DzStudio.jsx";
import { DZ_SEND_EVENT } from "../DzCreateStudio.jsx";
import { dzThumb, uploadFile } from "../../api.js";
import { useDzHistory } from "../../dzLibrary.js";
import { useDzElements } from "../DzElements.jsx";
import { dzOpenUpscale, dzOpenVideoUpscale } from "../../dzCatalog.js";
import { DropdownMenuParts, cn } from "../../ui/index.js";
import { numbered, shotState, frameRefs, addToFrame, newItemId, isVideoUrl, inFrame } from "../../dzFilm.js";
import { RefPicker, EmptyState, mediaUrl } from "./parts.jsx";
import { ApprovedBadge } from "./Board.jsx";
import PlayBetween from "./PlayBetween.jsx";

const { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } = DropdownMenuParts;
const H = 88;

function RefTile({ r, onClick }) {
  const w = r.w && r.h ? Math.max(40, Math.round((H * r.w) / r.h)) : 132;
  return (
    <button type="button" onClick={onClick} title="Attach to the composer" className="relative flex-shrink-0 overflow-hidden rounded-md bg-muted ring-signal transition-shadow duration-state hover:ring-2 focus-visible:ring-2" style={{ width: w, height: H }}>
      {r.kind === "video" ? <video src={r.url} poster={dzThumb(r.url, 320)} muted playsInline preload="metadata" className="h-full w-full object-cover" />
        : <img src={dzThumb(r.url, 320)} alt="" className="h-full w-full object-cover" loading="lazy" />}
      {r.kind === "video" && <span className="absolute bottom-1 left-1 flex h-5 w-5 items-center justify-center rounded-full bg-overlay/60 text-overlay-foreground"><Play size={10} weight="fill" /></span>}
    </button>
  );
}

function ElementCard({ el, onClick }) {
  const pic = el.views?.[0]?.url || el.images?.[0];
  return (
    <button type="button" onClick={onClick} title={`Attach @${el.tag}`} className="flex flex-shrink-0 items-center gap-3 rounded-lg border border-border bg-card p-1.5 pr-4 text-left transition-colors duration-state hover:bg-accent" style={{ height: H }}>
      <span className="h-[74px] w-[74px] flex-shrink-0 overflow-hidden rounded-md bg-muted">{pic && <img src={dzThumb(pic, 160)} alt="" className="h-full w-full object-cover" />}</span>
      <span className="min-w-0">
        <span className="block truncate text-base font-medium">{el.name}</span>
        <span className="block truncate text-sm text-muted-foreground">Element · {(el.views || []).length} view{(el.views || []).length === 1 ? "" : "s"}{(el.videos || []).length ? ` · ${el.videos.length} video${el.videos.length === 1 ? "" : "s"}` : ""}</span>
      </span>
    </button>
  );
}

export default function Work({ film, edit, media, target, onBack, onNav, studioProps, initial, setInitial }) {
  const isShot = target.kind === "shot";
  const groups = useMemo(() => numbered(film), [film]);
  const flat = groups.flatMap((g, si) => g.shots.map((s) => ({ ...s, sceneN: si + 1, sceneName: g.scene.name })));
  const shotIdx = isShot ? flat.findIndex((s) => s.id === target.id) : -1;
  const shot = isShot ? flat[shotIdx] : null;
  const frame = !isShot ? (film.mood?.items || []).find((x) => x.id === target.id && x.type === "frame") : null;
  const [cmode, setCmode] = useState(initial?.mode || "image");
  const [seq, setSeq] = useState(0); // a new composer each time it switches (it opens empty)
  const [picker, setPicker] = useState(false);
  const [play, setPlay] = useState(null);
  const [readyPicker, setReadyPicker] = useState(false);
  const fileInput = useMemo(() => ({ current: null }), []);
  const els = useDzElements();
  const placeElements = (film.project_id ? els.project : els.library).filter((e) => e.status !== "draft");
  const key = `${film.id}:${target.id}`;
  const liked = useDzHistory({ target: key, project: film.project_id || "none", liked: true }, { limit: 60 });

  const refs = isShot ? (shot?.refs || []) : frameRefs(film.mood, target.id);
  const st = isShot && shot ? shotState(film, shot) : null;
  const m = film.media?.[target.id] || { frames: [], videos: [], approved: [] };
  const approved = useMemo(() => new Set(m.approved || []), [m.approved]);
  const hasVideo = (m.videos || []).some((x) => !x.gone);
  const name = isShot ? `Shot ${shot?.n ?? ""}` : frame?.name || "Group";

  if ((isShot && !shot) || (!isShot && !frame)) {
    return (
      <div className="px-6 pt-6">
        <button type="button" onClick={onBack} className="flex h-8 items-center gap-1 rounded-md px-2 text-base text-muted-foreground hover:bg-accent hover:text-foreground"><CaretLeft size={16} /> Back</button>
        <EmptyState title="This shot or group is gone" text="Someone removed it, or it was deleted. What was generated for it stays in your library." />
      </div>
    );
  }

  const attach = (r) => window.dispatchEvent(new CustomEvent(DZ_SEND_EVENT, { detail: { to: `target:${key}`, url: r.url, role: r.kind === "video" ? "video" : "reference" } }));
  const attachElement = (el) => window.dispatchEvent(new CustomEvent("dz:add-element", { detail: { to: `target:${key}`, element: el } }));
  const switchTo = (kind, init = {}) => { setInitial({ ...init, mode: kind }); setCmode(kind); setSeq((n) => n + 1); };
  const setRefs = (fn) => {
    if (isShot) edit((f) => ({ ...f, shots: f.shots.map((s) => (s.id === target.id ? { ...s, refs: typeof fn === "function" ? fn(s.refs || []) : fn } : s)) }));
    else {
      // A group's references are the pictures inside its frame on the Moodboard.
      const before = frameRefs(film.mood, target.id);
      const next = typeof fn === "function" ? fn(before) : fn;
      const gone = new Set(before.filter((r) => !next.some((x) => x.url === r.url)).map((r) => r.url));
      edit((f) => {
        // Only the copies inside this frame leave (the same picture can be in another group).
        const fr = (f.mood?.items || []).find((x) => x.id === target.id);
        let mood = { ...f.mood, items: (f.mood?.items || []).filter((it) => !((it.type === "image" || it.type === "video") && gone.has(it.url) && fr && inFrame(fr, it))) };
        mood = addToFrame(mood, target.id, next.filter((r) => !before.some((x) => x.url === r.url)), newItemId);
        // Sizes that arrived later.
        mood = { ...mood, items: mood.items.map((it) => { const r = next.find((x) => x.url === it.url && x.w && x.h); return r && (it.type === "image" || it.type === "video") && Math.abs(it.w / it.h - r.w / r.h) > 0.02 ? { ...it, w: Math.round((it.h * r.w) / r.h) } : it; }) };
        return { ...f, mood };
      });
    }
  };

  // A ready picture for the shot, without generating (18): upload, or one from the library.
  const addReady = async (files) => {
    for (const f of files) {
      try { const url = mediaUrl(await uploadFile("session", f)); await media({ target: target.id, op: "add", url, kind: f.type.startsWith("video/") ? "video" : "image" }); } catch (e) { window.dispatchEvent(new CustomEvent("dz:notify", { detail: { type: "error", title: "Upload", message: String(e?.message || e) } })); }
    }
  };

  const prev = isShot ? flat[shotIdx - 1] : null;
  const next = isShot ? flat[shotIdx + 1] : null;
  const where = isShot ? [film.name, `Scene ${shot.sceneN}${shot.sceneName ? ` · ${shot.sceneName}` : ""}`, shot.note || "no note"].join(" · ") : `${film.name} · group on the Moodboard`;

  const header = (
    <div className="flex items-center gap-2 pb-3">
      <button type="button" onClick={onBack} aria-label="Back" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><CaretLeft size={16} /></button>
      <h1 className="flex-shrink-0 text-xl font-semibold">{name}</h1>
      <span className="min-w-0 truncate text-sm text-muted-foreground">{where}</span>
      <span className="ml-auto flex flex-shrink-0 items-center gap-2">
        {/* The composer is the Image tool or the Video tool (one at a time; it opens empty). */}
        <span className="flex h-8 items-center rounded-md bg-muted p-0.5" role="tablist" aria-label="Composer">
          {[["image", "Image"], ["video", "Video"]].map(([v, l]) => (
            <button key={v} type="button" role="tab" aria-selected={cmode === v} onClick={() => cmode !== v && switchTo(v)}
              className={cn("h-7 rounded-[6px] px-3 text-sm font-medium transition-colors duration-state", cmode === v ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}>{l}</button>
          ))}
        </span>
        {!isShot && <GroupActions film={film} groupName={name} liked={liked.items.filter((i) => i.url)} placeElements={placeElements} />}
        {isShot && (
          <>
            <button type="button" aria-label="Previous shot" disabled={!prev} onClick={() => onNav(prev.id)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"><CaretUp size={16} /></button>
            <button type="button" aria-label="Next shot" disabled={!next} onClick={() => onNav(next.id)} className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30"><CaretDown size={16} /></button>
          </>
        )}
      </span>
    </div>
  );

  const elementsHere = isShot ? placeElements : [];
  const nothing = !refs.length && !elementsHere.length;
  const above = (
    <div className="pb-4">
      <p className="mb-2 flex items-baseline gap-2"><span className="text-overline uppercase text-muted-foreground">{isShot ? "For this shot" : "References of this group"}</span>
        <span className="text-sm text-muted-foreground">{nothing ? "nothing yet" : isShot ? `${refs.length} reference${refs.length === 1 ? "" : "s"}${elementsHere.length ? ` and ${elementsHere.length} element${elementsHere.length === 1 ? "" : "s"}` : ""} · click to attach` : `${refs.length} · click to attach`}</span></p>
      {nothing ? (
        <button type="button" onClick={() => setPicker(true)} className="flex h-[88px] w-[260px] items-center justify-center gap-2 rounded-lg border border-dashed border-input text-sm text-muted-foreground hover:bg-accent/40 hover:text-foreground"><Plus size={14} /> Add references{isShot ? " or elements" : ""}</button>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {refs.map((r) => <RefTile key={r.url} r={r} onClick={() => attach(r)} />)}
          {elementsHere.map((el) => <ElementCard key={el.id} el={el} onClick={() => attachElement(el)} />)}
          <button type="button" onClick={() => setPicker(true)} aria-label="Add references" className="flex flex-shrink-0 items-center justify-center rounded-lg border border-dashed border-input text-muted-foreground hover:bg-accent hover:text-foreground" style={{ width: 88, height: H }}><Plus size={16} /></button>
        </div>
      )}
    </div>
  );

  // Ready pictures added to the shot (not generations): shown with the gallery.
  const extra = [...(m.frames || []), ...(m.videos || [])].filter((x) => x.own && !x.gone)
    .map((x) => ({ id: `own:${x.url}`, url: x.url, kind: isVideoUrl(x.url) ? "video" : "image", status: "completed", own: true, created_at: x.at, meta: {}, outputs: [x.url] }));

  const empty = isShot ? (
    refs.length || elementsHere.length ? (
      <EmptyState icon={ImageSquare} title="No pictures for this shot yet" text="Attach what you need from the row above, write the prompt below and press Generate. Or bring a ready picture.">
        <button type="button" onClick={() => fileInput.current?.click()} className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-base font-medium hover:bg-accent"><UploadSimple size={14} /> Upload a picture</button>
        <button type="button" onClick={() => setReadyPicker(true)} className="flex h-8 items-center gap-2 rounded-md border border-border px-3 text-base font-medium hover:bg-accent"><ImageSquare size={14} /> Pick from my generations</button>
      </EmptyState>
    ) : (
      <EmptyState icon={ImageSquare} title="An empty shot" text="No references, no pictures. Write a prompt below and generate from words alone, or add references first." />
    )
  ) : (
    <EmptyState icon={ImageSquare} title="Nothing generated in this group yet" text="Click a reference above to attach it, describe the picture below and press Generate. Results stay in this group." />
  );

  const tabs = isShot
    ? [["all", "All"], ...(hasVideo ? [["videos", "Videos"], ["pictures", "Pictures"]] : []), ["liked", "Liked"], ["approved", "Approved"], ["upscaled", "Upscaled"]]
    : [["all", "All"], ["liked", "Liked"], ["upscaled", "Upscaled"]];

  const approve = async (items) => {
    const urls = items.map((i) => i.url).filter(Boolean);
    const allOn = urls.every((u) => approved.has(u));
    for (const u of urls) await media({ target: target.id, op: allOn ? "unapprove" : "approve", url: u });
  };
  const neighbours = () => ({ prev, next, film });
  const selectionActions = (chosen, clear) => {
    const n = chosen.length;
    const one = n === 1 ? chosen[0] : null;
    const allOn = n > 0 && chosen.every((i) => approved.has(i.url));
    const Btn = ({ icon: Icon, children, onClick, disabled, active }) => (
      <button type="button" disabled={disabled} onClick={onClick}
        className={cn("flex h-8 items-center gap-1.5 rounded-md px-2.5 text-base font-medium transition-colors duration-state disabled:opacity-40", active ? "bg-primary text-primary-foreground hover:bg-primary-hover" : "border border-border hover:bg-accent")}><Icon size={15} />{children}</button>
    );
    return (
      <span className="flex items-center gap-1.5">
        {isShot && <Btn icon={Check} active={!allOn} disabled={!n} onClick={async () => { await approve(chosen); clear(); }}>{allOn ? "Unapprove" : "Approve"}</Btn>}
        {one?.kind === "video" && isShot && <Btn icon={Play} onClick={() => setPlay(one)}>Play between shots {prev ? prev.n : "–"} and {next ? next.n : "–"}</Btn>}
        <Btn icon={ArrowSquareUp} disabled={!one} onClick={() => (one.kind === "video" ? dzOpenVideoUpscale(one.url) : dzOpenUpscale(one.url, { target: { board: film.id, id: target.id, kind: target.kind, step: "frame" } }))}>Upscale</Btn>
        {one && one.kind !== "video" && <Btn icon={VideoCamera} onClick={() => { clear(); switchTo("video", { start: one.url }); }}>Make a video</Btn>}
      </span>
    );
  };

  const studioTarget = {
    key, board: film.id, id: target.id, kind: target.kind, name, project: film.project_id || null,
    header, above, empty, tabs, extra,
    approved,
    badge: isShot ? (item) => (approved.has(item.url) ? <ApprovedBadge /> : null) : null,
    selectionActions,
    switchTo,
    removeOwn: (item) => media({ target: target.id, op: "remove", url: item.url }),
    initial,
    // The assistant's "Sees:" line (§4.6).
    sees: isShot ? [`Shot ${shot.n}`, shot.note ? "its note" : null, refs.length ? `${refs.length} reference${refs.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · ")
      : [name, refs.length ? `${refs.length} reference${refs.length === 1 ? "" : "s"}` : null].filter(Boolean).join(" · "),
    seesFull: isShot ? `Film “${film.name}”, scene ${shot.sceneN}${shot.sceneName ? ` “${shot.sceneName}”` : ""}, shot ${shot.n}${shot.note ? ` — note: ${shot.note}` : ""}. ${refs.length} reference picture(s) and ${elementsHere.length} element(s) of this place are offered for it; ${approved.size} approved.`
      : `Film “${film.name}”, Moodboard group “${name}” with ${refs.length} reference picture(s).`,
  };

  return (
    <div className="relative h-full w-full">
      <input ref={(el) => { fileInput.current = el; }} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => { const files = [...(e.target.files || [])]; e.target.value = ""; if (files.length) addReady(files); }} />
      <DzStudio key={`${key}:${cmode}:${seq}`} {...studioProps} mode={cmode} target={studioTarget} />
      <RefPicker open={picker} onClose={() => setPicker(false)} refs={refs} onChange={setRefs} title={isShot ? "References of this shot" : "References of this group"} />
      <RefPicker open={readyPicker} onClose={() => setReadyPicker(false)} refs={[]} onChange={() => {}} title="A ready picture for this shot"
        onPickNew={async (list) => { for (const r of list) await media({ target: target.id, op: "add", url: r.url, kind: r.kind }); }} />
      {play && <PlayBetween take={play} {...neighbours()} onClose={() => setPlay(null)} />}
    </div>
  );
}

// Group only (§4.4): Create element from N liked (the existing dialog, the liked ones as views)
// and Generate video element (the existing dialog, for an element of this place). Hidden until something is liked.
function GroupActions({ groupName, liked, placeElements }) {
  if (!liked.length) return null;
  const withViews = placeElements.filter((e) => (e.views || []).length && (e.videos || []).length < 8);
  return (
    <>
      {withViews.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" className="flex h-8 items-center gap-1.5 rounded-md border border-border px-3 text-base font-medium hover:bg-accent"><FilmStrip size={15} /> Generate video element</button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="max-h-[50vh] overflow-y-auto">
            {withViews.map((el) => (
              <DropdownMenuItem key={el.id} onSelect={() => window.dispatchEvent(new CustomEvent("dz:video-element", { detail: { element: el } }))}>{el.name} <span className="ml-auto pl-3 text-muted-foreground">@{el.tag}</span></DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <button type="button" onClick={() => window.dispatchEvent(new CustomEvent("dz:to-element", { detail: { items: liked, name: groupName } }))}
        className="flex h-8 items-center gap-1.5 rounded-md bg-primary px-3 text-base font-medium text-primary-foreground hover:bg-primary-hover"><Shapes size={15} /> Create element from {liked.length} liked</button>
    </>
  );
}
