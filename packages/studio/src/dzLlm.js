// DZ: text models (LLM) from the studio — the list and one call.
// The gateway does the work (keys, prices, limits, "local machine busy").
import { useEffect, useState } from "react";

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
