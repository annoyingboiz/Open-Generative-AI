"use client";

import { forwardRef } from "react";
import { cn } from "./utils.js";

const field = "w-full rounded-xl border border-input bg-background/60 px-3.5 text-base text-foreground placeholder:text-muted-foreground/70 transition-colors focus-visible:outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50";

export const Input = forwardRef(function Input({ className, ...props }, ref) {
  return <input ref={ref} className={cn(field, "h-11", className)} {...props} />;
});

export const Textarea = forwardRef(function Textarea({ className, ...props }, ref) {
  return <textarea ref={ref} className={cn(field, "min-h-[96px] resize-none py-3", className)} {...props} />;
});

export function Label({ className, ...props }) {
  return <label className={cn("text-base font-medium text-foreground", className)} {...props} />;
}
