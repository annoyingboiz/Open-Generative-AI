// DZ UI kit (shadcn-style). cn() merges Tailwind classes without conflicts.
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs) {
  return twMerge(clsx(inputs));
}
