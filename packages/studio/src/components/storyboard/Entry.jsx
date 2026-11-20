"use client";

// New film (package 05, §4.2): one window for anything — an idea, a script, pictures,
// video, documents, any mix, or nothing (02). Start sorts it: pictures and video go to
// the Moodboard into one group named "New"; a script becomes scenes and shots (their
// texts are notes); a brief is kept with the film; the idea becomes the film note.
// The sorting is one text-model call with its price on the button; it never generates
// pictures or video. One kind of result opens its tab; several show what went where (03).
import { useEffect, useRef, useState } from "react";
import { Plus, CaretLeft, X, FileText, Images, TextAlignLeft, Note, ArrowRight, Spinner as SpinIcon, Warning } from "@phosphor-icons/react";
import { uploadFile } from "../../api.js";
import { useDzContext } from "../../dzContext.js";
import { cn } from "../../ui/index.js";
import { dzStoryboards, newSceneId, newShotId, newItemId, addToFrame, sizeOf } from "../../dzFilm.js";
import { docKind, readDoc, wordsIn } from "../../docText.js";
import { fmtUsd } from "../DzCreateStudio.jsx";
import { mediaUrl } from "./parts.jsx";

const KEPT_MAX = 200_000; // the server's limit for what is kept with the film
const notify = (detail) => window.dispatchEvent(new CustomEvent("dz:notify", { detail }));
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
let seq = 0;
const ext = (name) => (/\.([a-z0-9]+)$/i.exec(name || "")?.[1] || "").toLowerCase();
const dur = (s) => (Number.isFinite(s) ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}` : "");

function Chip({ thumb, icon: Icon, title, sub, warn, onRemove }) {
  return (
    <div className="group/c relative flex h-11 max-w-[260px] flex-shrink-0 items-center gap-2.5 rounded-lg border border-border bg-background pl-1.5 pr-3">
      {thumb ? <img src={thumb} alt="" className="h-8 w-8 flex-shrink-0 rounded object-cover" />
        : <span className={cn("flex h-8 w-8 flex-shrink-0 items-center justify-center rounded bg-muted", warn ? "text-warning" : "text-muted-foreground")}>{warn ? <Warning size={14} /> : <Icon size={14} />}</span>}
      <span className="min-w-0">
        <span className="block truncate text-sm font-medium">{title}</span>
        <span className={cn("block truncate text-xs", warn ? "text-warning" : "text-muted-foreground")}>{sub}</span>
      </span>
      <button type="button" aria-label={`Remove ${title}`} onClick={onRemove}
        className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full border border-border bg-popover text-muted-foreground opacity-0 shadow-popover transition-opacity duration-state hover:text-foreground group-hover/c:opacity-100 focus:opacity-100"><X size={10} /></button>
    </div>
  );
}

function Row({ icon: Icon, title, sub, action, onAction, quiet }) {
  return (
    <div className="flex items-center gap-4 border-b border-border px-4 py-3.5 last:border-b-0">
      <Icon size={16} className="flex-shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <p className="text-base font-medium">{title}</p>
        {sub && <p className="text-sm text-muted-foreground">{sub}</p>}
      </div>
      {action && (
        <button type="button" onClick={onAction}
          className={cn("flex h-8 flex-shrink-0 items-center gap-1.5 rounded-md px-3 text-base font-medium", quiet ? "text-muted-foreground hover:bg-accent hover:text-foreground" : "border border-border hover:bg-accent")}>
          {!quiet && <ArrowRight size={14} />} {action}
        </button>
      )}
    </div>
  );
}

export default function Entry({ onClose, onCreated }) {
  const ctx = useDzContext();
  const [text, setText] = useState("");
  const [files, setFiles] = useState([]); // { id, file, kind, thumb?, duration?, doc? }
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState("");
  const [failed, setFailed] = useState("");
  const [quote, setQuote] = useState(null);
  const [result, setResult] = useState(null);
  const input = useRef(null);
  const area = useRef(null);
  useEffect(() => { area.current?.focus(); }, []);
  // Object URLs of the picture thumbnails are released with the window.
  const urls = useRef([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  // Work already done survives a failed upload or save: a retry neither buys the sort again nor re-uploads.
  const sortCache = useRef({ key: "", value: null });
  const uploaded = useRef(new Map()); // file item id -> ref
  const MAX_DOCS = 8;

  const add = (list) => {
    if (busy) return;
    let docsSoFar = files.filter((f) => f.kind !== "image" && f.kind !== "video").length;
    const made = [...list].map((file) => {
      const kind = docKind(file);
      const it = { id: (seq += 1), file, kind };
      if (kind === "image" || kind === "video") { it.thumb = URL.createObjectURL(file); urls.current.push(it.thumb); }
      else if ((docsSoFar += 1) > MAX_DOCS) it.doc = { error: `Up to ${MAX_DOCS} documents at a time` };
      return it;
    });
    if (!made.length) return;
    setFiles((cur) => [...cur, ...made]);
    setFailed("");
    for (const it of made) {
      if (it.kind === "video") {
        const v = document.createElement("video");
        v.preload = "metadata";
        v.onloadedmetadata = () => setFiles((cur) => cur.map((x) => (x.id === it.id ? { ...x, duration: v.duration } : x)));
        v.src = it.thumb;
      } else if (it.kind !== "image" && !it.doc) {
        readDoc(it.file).then((doc) => setFiles((cur) => cur.map((x) => (x.id === it.id ? { ...x, doc } : x))));
      }
    }
  };
  const remove = (ids) => { if (!busy) setFiles((cur) => cur.filter((x) => !ids.includes(x.id))); };

  const pictures = files.filter((f) => f.kind === "image");
  const videos = files.filter((f) => f.kind === "video");
  const docs = files.filter((f) => f.kind !== "image" && f.kind !== "video");
  const readDocs = docs.filter((d) => d.doc?.text);
  const reading = docs.some((d) => !d.doc);
  const toSort = { text, docs: readDocs.map((d) => ({ name: d.file.name, text: d.doc.text })) };
  const inputKey = JSON.stringify(toSort);
  const needsModel = Boolean(text.trim() || readDocs.length);
  const nothing = !text.trim() && !files.length;

  // The price of the sorting call, asked again shortly after the text or documents change.
  // Start waits for the price of exactly this input; the call then uses the quoted model.
  useEffect(() => {
    setQuote(null);
    if (!needsModel) return undefined;
    let live = true;
    const key = inputKey;
    const t = setTimeout(() => {
      dzStoryboards.sortQuote(toSort).then((q) => { if (live) setQuote({ ...q, key }); }).catch((e) => { if (live) setQuote({ key, error: e.message }); });
    }, 400);
    return () => { live = false; clearTimeout(t); };
  }, [inputKey, needsModel]); // eslint-disable-line react-hooks/exhaustive-deps
  const quoted = !needsModel || (quote && quote.key === inputKey) || sortCache.current.key === inputKey;
  const priceLabel = !needsModel || !quote || quote.error || quote.key !== inputKey ? "" : quote.free || quote.usd === 0 ? "free" : Number.isFinite(quote.usd) ? (quote.usd < 0.001 ? "< $0.001" : `≈ ${fmtUsd(quote.usd)}`) : "";
  const tooLong = Boolean(quote?.tooLong && quote.key === inputKey);

  // sortIt=false: keep everything as given (typed text = film note, documents = brief), no model call.
  const start = async ({ sortIt = true } = {}) => {
    if (busy) return;
    setFailed("");
    try {
      let sorted = null;
      if (needsModel && sortIt) {
        if (sortCache.current.key === inputKey) sorted = sortCache.current.value;
        else {
          setBusy("Sorting…");
          try { sorted = await dzStoryboards.sort({ ...toSort, llm: quote?.model || undefined }); } catch (e) { setFailed(e.message); setBusy(""); return; }
          sortCache.current = { key: inputKey, value: sorted };
        }
      }
      const media = [...pictures, ...videos];
      const refs = [];
      for (let i = 0; i < media.length; i += 1) {
        setBusy(`Uploading ${i + 1} of ${media.length}…`);
        const it = media[i];
        if (!uploaded.current.has(it.id)) {
          const url = mediaUrl(await uploadFile("session", it.file));
          const kind = it.kind === "video" ? "video" : "image";
          const { w, h } = await sizeOf(url, kind);
          uploaded.current.set(it.id, { url, kind, w, h, name: it.file.name.slice(0, 80) });
        }
        refs.push(uploaded.current.get(it.id));
      }
      setBusy("Saving…");
      let mood = { items: [] };
      if (refs.length) {
        const g = { id: newItemId("frame"), type: "frame", x: 0, y: 0, w: 640, h: 240, name: "New", color: "orange" };
        mood = addToFrame({ items: [g] }, g.id, refs, newItemId);
      }
      const scenes = [];
      const shots = [];
      for (const sc of sorted?.scenes || []) {
        const id = newSceneId();
        scenes.push({ id, name: sc.name, note: sc.note });
        for (const note of sc.shots) shots.push({ id: newShotId(), scene: id, note, refs: [] });
      }
      // Kept with the film as given (the server keeps whatever the model did not place).
      let note = sorted?.note || "";
      let kept = sorted?.kept || [];
      let keptText = sorted?.keptText || "";
      if (!sorted) {
        const typed = text.trim();
        note = typed.length <= 2000 ? typed : "";
        kept = [...(typed.length > 2000 ? [{ name: "Typed text", role: "other" }] : []), ...readDocs.map((d) => ({ name: d.file.name, role: "other" }))];
        const texts = [...(typed.length > 2000 ? [typed] : []), ...readDocs.map((d) => d.doc.text)];
        keptText = kept.length === 1 ? texts[0] : kept.map((k, i) => `── ${k.name} ──\n${texts[i]}`).join("\n\n");
      }
      const cut = keptText.length > KEPT_MAX;
      if (cut) keptText = keptText.slice(0, KEPT_MAX);
      const { storyboard } = await dzStoryboards.create({ project: ctx.project?.id || undefined, name: sorted?.title || undefined, note, scene: keptText, scenes, shots, mood });

      const unread = docs.filter((d) => d.doc?.error);
      const rows = [];
      if (refs.length) rows.push({ kind: "media", tab: "mood" });
      if (scenes.length) rows.push({ kind: "script", tab: "board" });
      if (keptText) rows.push({ kind: "brief", tab: "board", brief: true });
      if (note) rows.push({ kind: "note", tab: "board" });
      const r = { film: storyboard, rows, unread, pictures: refs.filter((x) => x.kind === "image").length, videos: refs.filter((x) => x.kind === "video").length, scenes: scenes.length, shots: shots.length, kept, cut, briefFound: sorted?.briefFound || "", llm: sorted?.llm || null };
      setBusy("");
      if (rows.length === 1 && !unread.length) { onCreated(storyboard, rows[0].tab, { brief: rows[0].brief }); return; }
      if (!rows.length && !unread.length) { onCreated(storyboard, "mood"); return; }
      setResult(r);
    } catch (e) {
      setBusy("");
      notify({ type: "error", title: "New storyboard", message: e.message });
    }
  };

  const skip = async () => {
    if (busy) return;
    setBusy("Opening…");
    try {
      const { storyboard } = await dzStoryboards.create({ project: ctx.project?.id || undefined });
      onCreated(storyboard, "mood");
    } catch (e) { setBusy(""); notify({ type: "error", title: "New storyboard", message: e.message }); }
  };

  const header = (title, sub) => (
    <div className="flex flex-shrink-0 items-center gap-2 px-6 pt-5">
      <button type="button" onClick={result ? () => onCreated(result.film, "board", { list: true }) : onClose} aria-label="All storyboards" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><CaretLeft size={16} /></button>
      <h1 className="truncate text-xl font-semibold">{title}</h1>
      {sub && <span className="truncate text-sm text-muted-foreground">{sub}</span>}
    </div>
  );

  if (result) {
    const { film } = result;
    const go = (tab, opts) => onCreated(film, tab, opts);
    const hasMedia = result.rows.some((r) => r.kind === "media");
    return (
      <div className="flex h-full flex-col">
        {header(film.name, ctx.project ? ctx.project.name : "Personal")}
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-16">
          <div className="mx-auto mt-20 w-full max-w-[760px]">
            <h2 className="text-center text-3xl font-semibold">Sorted</h2>
            <p className="mt-3 text-center text-base text-muted-foreground">Nothing was generated. Everything can be moved or removed.</p>
            <div className="mt-7 rounded-2xl border border-border bg-card">
              {result.rows.map((r) => (
                r.kind === "media" ? (
                  <Row key="m" icon={Images} title={`${plural(result.pictures, "picture")}${result.videos ? ` and ${plural(result.videos, "video")}` : ""} went to the Moodboard`.replace(/^0 pictures and /, "")}
                    sub="Not sorted. They lie in one group called New." action="Open Moodboard" onAction={() => go("mood")} />
                ) : r.kind === "script" ? (
                  <Row key="s" icon={TextAlignLeft} title={`The script became ${plural(result.scenes, "scene")} and ${plural(result.shots, "shot")}`}
                    sub="Scene and shot texts are notes on the Storyboard. Edit or delete them freely." action="Open Storyboard" onAction={() => go("board")} />
                ) : r.kind === "brief" ? (
                  <Row key="b" icon={FileText}
                    title={result.kept.some((k) => k.role === "brief") ? "The brief is kept with the film" : `Kept with the film as given: ${result.kept.map((k) => k.name).join(", ")}`}
                    sub={[result.briefFound ? `Found: ${result.briefFound}.` : "", result.kept.some((k) => k.role === "script") ? "The original script is kept with it." : "", result.kept.some((k) => k.role === "other") && result.kept.some((k) => k.role !== "other") ? `Also kept: ${result.kept.filter((k) => k.role === "other").map((k) => k.name).join(", ")}.` : "", result.cut ? "Longer than 200,000 characters: the end was not kept." : ""].filter(Boolean).join(" ") || "Open it any time from the film's menu."}
                    action="Open the brief" quiet onAction={() => go("board", { brief: true })} />
                ) : (
                  <Row key="n" icon={Note} title="Your idea is the film note" sub="Shown at the top of the Storyboard." />
                )
              ))}
              {result.unread.length > 0 && (
                <Row icon={Warning} title={`Not read: ${result.unread.map((d) => d.file.name).join(", ")}`} sub="Paste their text into the brief or a new storyboard if it matters." />
              )}
            </div>
            <div className="mt-4 flex items-center justify-center gap-3">
              <button type="button" onClick={() => go(hasMedia ? "mood" : "board")} className="h-9 rounded-md bg-primary px-4 text-base font-medium text-primary-foreground hover:bg-primary-hover">
                Go to the {hasMedia ? "Moodboard" : "Storyboard"}
              </button>
            </div>
            {result.llm && <p className="mt-3 text-center text-xs text-muted-foreground">Sorted by {result.llm.model?.split(":").pop()}{result.llm.costUsd != null ? ` · ${result.llm.costUsd === 0 ? "free" : fmtUsd(result.llm.costUsd)}` : ""}</p>}
          </div>
        </div>
      </div>
    );
  }

  const picExts = [...new Set(pictures.map((p) => ext(p.file.name)).filter(Boolean))].join(", ");
  return (
    <div className="relative flex h-full flex-col"
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); if (busy) e.dataTransfer.dropEffect = "none"; else setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false); }}
      onDrop={(e) => { setOver(false); if (e.dataTransfer.files?.length) { e.preventDefault(); add(e.dataTransfer.files); } }}>
      {header("New storyboard")}
      <input ref={input} type="file" multiple className="hidden" onChange={(e) => { const l = [...(e.target.files || [])]; e.target.value = ""; add(l); }} />
      <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-16">
        <div className="mx-auto mt-20 w-full max-w-[760px]">
          <h2 className="text-center text-3xl font-semibold">What do you have?</h2>
          <p className="mt-3 text-center text-base text-muted-foreground">Write the idea, paste a script, or drop files: pictures, video, documents. Any mix, or nothing at all.</p>
          <div className={cn("mt-7 rounded-2xl border bg-card p-4 transition-colors duration-state", over ? "border-signal" : "border-border focus-within:border-ring")}>
            <textarea ref={area} value={text} onChange={(e) => { setText(e.target.value); setFailed(""); }} disabled={Boolean(busy)}
              onPaste={(e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); add(e.clipboardData.files); } }}
              onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && !nothing && !reading && quoted && !tooLong) { e.preventDefault(); start(); } }}
              placeholder="A 40 second film for… — or paste a script" rows={3}
              className="block max-h-[40vh] min-h-[72px] w-full resize-none bg-transparent text-prompt outline-none focus-visible:outline-none placeholder:text-muted-foreground [field-sizing:content]" />
            {files.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {pictures.length === 1 && <Chip thumb={pictures[0].thumb} title={pictures[0].file.name} sub={ext(pictures[0].file.name) || "picture"} onRemove={() => remove([pictures[0].id])} />}
                {pictures.length > 1 && <Chip thumb={pictures[0].thumb} title={plural(pictures.length, "picture")} sub={picExts || "pictures"} onRemove={() => remove(pictures.map((p) => p.id))} />}
                {videos.map((v) => <Chip key={v.id} icon={Images} title={v.file.name} sub={dur(v.duration) || "video"} onRemove={() => remove([v.id])} />)}
                {docs.map((d) => (
                  <Chip key={d.id} icon={FileText} title={d.file.name} warn={Boolean(d.doc?.error)}
                    sub={!d.doc ? "Reading…" : d.doc.error ? d.doc.error : plural(wordsIn(d.doc.text), "word")} onRemove={() => remove([d.id])} />
                ))}
              </div>
            )}
            {tooLong && !failed && (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-muted px-3 py-2 text-sm">
                <span className="text-muted-foreground">Too much text to sort in one go (over 40,000 characters).</span>
                <button type="button" onClick={() => start({ sortIt: false })} disabled={Boolean(busy)} className="font-medium underline-offset-2 hover:underline">Keep it unsorted</button>
              </div>
            )}
            {failed && (
              <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-destructive/10 px-3 py-2 text-sm">
                <span className="text-destructive">Sorting failed: {failed}</span>
                <button type="button" onClick={() => start({ sortIt: false })} className="font-medium underline-offset-2 hover:underline">Keep it unsorted</button>
              </div>
            )}
            <div className="mt-3 flex items-center gap-2">
              <button type="button" onClick={() => input.current?.click()} disabled={Boolean(busy)} aria-label="Add files" className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"><Plus size={16} /></button>
              <span className="text-sm text-muted-foreground">{busy ? <span className="flex items-center gap-1.5"><SpinIcon size={14} className="animate-spin" /> {busy}</span> : "Drop files anywhere on this window"}</span>
              <button type="button" onClick={skip} disabled={Boolean(busy)} className="ml-auto h-8 rounded-md px-3 text-base font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40">Skip, open empty</button>
              <button type="button" onClick={() => start()} disabled={nothing || reading || !quoted || tooLong || Boolean(busy)}
                title={needsModel ? "Sorting is one call to your text model. Nothing is generated." : "Pictures and video go to the Moodboard. No model call."}
                className="flex h-8 items-center gap-2 rounded-md bg-primary px-4 text-base font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-40">
                Start{priceLabel && <span className="tabular-nums opacity-70">{priceLabel}</span>}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
