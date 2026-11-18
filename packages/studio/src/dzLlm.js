// DZ: text models (LLM) from the studio — the list and one call.
// The gateway does the work (keys, prices, limits, "local machine busy").
import { useEffect, useMemo, useState } from "react";

async function call(method, url, body) {
  const res = await fetch(url, { method, credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

export const dzLlm = {
  models: () => call("GET", "/dz/api/llm/models"),
  // { model?, system?, messages?, prompt?, images?, maxTokens?, temperature?, purpose? } → { text, model, usage, costUsd, ms }
  chat: (body) => call("POST", "/dz/api/llm/chat", body),
};

let cached = null;
export function useDzLlmModels() {
  const [state, setState] = useState(cached || { sources: [], models: [], default: null, loaded: false });
  useEffect(() => {
    let alive = true;
    dzLlm.models().then((d) => { cached = { ...d, loaded: true }; if (alive) setState(cached); }).catch(() => alive && setState((s) => ({ ...s, loaded: true })));
    return () => { alive = false; };
  }, []);
  return state;
}

// Text models to pick from: your default first, then the recommended ones
// (OptionSelect options: value, label, description, meta).
export function useDzTextModelOptions({ all = false } = {}) {
  const llm = useDzLlmModels();
  return useMemo(() => {
    const list = llm.models || [];
    // all: every text model you can use (recommended first); otherwise the short list.
    const pick = all ? [...list.filter((m) => m.recommended), ...list] : list.filter((m) => m.recommended || m.id === llm.default);
    const seen = new Set();
    const options = [...pick.filter((m) => m.id === llm.default), ...pick]
      .filter((m) => (seen.has(m.id) ? false : seen.add(m.id)))
      .map((m) => ({ value: m.id, label: m.name, vision: Boolean(m.vision), description: m.id === llm.default ? "Your default" : m.source === "chatgpt" ? "Your ChatGPT plan" : m.source === "local" ? "This server, free" : m.source === "atlas" ? "Atlas" : "APIMart", meta: m.free ? "free" : m.price ? `$${(+m.price.out).toFixed(2)}/1M` : "" }));
    return { options, def: llm.default, loaded: llm.loaded, all: list };
  }, [llm, all]);
}
