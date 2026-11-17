"use client";

import * as SliderPrimitive from "@radix-ui/react-slider";
import { cn } from "./utils.js";

export function Slider({ className, ...props }) {
  return (
    <SliderPrimitive.Root className={cn("relative flex w-full touch-none select-none items-center py-2 data-[disabled]:cursor-not-allowed data-[disabled]:opacity-40", className)} {...props}>
      <SliderPrimitive.Track className="relative h-1.5 w-full grow overflow-hidden rounded-full bg-input">
        <SliderPrimitive.Range className="absolute h-full bg-primary" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="block h-5 w-5 rounded-full border-2 border-primary bg-background shadow transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40" />
    </SliderPrimitive.Root>
  );
}
