"use client";

// Side panel (Radix Dialog). Non-modal by default, so the page behind it
// stays usable — the user keeps working while the panel is open.
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { cn } from "./utils.js";

export function Sheet({ open, onOpenChange, title, actions, children, side = "right", modal = false, className }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={modal}>
      <DialogPrimitive.Portal>
        {modal && <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/50" />}
        <DialogPrimitive.Content
          onInteractOutside={(e) => { if (!modal) e.preventDefault(); }}
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
