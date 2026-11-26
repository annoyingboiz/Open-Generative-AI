"use client";

// DZ: Settings inside the app shell (handoff 21, Flow 36). A list of sections on the left, the
// section page on the right — the Assistant page's two panes. Every section has its own URL
// (/settings/<section>[/<item>]), so a reload and Back keep the place. The data and the actions
// are the old /settings page's; the JSON comes from /dz/api/settings/*. Keys and passwords
// never reach the browser: a key shows its last 4 characters only.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaretLeft } from "@phosphor-icons/react";
import { Button, Switch, Spinner, cn, DialogParts } from "../ui/index.js";
import { YOU, ADMIN, SOURCE_NAME, dzSettingsRoute, dzLlmGroups } from "../dzSettings.js";

const { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } = DialogParts;

// ── Data ──────────────────────────────────────────────────────────────────
async function call(method, url, body) {
  const res = await fetch(url, {
    method, credentials: "include", cache: "no-store",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* an empty answer */ }
  if (!res.ok) {
    const error = new Error(data?.error || `Request failed (${res.status})`);
    error.data = data;
    error.status = res.status;
    throw error;
  }
  return data;
}
const get = (url) => call("GET", url);
const post = (url, body = {}) => call("POST", url, body);

const pathOf = (section, item = "") => `/settings/${section}${item ? `/${encodeURIComponent(item)}` : ""}`;

// ── Small formatters ──────────────────────────────────────────────────────
const usd = (v) => (v == null ? "—" : `$${Number(v).toFixed(2)}`);
const money = (v) => (v == null ? "—" : v === 0 ? "$0" : v < 0.01 ? `$${v.toFixed(4)}` : `$${v.toFixed(3)}`);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = (n) => String(n).padStart(2, "0");
// Times in UTC, as the server writes them: "26 Nov, 17:38" (or with the year).
const utc = (t, { year = false } = {}) => {
  if (!t) return "—";
  const d = new Date(t);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}${year ? ` ${d.getUTCFullYear()}` : ""}, ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};
const perM = (m) => (m.free ? "free" : m.price ? `$${(+m.price.in).toFixed(2)} in / $${(+m.price.out).toFixed(2)} out` : "price at first use");
const modelLabel = (m) => `${m.name} · ${SOURCE_NAME[m.source] || m.source} — ${perM(m)}${m.vision ? " · sees pictures" : ""}`;

// ── Building blocks (the mockups' classes, in the studio's tokens) ────────
const inputCls = "h-9 w-full rounded-md border border-input bg-transparent px-2.5 text-base text-foreground placeholder:text-subtle focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-60";
const SECRET = { WebkitTextSecurity: "disc", textSecurity: "disc" };
const noFill = { autoComplete: "off", spellCheck: false, autoCapitalize: "off", "data-1p-ignore": true, "data-lpignore": "true", "data-bwignore": true, "data-form-type": "other" };

function Label({ children, className }) {
  return <div className={cn("text-overline uppercase text-muted-foreground", className)}>{children}</div>;
}
// A section label inside a form: 32 px above (16 + the form's 16 px gap), 16 px below.
const Sec = ({ children, first = false }) => <Label className={first ? "" : "mt-4"}>{children}</Label>;
function Hint({ children, className }) {
  return <div className={cn("-mt-2.5 text-xs text-muted-foreground", className)}>{children}</div>;
}
function Field({ label, children }) {
  return <label className="flex flex-col gap-1.5 text-sm text-muted-foreground">{label}{children}</label>;
}
function Kv({ k, v }) {
  return <div className="flex justify-between gap-3 border-b border-border py-1.5 text-sm"><span className="text-muted-foreground">{k}</span><span className="text-right text-foreground">{v}</span></div>;
}
function Dot({ tone }) {
  return <span className={cn("h-[7px] w-[7px] flex-none rounded-full", { ok: "bg-success", wn: "bg-warning", er: "bg-destructive", off: "bg-subtle" }[tone] || "bg-signal")} />;
}
function Status({ tone, children, title }) {
  return <span title={title} className={cn("inline-flex items-center gap-1.5 text-sm", tone === "er" ? "text-destructive" : "text-muted-foreground")}><Dot tone={tone} />{children}</span>;
}
function Row({ children, className }) {
  return <div className={cn("flex flex-wrap items-center gap-2 pt-2", className)}>{children}</div>;
}
function Item({ title, text, children, className, titleClass }) {
  return (
    <div className={cn("flex min-h-14 items-center gap-2.5 rounded-md border border-border p-2", className)}>
      <div className="min-w-0 flex-1">
        <b className={cn("block truncate text-base font-medium", titleClass)}>{title}</b>
        {text && <span className="block text-xs text-muted-foreground">{text}</span>}
      </div>
      {children}
    </div>
  );
}
function NativeSelect({ value, onChange, children, className, disabled }) {
  return <select value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled} className={cn(inputCls, "pr-8", className)}>{children}</select>;
}
function LlmSelect({ models, value, onChange, first }) {
  const { groups, missing } = dzLlmGroups(models, value);
  return (
    <NativeSelect value={value} onChange={onChange}>
      {first}
      {missing && <option value={missing.id}>{missing.label}</option>}
      {groups.map(([name, items]) => <optgroup key={name} label={name}>{items.map((m) => <option key={m.id} value={m.id}>{modelLabel(m)}</option>)}</optgroup>)}
    </NativeSelect>
  );
}
// One table for all five places: a label row, then 44 px rows with a 1 px line.
function Table({ cols, head, rows, empty, className }) {
  const grid = { gridTemplateColumns: cols };
  return (
    <div className={cn("min-w-0", className)}>
      <div className="grid items-center gap-4 border-b border-border pb-2 text-overline uppercase text-muted-foreground" style={grid}>{head.map((h, i) => <span key={i}>{h}</span>)}</div>
      {rows.length ? rows.map((r) => (
        <div key={r.key} className={cn("grid min-h-11 items-center gap-4 border-b border-border py-1.5 text-sm", r.className)} style={grid}>
          {r.cells.map((c, i) => <span key={i} className="min-w-0">{c}</span>)}
        </div>
      )) : <div className="border-b border-border py-3 text-sm text-muted-foreground">{empty}</div>}
    </div>
  );
}
const Sub = ({ children }) => <span className="block text-xs text-muted-foreground">{children}</span>;
const Small = ({ children, ...props }) => <Button size="sm" variant="outline" className="h-7 px-2.5" {...props}>{children}</Button>;

// The line under the page header after an action: green when it worked, red when not.
function Message({ msg }) {
  if (!msg) return null;
  if (msg.kind === "key") {
    return (
      <div className="mb-4 max-w-[640px] rounded-md border border-destructive/45 p-2.5">
        <b className="block text-base font-medium text-destructive">{msg.text}</b>
        <span className="block text-xs text-muted-foreground">Answer: {msg.answer}. The old key is kept. Check that you copied the whole key.</span>
      </div>
    );
  }
  return (
    <div role={msg.kind === "err" ? "alert" : "status"} className={cn("mb-4 max-w-[820px] rounded-md border px-3 py-2 text-base", msg.kind === "err" ? "border-destructive/45 text-destructive" : "border-success/45 text-foreground")}>
      {msg.text}
    </div>
  );
}

function Page({ title, text, action, tabs, msg, children }) {
  return (
    <section className="flex min-w-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-3.5 px-8 pt-6">
        <div className="min-w-0 flex-1">
          <h1 className="m-0 text-[22px] font-semibold leading-7 text-foreground">{title}</h1>
          {text && <p className="mt-0.5 text-base text-muted-foreground">{text}</p>}
        </div>
        {action}
      </div>
      {tabs}
      <div className="min-h-0 flex-1 overflow-y-auto px-8 pb-6 pt-4">
        <Message msg={msg} />
        {children}
      </div>
    </section>
  );
}
function Tabs({ items, value, onPick }) {
  return (
    <div className="flex flex-none gap-5 border-b border-border px-8 pt-4 text-base text-muted-foreground" role="tablist">
      {items.map(([id, label]) => (
        <button key={id} type="button" role="tab" aria-selected={value === id} onClick={() => onPick(id)}
          className={cn("pb-2.5", value === id ? "font-semibold text-foreground shadow-[0_2px_0_hsl(var(--foreground))]" : "hover:text-foreground")}>{label}</button>
      ))}
    </div>
  );
}
function Back({ onClick, children }) {
  return (
    <Button type="button" variant="ghost" onClick={onClick} className="-ml-1.5 h-8 self-start px-2.5 pl-1.5 text-muted-foreground hover:text-foreground">
      <CaretLeft size={16} />{children}
    </Button>
  );
}
function Loading() {
  return <div className="flex items-center gap-2 py-6 text-base text-muted-foreground"><Spinner /> Loading…</div>;
}
const Form = ({ children, className, onSubmit }) => (
  <form className={cn("flex max-w-[640px] flex-col gap-4", className)} onSubmit={(e) => { e.preventDefault(); onSubmit?.(); }}>{children}</form>
);

// Confirm before anything that cannot be taken back.
function useConfirm() {
  const [ask, setAsk] = useState(null);
  const confirm = useCallback((opts) => new Promise((resolve) => setAsk({ ...opts, resolve })), []);
  const close = (yes) => { ask?.resolve(yes); setAsk(null); };
  const dialog = (
    <Dialog open={Boolean(ask)} onOpenChange={(o) => { if (!o) close(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{ask?.title}</DialogTitle>
          {ask?.text && <DialogDescription>{ask.text}</DialogDescription>}
        </DialogHeader>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => close(false)}>Cancel</Button>
          <Button type="button" variant={ask?.danger ? "destructive" : "default"} onClick={() => close(true)}>{ask?.yes || "OK"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return [dialog, confirm];
}

// Runs an action: clears the message, shows the server's notice or error, keeps a busy flag.
function useAction(setMsg) {
  const [busy, setBusy] = useState("");
  const run = useCallback(async (name, fn) => {
    setBusy(name);
    setMsg(null);
    try {
      const r = await fn();
      if (r?.notice) setMsg({ kind: "ok", text: r.notice });
      return r;
    } catch (error) {
      setMsg({ kind: "err", text: error.message });
      return null;
    } finally { setBusy(""); }
  }, [setMsg]);
  return [busy, run];
}

// ── You · Account ─────────────────────────────────────────────────────────
function AccountPage({ msg, setMsg }) {
  const [data, setData] = useState(null);
  const [cur, setCur] = useState("");
  const [next, setNext] = useState("");
  const [busy, run] = useAction(setMsg);
  useEffect(() => { get("/dz/api/settings/account").then(setData).catch((e) => setMsg({ kind: "err", text: e.message })); }, [setMsg]);
  const change = async () => {
    const r = await run("pw", () => post("/dz/api/settings/password", { currentPassword: cur, newPassword: next }));
    if (r) { setCur(""); setNext(""); }
  };
  const signOut = () => { const f = document.createElement("form"); f.method = "post"; f.action = "/logout"; document.body.appendChild(f); f.submit(); };
  const u = data?.user;
  return (
    <Page title="Account" text="Your name, password and this month’s spending." msg={msg}>
      {!data ? <Loading /> : (
        <Form onSubmit={change}>
          <Sec first>You</Sec>
          <div className="-mt-1">
            <Kv k="Name" v={u.name} />
            <Kv k="Username" v={u.username} />
            <Kv k="Role" v={`${u.role === "admin" ? "Admin" : "User"}${u.owner ? " · owner of this server" : ""}`} />
            <Kv k="Spent this month" v={data.limit == null ? `${usd(data.spent)} · no limit` : `${usd(data.spent)} of ${usd(data.limit)}`} />
          </div>
          <Sec>Change password</Sec>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Current password"><input type="password" className={inputCls} value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" required /></Field>
            <Field label="New password"><input type="password" className={inputCls} value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" placeholder="At least 8 characters" minLength={8} required /></Field>
          </div>
          <Hint>Passwords are never stored in the browser or shown here.</Hint>
          <Row>
            <Button type="submit" className="h-9" disabled={busy === "pw" || !cur || next.length < 8}>{busy === "pw" ? <Spinner /> : "Change password"}</Button>
            <Button type="button" variant="outline" className="h-9" onClick={signOut}>Sign out</Button>
          </Row>
        </Form>
      )}
    </Page>
  );
}

// ── You · Your text model ─────────────────────────────────────────────────
function ConnectSteps({ loopback, onFinish, busy }) {
  const [addr, setAddr] = useState("");
  return (
    <>
      <ol className="ml-5 list-decimal space-y-1 text-base text-foreground">
        <li>Press <b className="font-medium">Connect ChatGPT</b>. The OpenAI sign-in opens in a new tab.</li>
        <li>Sign in and keep “Use your ChatGPT plan” on.</li>
        {loopback
          ? <li>Director runs on this computer, so it finishes by itself; then reload this page. If the new tab says the page can’t be reached, paste its address below.</li>
          : <li>The new tab then says the page can’t be reached. That is expected. Copy its whole address and paste it below within a few minutes.</li>}
      </ol>
      <Field label="Address of that tab">
        <div className="flex gap-2">
          <input className={inputCls} value={addr} onChange={(e) => setAddr(e.target.value)} placeholder="http://127.0.0.1:1455/auth/callback?code=…" {...noFill} />
          <Button type="button" className="h-9" disabled={!addr.trim() || busy} onClick={() => onFinish(addr.trim())}>{busy ? <Spinner /> : "Finish"}</Button>
        </div>
      </Field>
    </>
  );
}
function ConnectButton({ fresh = false, children, variant = "default" }) {
  // A plain form in a new tab: the server answers with the OpenAI sign-in address.
  return (
    <form method="post" action="/dz/settings/chatgpt/connect" target="_blank" className="inline">
      {fresh && <input type="hidden" name="fresh" value="1" />}
      <Button type="submit" variant={variant} className="h-9">{children}</Button>
    </form>
  );
}
function TerminalWay({ username }) {
  return (
    <details className="text-base">
      <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Other way: from a Mac terminal ›</summary>
      <pre className="mt-2 whitespace-pre-wrap break-all rounded-md border border-border bg-muted px-3 py-2 font-mono text-sm">{`node tools/connect-chatgpt.mjs --server <your ssh host> --user ${username || "USERNAME"}`}</pre>
    </details>
  );
}

function TextModelPage({ msg, setMsg, confirm }) {
  const [data, setData] = useState(null);
  const [mine, setMine] = useState("");
  const [busy, run] = useAction(setMsg);
  const load = useCallback(() => get("/dz/api/settings/text").then((d) => { setData(d); setMine(d.myDefault || ""); }).catch((e) => setMsg({ kind: "err", text: e.message })), [setMsg]);
  useEffect(() => { load(); }, [load]);
  const saveDefault = () => run("default", async () => { await post("/dz/api/llm/my-default", { model: mine }); return { notice: "Your default text model is saved." }; });
  const finish = async (callback) => { if (await run("finish", () => post("/dz/api/settings/chatgpt/finish", { callback }))) load(); };
  const disconnect = async () => {
    if (!(await confirm({ title: "Disconnect your ChatGPT?", text: "It is revoked at OpenAI and deleted here.", yes: "Disconnect", danger: true }))) return;
    if (await run("disconnect", () => post("/dz/api/settings/chatgpt/disconnect"))) load();
  };
  if (!data) return <Page title="Your text model" text="The model that writes for you here: prompt adapter, AI Director, assistants." msg={msg}><Loading /></Page>;
  const st = data.chatgpt || {};
  const g = data.models.find((m) => m.id === data.globalDefault);
  const shared = st.shared && (!st.connected || st.lost)
    ? <div className="text-base text-foreground">For now you use <b className="font-medium">{st.shared.owner}</b>’s plan, shared with everyone here. Connect your own to use yours.</div> : null;
  return (
    <Page title="Your text model" text="The model that writes for you here: prompt adapter, AI Director, assistants." msg={msg}>
      <Form onSubmit={saveDefault}>
        <Field label="My default text model">
          <LlmSelect models={data.models} value={mine} onChange={setMine} first={<option value="">Same as everyone{g ? ` (${g.name})` : ""}</option>} />
        </Field>
        <Hint>Used when a tool does not pick a model itself.</Hint>
        <Row className="pt-0"><Button type="submit" className="h-9" disabled={busy === "default" || mine === (data.myDefault || "")}>{busy === "default" ? <Spinner /> : "Save"}</Button></Row>

        <Sec>Your ChatGPT plan</Sec>
        {!st.connected ? (
          <>
            <div className="text-base text-muted-foreground">Not connected. Use your own ChatGPT plan (Plus or Pro) for the text models here: it costs nothing extra and only you use it.</div>
            {shared}
            <div><ConnectButton>Connect ChatGPT</ConnectButton></div>
            <ConnectSteps loopback={st.loopback} onFinish={finish} busy={busy === "finish"} />
            <TerminalWay username={data.username} />
          </>
        ) : (
          <>
            <Item title={st.email || "(no e-mail)"} text={`Connected ${utc(st.saved_at, { year: true })} UTC · last refresh ${utc(st.refreshed_at)} UTC`}>
              {st.lost ? <Status tone="er">expired — reconnect</Status> : <Status tone="ok">works</Status>}
              <Button type="button" variant="ghost" className="h-8 text-destructive hover:text-destructive" disabled={busy === "disconnect"} onClick={disconnect}>Disconnect</Button>
            </Item>
            <Hint>Disconnect revokes the access at OpenAI and deletes it here.{data.isAdmin ? " Sharing your plan with everyone is in Text models." : ""}</Hint>
            {shared}
            <details open={Boolean(st.lost)} className="flex flex-col gap-4 [&[open]>summary]:mb-4">
              <summary className="cursor-pointer text-base text-muted-foreground hover:text-foreground">Reconnect or switch account ›</summary>
              <div className="flex flex-col gap-4">
                <div className="flex gap-2"><ConnectButton>Reconnect</ConnectButton><ConnectButton fresh variant="outline">Connect a different account</ConnectButton></div>
                <ConnectSteps loopback={st.loopback} onFinish={finish} busy={busy === "finish"} />
                <TerminalWay username={data.username} />
              </div>
            </details>
          </>
        )}
      </Form>
    </Page>
  );
}

// ── Admin · Providers ─────────────────────────────────────────────────────
const balanceText = (p) => {
  const b = p.balance;
  if (!b?.ok || b.amount == null) return "";
  return b.currency === "CREDITS" ? `${Math.round(Number(b.amount)).toLocaleString("en-US")} credits` : usd(b.amount);
};
function providerStatus(p) {
  if (!p.hasKey) return { tone: "off", text: "no key" };
  if (!p.enabled) return { tone: "off", text: "off" };
  if (p.balance?.ok) return { tone: "ok", text: "works" };
  return { tone: "er", text: "not working", title: p.balance?.error || "" };
}
const keyText = (p) => (!p.hasKey ? "No key" : `API key ${p.keyMask}${p.keySource === "env" ? " · from the server’s .env" : ""}`);

function ProvidersPage({ msg, setMsg, go }) {
  const [list, setList] = useState(null);
  const [busy, run] = useAction(setMsg);
  useEffect(() => { get("/dz/api/settings/providers").then((d) => setList(d.providers)).catch((e) => setMsg({ kind: "err", text: e.message })); }, [setMsg]);
  const toggle = async (p, on) => {
    setList((l) => l.map((x) => (x.id === p.id ? { ...x, enabled: on } : x)));
    const r = await run(`on-${p.id}`, () => post(`/dz/api/settings/providers/${p.id}/enabled`, { enabled: on }));
    setList((l) => l.map((x) => (x.id === p.id ? (r?.provider || { ...x, enabled: !on }) : x)));
  };
  return (
    <Page title="Providers" text="Where pictures, video and sound are made. Keys are stored encrypted on this server and never sent to the browser." msg={msg}>
      {!list ? <Loading /> : (
        <div className="flex max-w-[820px] flex-col gap-2">
          {list.map((p) => {
            const s = providerStatus(p);
            return (
              <Item key={p.id} title={p.name} text={keyText(p)} className="px-3 py-2.5">
                <span className="min-w-[150px] text-right text-base font-semibold tabular-nums">{balanceText(p)}</span>
                <span className="min-w-[110px]"><Status tone={s.tone} title={s.title}>{s.text}</Status></span>
                <Switch checked={p.enabled} disabled={busy === `on-${p.id}`} onCheckedChange={(on) => toggle(p, on)} aria-label={`${p.name} enabled`} />
                <Button type="button" variant="outline" className="h-8" onClick={() => go("providers", p.id)}>Edit</Button>
              </Item>
            );
          })}
          {list.filter((p) => p.balance?.ok && p.balance.note).map((p) => <div key={p.id} className="mt-2 text-xs text-muted-foreground">{p.name}: {p.balance.note}.</div>)}
        </div>
      )}
    </Page>
  );
}

function ProviderPage({ id, msg, setMsg, go, confirm }) {
  const [p, setP] = useState(null);
  const [key, setKey] = useState("");
  const [billing, setBilling] = useState("");
  const [proxy, setProxy] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [busy, run] = useAction(setMsg);
  const [saving, setBusy] = useState(false); // Save and check (its own error row, screen 06)
  const [test, setTest] = useState(null); // { id, status, url, cost, error }
  const fill = useCallback((row) => { setP(row); setProxy(row.proxy || ""); setEnabled(row.enabled); setKey(""); setBilling(""); }, []);
  useEffect(() => {
    get("/dz/api/settings/providers").then((d) => {
      const row = d.providers.find((x) => x.id === id);
      if (!row) { go("providers"); return; }
      fill(row);
    }).catch((e) => setMsg({ kind: "err", text: e.message }));
  }, [id, fill, go, setMsg]);
  const save = async (extra = {}) => {
    setBusy(true);
    setMsg(null);
    try {
      const r = await post(`/dz/api/settings/providers/${id}`, { apiKey: key, billingKey: billing, proxy, enabled, ...extra });
      fill(r.provider);
      setMsg({ kind: "ok", text: r.notice });
    } catch (error) {
      setMsg(error.data?.kept ? { kind: "key", text: error.message, answer: error.data.answer } : { kind: "err", text: error.message });
    } finally { setBusy(false); }
  };
  const removeKey = async () => {
    if (!(await confirm({ title: `Remove the saved ${p.name} key?`, text: "Its models stop working until a new key is added.", yes: "Remove key", danger: true }))) return;
    save({ apiKey: "", billingKey: "", clearKey: true });
  };
  const removeBilling = async () => {
    if (!(await confirm({ title: "Remove the saved balance key?", text: "The balance is read with the API key again where possible.", yes: "Remove", danger: true }))) return;
    save({ apiKey: "", billingKey: "", clearBillingKey: true });
  };
  // Test generation: one picture; the result shows here when it is ready. The job id is kept
  // for this tab, so leaving the page or a reload picks the result up again; a failed check
  // of the status is retried (the job itself goes on on the server).
  const timer = useRef(null);
  const testKey = `dz_settings_test_${id}`;
  useEffect(() => () => clearTimeout(timer.current), []);
  const poll = useCallback((genId, misses = 0, wait = 3000) => {
    timer.current = setTimeout(async () => {
      try {
        const r = await get(`/dz/api/settings/test/${genId}`);
        setTest({ id: genId, ...r });
        if (r.status !== "completed" && r.status !== "failed") poll(genId);
        else { try { sessionStorage.removeItem(testKey); } catch { /* optional */ } }
      } catch (error) {
        if (error.status === 404 || misses >= 5) {
          setTest({ id: genId, status: "failed", error: error.message });
          try { sessionStorage.removeItem(testKey); } catch { /* optional */ }
        } else poll(genId, misses + 1, Math.min(30000, Math.max(3000, wait * 2)));
      }
    }, wait);
  }, [testKey]);
  useEffect(() => {
    let saved = null;
    try { saved = sessionStorage.getItem(testKey); } catch { /* optional */ }
    if (saved) { setTest({ id: saved, status: "processing" }); poll(saved, 0, 0); }
  }, [testKey, poll]);
  const runTest = async () => {
    const r = await run("test", () => post("/dz/api/settings/test", { provider: id }));
    if (r?.id) {
      try { sessionStorage.setItem(testKey, r.id); } catch { /* optional */ }
      setTest({ id: r.id, status: "submitted" });
      poll(r.id);
    }
  };
  if (!p) return <Page title="Provider" msg={msg}><Loading /></Page>;
  const s = providerStatus(p);
  const sub = [balanceText(p), p.hasKey ? `key ${p.keyMask} ${p.keySource === "env" ? "from .env" : "saved"}` : "no key"].filter(Boolean).join(" · ");
  const testing = test && test.status !== "completed" && test.status !== "failed";
  return (
    <Page title={p.name} msg={msg}
      text={<>{sub} · <span className={cn("inline-flex items-center gap-1.5", s.tone === "ok" ? "text-success" : s.tone === "er" ? "text-destructive" : "")} title={s.title}><Dot tone={s.tone} />{s.text}</span></>}>
      <Form onSubmit={() => save()}>
        <Back onClick={() => go("providers")}>All providers</Back>
        <Field label="API key">
          <input className={inputCls} style={SECRET} value={key} onChange={(e) => setKey(e.target.value)} placeholder={p.hasKey ? "Leave empty to keep the current key" : "Paste the key"} {...noFill} />
        </Field>
        {p.keysUrl && <Hint>Get a key: <a href={p.keysUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2 hover:text-foreground">{p.keysUrl.replace(/^https?:\/\//, "")}</a>{p.keySource === "env" ? " · The current key comes from the server’s .env file; a key saved here replaces it." : ""}</Hint>}
        {p.billingKeyField && (
          <>
            <Field label={`Balance key (optional)${p.hasBillingKey ? ` · ${p.billingKeyMask} saved` : ""}`}>
              <input className={inputCls} style={SECRET} value={billing} onChange={(e) => setBilling(e.target.value)} placeholder={p.hasBillingKey ? "Leave empty to keep it" : "A key on the BILLING preset"} {...noFill} />
            </Field>
            <Hint>Only reads the balance. In {p.name} → API keys, make a key with the BILLING preset.{p.hasBillingKey && <> <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={removeBilling}>Remove saved balance key</button></>}</Hint>
          </>
        )}
        <Field label="Proxy (optional)">
          <input className={inputCls} value={proxy} onChange={(e) => setProxy(e.target.value)} placeholder="socks5h://127.0.0.1:1080" {...noFill} />
        </Field>
        <Hint>All requests to {p.name} go through it, including downloads. Empty = direct.</Hint>
        <label className="flex items-start gap-3 text-base text-foreground">
          <Switch checked={enabled} onCheckedChange={setEnabled} className="mt-0.5" />
          <span>Enabled<small className="block text-xs text-muted-foreground">Models of this provider are shown in the studio.</small></span>
        </label>
        <Row>
          <Button type="submit" className="h-9" disabled={saving}>{saving ? <><Spinner /> Checking…</> : "Save and check"}</Button>
          <Button type="button" variant="ghost" className="h-9" onClick={() => go("providers")}>Cancel</Button>
          <span className="flex-1" />
          {p.keySource === "settings" && <Button type="button" variant="ghost" className="h-9 text-destructive hover:text-destructive" disabled={saving} onClick={removeKey}>Remove saved key</Button>}
        </Row>
        {p.test && (
          <>
            <Sec>Test generation</Sec>
            <Item title={`One cheap picture, ${p.test.model}`} text="Checks the whole path: request, wait, file saved on this server. Costs real money.">
              <Button type="button" variant="outline" className="h-8" disabled={busy === "test" || testing} onClick={runTest}>
                {busy === "test" || testing ? <><Spinner /> Running…</> : `Run test · ${p.test.price}`}
              </Button>
            </Item>
            {test?.status === "completed" && (
              <div className="flex items-center gap-3">
                <img src={test.url} alt="Test result" className="h-24 w-24 rounded-md border border-border object-cover" />
                <span className="text-base">Done. The file is stored on this server.{test.cost != null ? ` Cost ${money(Number(test.cost))}.` : ""}</span>
              </div>
            )}
            {test?.status === "failed" && <div className="text-base text-destructive">Test failed: {test.error}</div>}
          </>
        )}
      </Form>
    </Page>
  );
}

// ── Admin · Models ────────────────────────────────────────────────────────
function ModelsPage({ msg, setMsg, confirm }) {
  const [data, setData] = useState(null);
  const [pick, setPick] = useState("");
  const [busy, run] = useAction(setMsg);
  useEffect(() => { get("/dz/api/settings/models").then(setData).catch((e) => setMsg({ kind: "err", text: e.message })); }, [setMsg]);
  const act = async (action, key = "") => {
    if (action === "reset" && !(await confirm({ title: "Reset to defaults?", text: "The list goes back to the families Director starts with.", yes: "Reset" }))) return;
    const r = await run(`${action}-${key}`, () => post("/dz/api/settings/models", { action, key }));
    if (r) { setData(r); setPick(""); }
  };
  const byKey = useMemo(() => new Map((data?.families || []).map((f) => [f.key, f])), [data]);
  const options = (kind) => (data?.families || []).filter((f) => f.kind === kind && !data.recommended.includes(f.key));
  return (
    <Page title="Models" text="These families are shown first in the model lists, in this order. Inside a family the cheapest provider stays the default." msg={msg}>
      {!data ? <Loading /> : (
        <div className="flex max-w-[720px] flex-col gap-4">
          <Table cols="32px 1fr 90px 150px" head={["#", "Model family", "Kind", ""]} empty="None — the lists use the catalog order."
            rows={data.recommended.map((key, i) => {
              const f = byKey.get(key);
              return {
                key, cells: [
                  i + 1,
                  f ? f.name : <>{key} <Sub>not in the catalog now</Sub></>,
                  <span key="k" className="text-muted-foreground">{f?.kind || "—"}</span>,
                  <span key="a" className="flex gap-1">{i > 0 && <Small disabled={Boolean(busy)} onClick={() => act("up", key)} aria-label="Move up">↑</Small>}<Button size="sm" variant="ghost" className="h-7 px-2.5" disabled={Boolean(busy)} onClick={() => act("remove", key)}>Remove</Button></span>,
                ],
              };
            })} />
          <Form className="mt-4" onSubmit={() => pick && act("add", pick)}>
            <Field label="Add a family">
              <div className="flex gap-2">
                <NativeSelect value={pick} onChange={setPick} disabled={data.recommended.length >= data.max}>
                  <option value="">Choose a family…</option>
                  <optgroup label="Images">{options("image").map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}</optgroup>
                  <optgroup label="Video">{options("video").map((f) => <option key={f.key} value={f.key}>{f.name}</option>)}</optgroup>
                </NativeSelect>
                <Button type="submit" className="h-9" disabled={!pick || Boolean(busy)}>Add</Button>
              </div>
            </Field>
            <Hint>At most {data.max} families. The studio shows a new order after a reload.</Hint>
            <Row><Button type="button" variant="outline" className="h-9" disabled={Boolean(busy)} onClick={() => act("reset")}>Reset to defaults</Button></Row>
          </Form>
        </div>
      )}
    </Page>
  );
}

// ── Admin · Provider changes ──────────────────────────────────────────────
const CHANGE_LABEL = {
  "model-added": "New model", "model-removed": "Model removed", "model-missing": "Not in the docs",
  "param-added": "New setting", "param-removed": "Setting removed", "param-changed": "Setting changed",
  "values-added": "New values", "values-removed": "Values removed", "range-changed": "Range changed",
  "limit-changed": "File limit changed", "default-changed": "Default changed", "price-changed": "Price changed",
  "mode-added": "New mode", "mode-removed": "Mode removed", "rename-changed": "Field names changed",
  rejected: "Request refused", reverted: "Rolled back", "check-skipped": "Check skipped",
};
const PROVIDER_NAME = { apimart: "APIMart", atlas: "Atlas", fal: "fal.ai", elevenlabs: "ElevenLabs" };
const STATUS = { applied: ["applied", "text-success"], reverted: ["rolled back", "text-warning"], info: ["info", "text-muted-foreground"] };
const PAGE = 50;

function ChangesPage({ msg, setMsg, onSeen }) {
  const [data, setData] = useState(null);
  const [more, setMore] = useState(false);
  const [busy, run] = useAction(setMsg);
  useEffect(() => {
    get(`/dz/api/settings/changes?offset=0&limit=${PAGE}`).then((d) => { setData(d); onSeen?.(); }).catch((e) => setMsg({ kind: "err", text: e.message }));
  }, [setMsg, onSeen]);
  const showMore = async () => {
    setMore(true);
    try {
      const d = await get(`/dz/api/settings/changes?offset=${data.entries.length}&limit=${PAGE}`);
      setData((cur) => ({ ...cur, entries: [...cur.entries, ...d.entries], total: d.total }));
    } catch (error) { setMsg({ kind: "err", text: error.message }); } finally { setMore(false); }
  };
  const check = () => run("check", () => post("/dz/api/settings/changes/check"));
  const stale = data?.summary?.docsStale;
  return (
    <Page title="Provider changes" text="Checked every day and applied by itself. Nothing to approve here." msg={msg}
      action={<Button type="button" variant="outline" className="h-9" disabled={busy === "check"} onClick={check}>{busy === "check" ? <Spinner /> : "Check now"}</Button>}>
      {!data ? <Loading /> : (
        <div className="max-w-[860px]">
          {stale && (
            <div className="mb-4 rounded-md border border-warning/60 px-3 py-2.5 text-base text-warning">
              APIMart docs have not been applied since {utc(stale.since, { year: true })} UTC: {stale.skips} check{stale.skips === 1 ? "" : "s"} in a row were skipped or failed ({stale.reason}). New APIMart models show without settings, and setting changes are not picked up.
            </div>
          )}
          <p className="mb-3 mt-1 text-sm text-muted-foreground">Atlas publishes schemas, so the studio follows it at once. APIMart’s docs are re-read and every change is applied; if APIMart then refuses requests, the change is rolled back by itself. Removed models leave the studio on the next refresh.</p>
          <div className="mb-4 flex flex-wrap items-center gap-6 text-sm">
            <span>APIMart docs last checked: {data.summary.lastCheck ? `${utc(data.summary.lastCheck, { year: true })} UTC` : "not yet"}</span>
            <span className="inline-flex items-center gap-1.5 text-muted-foreground" title={data.telegram ? "" : "Set DZ_TELEGRAM_BOT_TOKEN and DZ_TELEGRAM_CHAT_ID on the server"}>
              <Dot tone={data.telegram ? "ok" : "wn"} />Telegram alerts {data.telegram ? "on" : "off"}
            </span>
          </div>
          <Table cols="120px 90px 1fr 210px 80px" head={["When (UTC)", "Provider", "Model", "Change", "Status"]}
            empty="No changes yet. The first check only remembers how things are now."
            rows={data.entries.map((e) => {
              const what = [e.mode, e.param].filter(Boolean).join(" · ");
              const [label, tone] = STATUS[e.status] || [e.status, ""];
              return {
                key: e.id, className: e.seen ? "" : "bg-signal/5",
                cells: [
                  <span key="w" className="tabular-nums">{utc(e.at)}</span>,
                  <span key="p">{PROVIDER_NAME[e.provider] || e.provider}<Sub>{e.source}</Sub></span>,
                  <span key="m" className="break-words">{e.name || e.model || e.endpoint || ""}{what && <Sub>{what}</Sub>}</span>,
                  <span key="c">{CHANGE_LABEL[e.type] || e.type}{e.detail && <Sub><span className="break-words">{String(e.detail).slice(0, 300)}</span></Sub>}</span>,
                  <span key="s" className={tone}>{label}</span>,
                ],
              };
            })} />
          {data.entries.length > 0 && (
            <div className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
              Showing {data.entries.length} of {data.total}
              {data.entries.length < data.total && <> · <button type="button" className="text-foreground underline underline-offset-2" disabled={more} onClick={showMore}>{more ? "Loading…" : "Show more"}</button></>}
            </div>
          )}
        </div>
      )}
    </Page>
  );
}

// ── Admin · Text models ───────────────────────────────────────────────────
const SOURCE_STATUS = { ok: ["ok", "works"], offline: ["er", "offline"], "no key": ["off", "no key"], off: ["off", "off"], error: ["er", "error"], "not connected": ["off", "not connected"] };

function TextModelsPage({ tab, msg, setMsg, go, confirm }) {
  const [data, setData] = useState(null);
  const [everyone, setEveryone] = useState("");
  const [tryModel, setTryModel] = useState("");
  const [prompt, setPrompt] = useState("");
  const [answer, setAnswer] = useState(null);
  const [busy, run] = useAction(setMsg);
  const load = useCallback(() => get("/dz/api/settings/text").then((d) => {
    setData(d);
    setEveryone(d.globalDefault || d.default || "");
    setTryModel((cur) => cur || d.default || "");
  }).catch((e) => setMsg({ kind: "err", text: e.message })), [setMsg]);
  useEffect(() => { load(); }, [load]);
  const saveEveryone = () => run("everyone", () => post("/dz/api/settings/text/default", { model: everyone }));
  const share = async (on) => { if (await run("share", () => post("/dz/api/settings/chatgpt/sharing", { sharing: on ? "all" : "owner" }))) load(); };
  const disconnect = async (a) => {
    if (!(await confirm({ title: `Disconnect ${a.username}’s ChatGPT?`, text: "It is revoked at OpenAI and deleted here.", yes: "Disconnect", danger: true }))) return;
    if (await run(`dc-${a.userId}`, () => post("/dz/api/settings/chatgpt/disconnect", { userId: a.userId }))) load();
  };
  const send = async () => {
    setAnswer(null);
    const r = await run("try", () => post("/dz/api/settings/text/try", { model: tryModel, prompt }));
    if (r) { setAnswer(r); load(); }
  };
  const header = "The “brain” for the prompt adapter, AI Director and assistants. Only text is made here. Calls count toward each person’s monthly limit; the local machine is free.";
  const tabs = <Tabs items={[["sources", "Sources"], ["try", "Try and recent calls"]]} value={tab} onPick={(t) => go("text-models", t === "try" ? "try" : "")} />;
  if (!data) return <Page title="Text models" text={header} tabs={tabs} msg={msg}><Loading /></Page>;
  const forEveryone = data.models.filter((m) => m.source !== "chatgpt" || data.chatgpt?.sharing === "all");
  return (
    <Page title="Text models" text={header} tabs={tabs} msg={msg}>
      {tab !== "try" ? (
        <div className="flex flex-col">
          <Table className="max-w-[820px]" cols="1fr 120px 80px 1.4fr" head={["Source", "Status", "Models", "Note"]} empty="No sources."
            rows={(data.sources || []).map((s) => {
              const [tone, text] = SOURCE_STATUS[s.status] || ["off", s.status];
              return { key: s.id || s.name, cells: [s.name, <Status key="s" tone={tone}>{text}</Status>, s.count || 0, <span key="n" className="text-muted-foreground">{s.note || ""}</span>] };
            })} />
          <Form className="mt-8" onSubmit={saveEveryone}>
            <Field label="Default text model for everyone">
              <LlmSelect models={forEveryone} value={everyone} onChange={setEveryone} />
            </Field>
            <Hint>Used when a tool does not pick one and a person has no default of their own.</Hint>
            <Row className="pt-0"><Button type="submit" className="h-9" disabled={busy === "everyone" || !everyone}>{busy === "everyone" ? <Spinner /> : "Save"}</Button></Row>
            <Sec>ChatGPT plans connected here</Sec>
            <Table className="-mt-1" cols="1fr 1.3fr 1fr 220px" head={["Person", "E-mail", "Status", ""]} empty="Nobody has connected a ChatGPT plan here."
              rows={(data.accounts || []).map((a) => {
                const own = a.username === data.username;
                return {
                  key: a.userId, cells: [
                    <b key="u" className="font-medium">{a.username}{own && <Sub>you</Sub>}</b>,
                    <span key="e" className="break-all">{a.email || ""}</span>,
                    <span key="s">{a.lost ? <Status tone="er">expired</Status> : <Status tone="ok">ok</Status>}{a.shared && <Sub>shared with everyone</Sub>}</span>,
                    <span key="a" className="flex items-center justify-end gap-1">
                      {own && <Small disabled={busy === "share"} onClick={() => share(!a.shared)}>{a.shared ? "Stop sharing" : "Share with everyone"}</Small>}
                      <Button size="sm" variant="ghost" className="h-7 px-2.5 text-destructive hover:text-destructive" disabled={busy === `dc-${a.userId}`} onClick={() => disconnect(a)}>Disconnect</Button>
                    </span>,
                  ],
                };
              })} />
            {data.accounts?.some((a) => a.username === data.username) && <Hint className="mt-0">Sharing: people without their own ChatGPT use yours, and its limits are shared. Only the owner of a plan can share it.</Hint>}
          </Form>
        </div>
      ) : (
        <div className="flex flex-col">
          <Form onSubmit={send}>
            <Sec first>Try a text model</Sec>
            <Field label="Model"><LlmSelect models={data.models} value={tryModel} onChange={setTryModel} /></Field>
            <Field label="Prompt">
              <textarea className={cn(inputCls, "h-auto min-h-[96px] py-2")} rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Type a short question" />
            </Field>
            <Row className="pt-0"><Button type="submit" className="h-9" disabled={busy === "try" || !prompt.trim() || !tryModel}>{busy === "try" ? <><Spinner /> Waiting…</> : "Send"}</Button></Row>
            <Hint>A test only; it changes no default. Cloud models cost a little, the local one is free.</Hint>
            {answer && (
              <div className={cn("rounded-md border p-3", answer.ok ? "border-border" : "border-destructive/45")}>
                <div className="text-xs text-muted-foreground">
                  {answer.model} · {((answer.ms || 0) / 1000).toFixed(1)} s
                  {answer.ok && <> · {answer.usage ? `${answer.usage.in} in / ${answer.usage.out} out tokens · ` : ""}{answer.costUsd == null ? "cost unknown" : money(answer.costUsd)}</>}
                </div>
                <div className={cn("mt-2 whitespace-pre-wrap text-base", answer.ok ? "text-foreground" : "text-destructive")}>{answer.text}</div>
              </div>
            )}
          </Form>
          <div className="mt-8 max-w-[860px]">
            <Label className="mb-3">Recent calls</Label>
            <Table cols="110px 1.4fr 1fr 110px 70px 60px 1fr" head={["When (UTC)", "Model", "For", "Tokens in / out", "Cost", "Time", ""]} empty="No calls yet."
              rows={(data.recent || []).map((c, i) => ({
                key: `${c.created_at}-${i}`, cells: [
                  <span key="w" className="tabular-nums">{utc(c.created_at)}</span>,
                  `${SOURCE_NAME[c.source] || c.source} · ${c.model}`,
                  c.purpose,
                  <span key="t" className="tabular-nums">{c.prompt_tokens} / {c.completion_tokens}</span>,
                  money(c.cost_usd),
                  `${((c.ms || 0) / 1000).toFixed(1)} s`,
                  c.status === "ok" ? <span key="s" className="text-muted-foreground">ok</span> : <span key="s" className="break-words text-destructive">{c.error || "failed"}</span>,
                ],
              }))} />
          </div>
        </div>
      )}
    </Page>
  );
}

// ── Admin · People ────────────────────────────────────────────────────────
function PeoplePage({ msg, setMsg, go }) {
  const [data, setData] = useState(null);
  useEffect(() => { get("/dz/api/settings/people").then(setData).catch((e) => setMsg({ kind: "err", text: e.message })); }, [setMsg]);
  return (
    <Page title="People" text="Who can sign in here, their role and monthly limit." msg={msg}
      action={<Button type="button" className="h-9" onClick={() => go("people", "new")}>Add an account</Button>}>
      {!data ? <Loading /> : (
        <Table className="max-w-[860px]" cols="1.2fr 130px 150px 110px 120px" head={["Person", "Role", "Monthly limit", "Status", ""]} empty="Nobody yet."
          rows={data.people.map((u) => ({
            key: u.id, cells: [
              <span key="n"><b className="font-medium">{u.name}</b> <span className="text-muted-foreground">{u.username}</span>{(u.owner || u.id === data.me) && <Sub>{[u.owner && "owner", u.id === data.me && "you"].filter(Boolean).join(" · ")}</Sub>}</span>,
              u.role === "admin" ? "Admin" : "User",
              u.limit == null ? <span key="l" className="text-muted-foreground">no limit</span> : usd(u.limit),
              u.blocked ? <Status key="s" tone="er">blocked</Status> : <Status key="s" tone="ok">active</Status>,
              <Small key="e" onClick={() => go("people", String(u.id))}>Edit</Small>,
            ],
          }))} />
      )}
    </Page>
  );
}

function PersonPage({ id, msg, setMsg, go, confirm, onMeChanged }) {
  const isNew = id === "new";
  const [data, setData] = useState(isNew ? { people: [], me: null } : null);
  const [f, setF] = useState({ name: "", username: "", password: "", role: "user", limit: "" });
  const [busy, run] = useAction(setMsg);
  const person = !isNew && data ? data.people.find((u) => String(u.id) === id) : null;
  useEffect(() => {
    if (isNew) return;
    get("/dz/api/settings/people").then((d) => {
      const u = d.people.find((x) => String(x.id) === id);
      if (!u) { go("people"); return; }
      setData(d);
      setF({ name: u.name, username: u.username, password: "", role: u.role, limit: u.limit == null ? "" : String(u.limit) });
    }).catch((e) => setMsg({ kind: "err", text: e.message }));
  }, [id, isNew, go, setMsg]);
  const set = (k) => (v) => setF((cur) => ({ ...cur, [k]: v }));
  const submit = async () => {
    if (isNew) {
      const r = await run("save", () => post("/dz/api/settings/people", { name: f.name, username: f.username, password: f.password, role: f.role, limit: f.limit }));
      if (r) go("people", "", r.notice);
      return;
    }
    const r = await run("save", () => post(`/dz/api/settings/people/${id}`, { name: f.name, role: f.role, limit: f.limit, newPassword: f.password || undefined }));
    if (r) {
      setF((cur) => ({ ...cur, password: "" }));
      setData((d) => ({ ...d, people: d.people.map((u) => (String(u.id) === id ? { ...u, name: f.name, role: f.role, limit: f.limit === "" ? null : Number(f.limit) } : u)) }));
      if (person?.id === data?.me) onMeChanged?.();
    }
  };
  const block = async () => {
    const on = !person.blocked;
    if (on && !(await confirm({ title: `Block ${person.name}?`, text: "They are signed out at once and cannot sign in until you unblock them. Their work stays.", yes: "Block", danger: true }))) return;
    const r = await run("block", () => post(`/dz/api/settings/people/${id}/block`, { blocked: on }));
    if (r) setData((d) => ({ ...d, people: d.people.map((u) => (String(u.id) === id ? { ...u, blocked: on } : u)) }));
  };
  const remove = async () => {
    if (!(await confirm({ title: `Delete ${person.name}’s account?`, text: "They are signed out and can no longer sign in; their ChatGPT connection is removed. Their pictures, videos and spending stay on the server. This cannot be undone here.", yes: "Delete account", danger: true }))) return;
    const r = await run("delete", () => call("DELETE", `/dz/api/settings/people/${id}`));
    if (r) go("people", "", r.notice);
  };
  if (!isNew && !person) return <Page title="Person" msg={msg}><Loading /></Page>;
  const self = person && person.id === data.me;
  return (
    <Page title={isNew ? "New account" : person.name} msg={msg}
      text={isNew ? "They sign in with this username and password and can change the password themselves." : `${person.username} · ${person.role === "admin" ? "Admin" : "User"}${person.owner ? " · owner of this server" : ""}${person.blocked ? " · blocked" : ""}`}>
      <Form onSubmit={submit}>
        <Back onClick={() => go("people")}>All people</Back>
        <Field label="Name"><input className={inputCls} value={f.name} onChange={(e) => set("name")(e.target.value)} placeholder="e.g. Anna" required maxLength={80} /></Field>
        {isNew
          ? <Field label="Username"><input className={inputCls} value={f.username} onChange={(e) => set("username")(e.target.value)} placeholder="e.g. anna" required {...noFill} /></Field>
          : <Field label="Username"><input className={inputCls} value={f.username} disabled /></Field>}
        {!isNew && <Hint>The username is the sign-in name and cannot be changed.</Hint>}
        <Field label={isNew ? "Password" : "New password (optional)"}>
          <input type="password" className={inputCls} value={f.password} onChange={(e) => set("password")(e.target.value)} placeholder={isNew ? "At least 8 characters" : "Leave empty to keep the current one"} autoComplete="new-password" minLength={8} required={isNew} />
        </Field>
        {!isNew && <Hint>A new password signs them out everywhere; tell them the new one yourself.</Hint>}
        <Field label="Role">
          <NativeSelect value={f.role} onChange={set("role")} disabled={person?.owner}>
            <option value="user">User</option>
            <option value="admin">Admin</option>
          </NativeSelect>
        </Field>
        {person?.owner && <Hint>The owner of this server stays an admin.</Hint>}
        <Field label="Monthly limit, USD"><input type="number" min="0" step="0.5" className={inputCls} value={f.limit} onChange={(e) => set("limit")(e.target.value)} placeholder="Empty = no limit" /></Field>
        <Hint>The limit covers everything this person generates in a month, on all providers, and their text-model calls.</Hint>
        <Row>
          <Button type="submit" className="h-9" disabled={busy === "save" || !f.name.trim() || (isNew && (!f.username.trim() || f.password.length < 8)) || (!isNew && f.password && f.password.length < 8)}>
            {busy === "save" ? <Spinner /> : isNew ? "Create account" : "Save"}
          </Button>
          <Button type="button" variant="ghost" className="h-9" onClick={() => go("people")}>Cancel</Button>
        </Row>
        {!isNew && !self && !person.owner && (
          <>
            <Sec>Access</Sec>
            <Item title={person.blocked ? "Blocked" : "Can sign in"} text={person.blocked ? "Unblock to let them sign in again." : "Blocking signs them out at once. Their work stays."}>
              <Button type="button" variant="outline" className="h-8" disabled={busy === "block"} onClick={block}>{person.blocked ? "Unblock" : "Block"}</Button>
            </Item>
            <Item title="Delete account" text="They can no longer sign in and leave this list. Their pictures, videos and spending stay on the server." titleClass="text-destructive">
              <Button type="button" variant="ghost" className="h-8 text-destructive hover:text-destructive" disabled={busy === "delete"} onClick={remove}>Delete</Button>
            </Item>
          </>
        )}
      </Form>
    </Page>
  );
}

// ── The two panes ─────────────────────────────────────────────────────────
const NOTICE = { welcome: "Admin created. Add provider keys below." };

export default function DzSettings({ user, onChangesSeen, onMeChanged }) {
  const isAdmin = user?.role === "admin";
  const [route, setRoute] = useState(() => (typeof window === "undefined" ? { section: "account", item: "" } : dzSettingsRoute(window.location.pathname, isAdmin)));
  const [msg, setMsgState] = useState(() => {
    if (typeof window === "undefined") return null;
    const n = new URLSearchParams(window.location.search).get("notice");
    return NOTICE[n] ? { kind: "ok", text: NOTICE[n] } : null;
  });
  const setMsg = useCallback((m) => setMsgState(m), []);
  const [dialog, confirm] = useConfirm();

  // The address follows the section (a reload and Back keep the place).
  useEffect(() => {
    const sync = () => { setRoute(dzSettingsRoute(window.location.pathname, isAdmin)); setMsgState(null); };
    window.addEventListener("popstate", sync);
    window.addEventListener("dz:settings-nav", sync);
    return () => { window.removeEventListener("popstate", sync); window.removeEventListener("dz:settings-nav", sync); };
  }, [isAdmin]);
  useEffect(() => {
    const want = pathOf(route.section, route.item);
    if (window.location.pathname !== want) window.history.replaceState(null, "", want);
  }, [route]);
  const go = useCallback((section, item = "", notice = null) => {
    const path = pathOf(section, item);
    if (window.location.pathname !== path) window.history.pushState(null, "", path);
    setRoute({ section, item });
    setMsgState(notice ? { kind: "ok", text: notice } : null);
  }, []);

  const props = { msg, setMsg, go, confirm };
  let page;
  switch (route.section) {
    case "text-model": page = <TextModelPage key="tm" {...props} />; break;
    case "providers": page = route.item ? <ProviderPage key={`p-${route.item}`} id={route.item} {...props} /> : <ProvidersPage key="p" {...props} />; break;
    case "models": page = <ModelsPage key="m" {...props} />; break;
    case "changes": page = <ChangesPage key="c" {...props} onSeen={onChangesSeen} />; break;
    case "text-models": page = <TextModelsPage key="tms" tab={route.item === "try" ? "try" : "sources"} {...props} />; break;
    case "people": page = route.item ? <PersonPage key={`u-${route.item}`} id={route.item} {...props} onMeChanged={onMeChanged} /> : <PeoplePage key="u" {...props} />; break;
    default: page = <AccountPage key="a" {...props} />;
  }
  const row = ([id, label]) => (
    <a key={id} href={pathOf(id)} aria-current={route.section === id ? "page" : undefined}
      onClick={(e) => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey) { e.preventDefault(); go(id); } }}
      className={cn("flex h-9 min-w-0 items-center gap-2.5 rounded-md px-2.5 text-base", route.section === id ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-accent hover:text-foreground")}>
      <span className="truncate">{label}</span>
    </a>
  );
  return (
    <div className="flex h-full min-w-0">
      <aside className="flex w-[296px] flex-none flex-col gap-0.5 overflow-y-auto border-r border-border p-3" aria-label="Settings sections">
        <div className="flex h-9 items-center px-2.5 text-lg font-semibold text-foreground">Settings</div>
        <div className="mt-3 flex h-7 items-center px-2.5 text-xs uppercase tracking-[0.06em] text-subtle">You</div>
        {YOU.map(row)}
        {isAdmin && (
          <>
            <div className="mt-3 flex h-7 items-center px-2.5 text-xs uppercase tracking-[0.06em] text-subtle">This server · admin only</div>
            {ADMIN.map(row)}
          </>
        )}
      </aside>
      {page}
      {dialog}
    </div>
  );
}
