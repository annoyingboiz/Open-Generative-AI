"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { cn } from "./utils.js";

export const TooltipProvider = TooltipPrimitive.Provider;

// <Tip text="...">{trigger}</Tip>
export function Tip({ text, children, side = "top" }) {
  if (!text) return children;
  return (
    <TooltipPrimitive.Provider delayDuration={250}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={6}
            className={cn("z-[300] max-w-xs rounded-lg border border-border bg-popover px-3 py-2 text-base leading-snug text-popover-foreground shadow-xl")}
          >
            {text}
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

// Small "i" that explains a setting on hover or focus.
export function InfoTip({ text }) {
  if (!text) return null;
  return (
    <Tip text={text}>
      <button type="button" tabIndex={0} aria-label="More info" className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-base font-bold leading-none text-muted-foreground hover:text-foreground">
        i
      </button>
    </Tip>
  );
}
