"use client";

// Side panel (Radix Dialog). On desktop it is non-modal: the page behind stays
// usable while the panel is open. On narrow screens it covers the page, so it
// is a real modal there (overlay, focus kept inside). Focus returns to
// whatever opened it.
import { useEffect, useRef, useState } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "./utils.js";

function useWide(query = "(min-width: 768px)") {
  const [wide, setWide] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return wide;
}

export function Sheet({ open, onOpenChange, title, actions, children, side = "right", className }) {
  const wide = useWide();
  const modal = !wide;
  const opener = useRef(null);
  useEffect(() => {
    if (open && !opener.current && typeof document !== "undefined") opener.current = document.activeElement;
  }, [open]);
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogPrimitive.Portal>
        {modal && <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/60" />}
        <DialogPrimitive.Content
          onInteractOutside={(e) => { if (!modal) e.preventDefault(); }}
          onCloseAutoFocus={(e) => {
            const el = opener.current;
            opener.current = null;
            if (el && typeof el.focus === "function" && document.contains(el)) { e.preventDefault(); el.focus(); }
          }}
          className={cn(
            "dz-sheet fixed bottom-0 top-14 z-[70] flex w-full max-w-[420px] flex-col border-border bg-card text-card-foreground shadow-[-16px_0_40px_rgba(0,0,0,0.45)] focus:outline-none",
            side === "right" ? "right-0 border-l" : "left-0 border-r",
            className,
          )}
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            <DialogPrimitive.Title className="text-lg font-semibold">{title}</DialogPrimitive.Title>
            <div className="flex items-center gap-1">
              {actions}
              <DialogPrimitive.Close className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-accent hover:text-foreground" aria-label="Close">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
              </DialogPrimitive.Close>
            </div>
          </div>
          <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>
          <div className="min-h-0 flex-1">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
