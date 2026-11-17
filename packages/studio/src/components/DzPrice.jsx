"use client";

// DZ: price of the current request, asked from the provider for our account
// (Atlas "calculate", APIMart account pricing) before you press Generate.
// `build` returns [generateFn, params] for exactly what Generate would send,
// or null when the request is not complete yet.
import { useEffect, useRef, useState } from "react";
import { DZ_QUOTE } from "../api.js";

const fmt = (usd) => (usd >= 1 ? usd.toFixed(2) : usd >= 0.1 ? usd.toFixed(2) : usd >= 0.01 ? usd.toFixed(3) : usd.toFixed(4)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");

export function useDzQuote(apiKey, build, count = 1) {
  const [state, setState] = useState({ price: null, loading: false });
  let request = null;
  try { request = build(); } catch { request = null; }
  // Prompt text and reference files don't change the price; the rest does.
  const key = request ? JSON.stringify(request[1], (k, v) => (k === "prompt" ? Boolean(String(v || "").trim()) : k === "negative_prompt" ? undefined : v)) : "";
  const fnRef = useRef(null);
  fnRef.current = request;

  useEffect(() => {
    if (!key) { setState({ price: null, loading: false }); return undefined; }
    let cancelled = false;
    setState((s) => ({ ...s, loading: true }));
    const timer = setTimeout(async () => {
      const current = fnRef.current;
      if (!current) return;
      const [fn, params] = current;
      try {
        const price = await fn(apiKey, { ...params, onRequestId: DZ_QUOTE });
        if (!cancelled) setState({ price: price && Number.isFinite(price.usd) ? price : null, loading: false });
      } catch {
        if (!cancelled) setState({ price: null, loading: false });
      }
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [key, apiKey]);

  const total = state.price ? state.price.usd * Math.max(1, count) : null;
  return { ...state, total };
}

// Small label next to the Generate button. Falls back to the catalog label.
export default function DzPrice({ apiKey, build, count = 1, provider = "", fallback = "", className = "" }) {
  const { price, total, loading } = useDzQuote(apiKey, build, count);
  const label = price ? `${price.exact ? "" : "≈ "}$${fmt(total)}` : fallback || "price n/a";
  const title = price
    ? `${price.source === "quote" ? (price.exact ? "Exact price for your account" : "Provider estimate") : "Catalog price"}${count > 1 ? ` · ${count} × $${fmt(price.usd)}` : ""}`
    : "No price from the provider yet";
  return (
    <span className={`text-[11px] whitespace-nowrap tabular-nums ${loading ? "text-white/30" : "text-white/55"} ${className}`} title={title}>
      {[provider, label].filter(Boolean).join(" · ")}
    </span>
  );
}
