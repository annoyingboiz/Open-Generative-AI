"use client";

// Re-shoot a frame with the chosen camera (handoff 17, §5) and the frames' camera check (§4).
// A start (or end) frame keeps its own look in the video, whatever the prompt says, so a
// camera other than the frame's is applied by re-shooting the frame with an image model
// (Nano Banana Pro, the user's frame as the only reference). The server writes the prompt
// (look.js reshootPrompt) and keeps the look with the new picture.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowsClockwise, Warning, CheckCircle } from "@phosphor-icons/react";
import { dzGenerate, dzWithMeta, dzThumb, DZ_QUOTE } from "../../api.js";
import { createEntries, lookData, buildBody, refSyntaxFor } from "../../dzCreate.js";
import { Button, Spinner, cn } from "../../ui/index.js";

const MODERN = "modern||";
// What the re-shoot changes: the camera (an old one counts as Modern), an anamorphic
// lens, shallow or deep focus. Two frames with the same signature look alike.
export function reshootSig(look) {
  if (!look || look.on === false) return MODERN;
  const cams = lookData().cameras || [];
  const cam = cams.some((c) => c.id === look.camera) ? look.camera : "modern";
  // Phone ignores lens and aperture (canvas extension): the camera alone decides.
  if (cam === "phone") return "phone||";
  const ana = /anamorphic/.test(String(look.lens || "")) ? "ana" : "";
  const n = Number(String(look.aperture || "").replace(/^f\//, ""));
  const ap = !n ? "" : n <= 2.8 ? "shallow" : n >= 8 ? "deep" : "";
  return `${cam}|${ana}|${ap}`;
}

// The image model for re-shooting: Nano Banana Pro, at its cheapest provider.
function reshootModel() {
  const list = createEntries("image").filter((e) => /nano banana pro/i.test(e.familyName || "") && e.variants.some((v) => v.media.reference));
  const price = (e) => Math.min(...e.variants.map((v) => v.model.dzPrice?.usd ?? Infinity));
  const entry = [...list].sort((a, b) => price(a) - price(b))[0];
  const variant = entry?.variants.find((v) => v.media.reference) || null;
  return entry && variant ? { entry, variant } : null;
}

const ROLE_NAME = { first: "start frame", last: "end frame" };

export function useReshoot(engine) {
  const { kind, look, attached, setAttached, values } = engine;
  const start = attached?.first?.[0]?.url || null;
  const end = attached?.last?.[0]?.url || null;
  // url → { made, look } (from the server; an upload has no look).
  const [info, setInfo] = useState({});
  useEffect(() => {
    const urls = [start, end].filter((u) => u && !(u in info));
    if (!urls.length || kind !== "video") return undefined;
    let alive = true;
    fetch("/dz/api/frames/look", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ urls }) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive && d?.frames) setInfo((m) => ({ ...m, ...Object.fromEntries(d.frames.map((f) => [f.url, f])) })); })
      .catch(() => {});
    return () => { alive = false; };
  }, [start, end, kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const want = kind === "video" ? reshootSig(look) : MODERN;
  const sigOf = (url) => (!url || !info[url] ? null : info[url].made ? reshootSig(info[url].look) : "unknown");
  const sStart = sigOf(start);
  const sEnd = sigOf(end);
  const needs = (url, s) => Boolean(url && s && want !== MODERN && s !== want);
  // Phone (§5.1) widens the frame by canvas extension: start frame only, and never with an end frame
  // (a wider start and an unchanged end would turn the clip into a push-in nobody asked for).
  const phone = want.startsWith("phone|");
  // The note shows whenever Phone meets an end frame, unless the start frame is already a Phone one.
  const phoneBlocked = phone && Boolean(end) && !(start && sStart === want);
  const roles = phoneBlocked ? [] : [["first", start, sStart], ...(phone ? [] : [["last", end, sEnd]])].filter(([, url, s]) => needs(url, s)).map(([r]) => r);
  const taken = Boolean(start && want !== MODERN && sStart === want);
  // §4: start and end frames from different cameras (two uploads: nothing to compare).
  const mismatch = Boolean(start && end && sStart && sEnd && sStart !== sEnd && !(sStart === "unknown" && sEnd === "unknown"));

  const model = useMemo(() => (kind === "video" && (roles.length || mismatch) ? reshootModel() : null), [kind, roles.length, mismatch]); // eslint-disable-line react-hooks/exhaustive-deps
  // The re-shoot keeps the video's ratio (16:9…), or the frame's own shape when the video's is
  // "adaptive"; the image model's field may be aspect_ratio, ratio or size (APIMart: size).
  // Phone always keeps the frame's own shape: the canvas is the frame's shape, and the server
  // checks and puts back the source by that shape.
  const videoRatio = ["aspect_ratio", "ratio"].map((k) => values?.[k]).find((v) => /^\d+:\d+$/.test(String(v || ""))) || null;
  // The frame's real shape, upright (the server's ?info=1: the original's size, EXIF turn applied).
  const [shapes, setShapes] = useState({});
  useEffect(() => {
    for (const url of [start, end]) {
      if (!url || shapes[url] || !/^\/media\//.test(url)) continue;
      fetch(`${url.split("?")[0]}?info=1`, { credentials: "same-origin" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.width && d?.height) setShapes((m) => ({ ...m, [url]: d.width / d.height })); })
        .catch(() => {});
    }
  }, [start, end]); // eslint-disable-line react-hooks/exhaustive-deps
  // Phone keeps the frame's own shape, so it waits for it (never a 16:9 guess).
  const ready = !phone || Boolean(start && shapes[start]);
  const bodyFor = useCallback((url) => {
    if (!model) return null;
    const { variant } = model;
    const key = ["aspect_ratio", "ratio", "size"].find((k) => (variant.model.inputs?.[k]?.enum || []).some((o) => /^\d+:\d+$/.test(String(o))));
    const opts = key ? variant.model.inputs[key].enum.map(String).filter((o) => /^\d+:\d+$/.test(o)) : [];
    const num = (o) => { const [a, b] = o.split(":").map(Number); return a / b; };
    const want = !phone && videoRatio && opts.includes(videoRatio) ? videoRatio : null;
    if (phone && !shapes[url]) return null;
    const shape = shapes[url] || 16 / 9;
    const nearest = opts.length ? opts.reduce((x, o) => (Math.abs(Math.log(num(o) / shape)) < Math.abs(Math.log(num(x) / shape)) ? o : x), opts[0]) : null;
    const to = want || nearest;
    return buildBody(variant, { prompt: "Re-shoot", values: key && to ? { [key]: to } : {}, attached: { reference: [{ url }] } });
  }, [model, videoRatio, shapes, phone]);

  // The price of one re-shoot (the server's quote for this exact request).
  const [price, setPrice] = useState(null);
  const sample = start || end;
  useEffect(() => {
    const body = model && sample ? bodyFor(sample) : null;
    if (!body) { setPrice(null); return undefined; }
    let alive = true;
    dzGenerate(undefined, { endpoint: model.variant.model.endpoint, ...body, onRequestId: DZ_QUOTE }).then((p) => { if (alive) setPrice(p?.usd ?? null); }).catch(() => {});
    return () => { alive = false; };
  }, [model, sample, bodyFor]);

  // role → { state: running | done | error, from, to, error }
  const [jobs, setJobs] = useState({});
  const lookRef = useRef(look);
  lookRef.current = look;
  const run = useCallback(async (role) => {
    const url = role === "first" ? start : end;
    const body = model && url ? bodyFor(url) : null;
    if (!body) return;
    // What this run was made from and with: a later change of frame or camera never relabels it.
    const token = Math.random().toString(36).slice(2);
    const shotLook = lookRef.current;
    setJobs((j) => ({ ...j, [role]: { state: "running", from: url, token } }));
    const mine = (j) => j[role]?.token === token;
    try {
      const ref = refSyntaxFor(model.variant.model)?.image(1) || "@img1";
      const meta = { kind: "image", entryKey: model.entry.key, modelName: `Re-shoot · ${model.entry.familyName} · ${model.entry.providerName}`, reshootOf: url, role };
      const res = await dzWithMeta({ studio: "create", meta, look: shotLook, reshoot: { frame: url, ref } },
        () => dzGenerate(undefined, { endpoint: model.variant.model.endpoint, ...body }));
      const to = res?.outputs?.[0] || res?.url;
      if (!to) throw new Error("No picture came back.");
      setInfo((m) => ({ ...m, [to]: { url: to, made: true, look: shotLook } }));
      setJobs((j) => (mine(j) ? { ...j, [role]: { state: "done", from: url, to, token } } : j));
    } catch (e) {
      setJobs((j) => (mine(j) ? { ...j, [role]: { state: "error", from: url, token, error: e?.message || "The re-shoot failed." } } : j));
    }
  }, [model, start, end, bodyFor]);
  const use = (role) => {
    const job = jobs[role];
    if (!job?.to) return;
    // Only in place of the frame it was made from (the frame may have been swapped meanwhile).
    setAttached((prev) => ((prev[role] || [])[0]?.url === job.from ? { ...prev, [role]: [{ url: job.to, name: `Re-shot ${ROLE_NAME[role]}` }, ...(prev[role] || []).slice(1)] } : prev));
    setJobs((j) => { const { [role]: _x, ...rest } = j; return rest; });
  };
  const keep = (role) => setJobs((j) => { const { [role]: _x, ...rest } = j; return rest; });

  return { want, roles, taken, mismatch, model, price, jobs, run, use, keep, start, end, phone, phoneBlocked, ready };
}

const money = (v) => (v == null ? "" : v < 0.1 ? `$${v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}` : `$${v.toFixed(2)}`);
export const PHONE_END_TEXT = "Phone re-shoot widens the frame and works with a start frame only. Remove the end frame to use it.";
export const MISMATCH_TEXT = "Start and end frames look different. The look will drift during the clip.";

// The camera panel's part (§4–§5): "Taken from frame", the re-shoot button, old and new side by side.
export function ReshootBlock({ r }) {
  if (!r || (!r.taken && !r.roles.length && !r.mismatch && !r.phoneBlocked && !Object.keys(r.jobs).length)) return null;
  const both = r.phone ? r.roles : r.mismatch ? ["first", "last"] : r.roles;
  const active = Object.keys(r.jobs);
  const runnable = both.filter((role) => !r.jobs[role] || r.jobs[role].state === "error");
  return (
    <div className="mt-5 space-y-3 rounded-xl border border-border p-3">
      {r.taken && !r.roles.length && !r.mismatch && (
        <p className="flex items-center gap-2 text-sm"><CheckCircle size={16} className="text-success" />Taken from frame — the start frame was made with this camera.</p>
      )}
      {r.mismatch && <p className="flex items-start gap-2 text-sm text-warning"><Warning size={16} className="mt-0.5 shrink-0" />{MISMATCH_TEXT}</p>}
      {r.phoneBlocked && <p className="text-sm text-muted-foreground">{PHONE_END_TEXT}</p>}
      {r.roles.length > 0 && !r.mismatch && (
        <p className="text-sm text-muted-foreground">The {r.roles.map((x) => ROLE_NAME[x]).join(" and ")} {r.roles.length > 1 ? "were" : "was"} not made with this camera. {r.phone ? "Re-shooting for Phone widens the frame: the picture is extended on all sides around it." : `The video keeps the look of its frames, so re-shoot ${r.roles.length > 1 ? "them" : "it"} with this camera first.`}</p>
      )}
      {runnable.length > 0 && r.model && (
        <Button variant="secondary" className="h-9 gap-2 rounded-lg" disabled={!r.ready} onClick={() => runnable.forEach((role) => r.run(role))}>
          <ArrowsClockwise size={16} />
          {runnable.length > 1 ? "Re-shoot both frames with this camera" : "Re-shoot frame with this camera"}
          {r.price != null && <span className="tabular-nums text-muted-foreground">· {money(r.price * runnable.length)}</span>}
        </Button>
      )}
      {!r.model && (r.roles.length > 0 || r.mismatch) && <p className="text-xs text-muted-foreground">Re-shooting needs Nano Banana Pro, which is not available here.</p>}
      {active.map((role) => {
        const job = r.jobs[role];
        return (
          <div key={role} className="space-y-2">
            <div className="text-xs font-medium uppercase text-muted-foreground">{ROLE_NAME[role]}</div>
            <div className="grid grid-cols-2 gap-2">
              {[["Original", job.from], ["New", job.to]].map(([label, url]) => (
                <figure key={label} className="space-y-1">
                  <div className={cn("flex aspect-video items-center justify-center overflow-hidden rounded-md bg-muted", label === "New" && job.state === "done" && "ring-2 ring-signal")}>
                    {url ? <img src={dzThumb(url, 480)} alt="" className="h-full w-full object-contain" /> : job.state === "running" ? <Spinner /> : null}
                  </div>
                  <figcaption className="text-xs text-muted-foreground">{label}</figcaption>
                </figure>
              ))}
            </div>
            {job.state === "error" && <p className="text-sm text-destructive">{job.error}</p>}
            {job.state === "done" && (
              <div className="flex gap-2">
                <Button className="h-8 rounded-lg" onClick={() => r.use(role)}>Use new frame</Button>
                <Button variant="ghost" className="h-8 rounded-lg" onClick={() => r.keep(role)}>Keep original</Button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Phone without a start frame (§7, decided by Denis): 9:16 reads as phone footage much more strongly.
// A suggestion only — never switches by itself; hidden with a start frame (the video takes its shape).
export function PhoneRatioHint({ engine }) {
  const { kind, look, attached, params, values, setValue } = engine;
  if (kind !== "video" || !look || look.on === false || look.camera !== "phone" || attached?.first?.length) return null;
  const all = [...(params?.main || []), ...(params?.advanced || [])];
  const p = all.find((x) => ["aspect_ratio", "ratio"].includes(x.key) && (x.enum || []).map(String).includes("9:16"));
  if (!p) return null;
  const now = String(values?.[p.key] ?? p.default ?? "");
  if (now === "9:16") return null;
  return (
    <div className="mt-5 flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm">
      <span className="text-muted-foreground">Phone footage reads best in 9:16.</span>
      <Button variant="secondary" className="h-8 rounded-lg" onClick={() => setValue(p.key, "9:16")}>Switch to 9:16</Button>
    </div>
  );
}
