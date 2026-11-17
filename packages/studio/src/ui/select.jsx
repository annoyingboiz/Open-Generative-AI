"use client";

// Select with optional description and right-side meta per option.
//   <Select value onValueChange options=[{ value, label, description, meta, icon }] />
import * as SelectPrimitive from "@radix-ui/react-select";
import { cn } from "./utils.js";

const Chevron = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden><path d="M6 9l6 6 6-6" /></svg>
);
const Check = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden><path d="M5 12l4 4L19 6" /></svg>
);

export function Select({ value, onValueChange, options, placeholder = "Choose…", className, "aria-label": ariaLabel }) {
  const current = options.find((o) => o.value === value);
  return (
    <SelectPrimitive.Root value={value} onValueChange={onValueChange}>
      <SelectPrimitive.Trigger
        aria-label={ariaLabel}
        className={cn(
          "flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-input bg-background/60 px-3.5 py-2 text-left text-base text-foreground transition-colors hover:border-foreground/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-3">
          {current?.icon}
          <span className="min-w-0">
            <span className="block truncate font-semibold">{current ? current.label : placeholder}</span>
            {current?.description && <span className="block truncate text-muted-foreground">{current.description}</span>}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2 text-muted-foreground">
          {current?.meta && <span className="tabular-nums">{current.meta}</span>}
          <Chevron />
        </span>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content position="popper" sideOffset={6} className="z-[300] max-h-[min(420px,var(--radix-select-content-available-height))] w-[var(--radix-select-trigger-width)] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl">
          <SelectPrimitive.Viewport className="p-1">
            {options.map((o) => (
              <SelectPrimitive.Item
                key={o.value}
                value={o.value}
                disabled={o.disabled}
                className="relative flex cursor-pointer select-none items-start gap-3 rounded-lg px-3 py-2.5 text-base outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-40"
              >
                {o.icon}
                <span className="min-w-0 flex-1">
                  <SelectPrimitive.ItemText>
                    <span className="block font-semibold">{o.label}</span>
                  </SelectPrimitive.ItemText>
                  {o.description && <span className="block text-muted-foreground">{o.description}</span>}
                </span>
                {o.meta && <span className="shrink-0 pt-0.5 tabular-nums text-muted-foreground">{o.meta}</span>}
                <SelectPrimitive.ItemIndicator className="shrink-0 pt-0.5 text-primary"><Check /></SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  );
}
