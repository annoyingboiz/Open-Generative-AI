"use client";

// Segmented control: a row of options that always fits (wraps, never scrolls
// sideways). For long lists use Select instead.
import { cn } from "./utils.js";

export function Segmented({ value, onChange, options, className, size = "default", "aria-label": ariaLabel }) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn("flex flex-wrap gap-1 rounded-xl bg-accent/60 p-1", className)}>
      {options.map((o) => {
        const opt = typeof o === "object" ? o : { value: o, label: String(o) };
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={opt.disabled}
            onClick={() => onChange(opt.value)}
            className={cn(
              "flex-1 whitespace-nowrap rounded-lg font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              size === "sm" ? "h-9 px-3 text-base" : "h-10 px-4 text-base",
              active ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {opt.icon}
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
