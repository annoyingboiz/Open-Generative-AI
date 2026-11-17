// DZ UI kit: the official shadcn/ui components (./shadcn, added with
// `npx shadcn@2.3.0 add …` — Tailwind 3 line) plus a few DZ compositions
// (./dz.jsx). Tokens in app/globals.css; Inter everywhere, 16 px minimum.
export { cn } from "./utils.js";
export { Button, buttonVariants } from "./shadcn/button.jsx";
export { Input } from "./shadcn/input.jsx";
export { Textarea } from "./shadcn/textarea.jsx";
export { Label } from "./shadcn/label.jsx";
export { Switch } from "./shadcn/switch.jsx";
export { Slider } from "./shadcn/slider.jsx";
export { Badge } from "./shadcn/badge.jsx";
export { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "./shadcn/card.jsx";
export { Separator } from "./shadcn/separator.jsx";
export { ScrollArea, ScrollBar } from "./shadcn/scroll-area.jsx";
export { Tabs, TabsList, TabsTrigger, TabsContent } from "./shadcn/tabs.jsx";
export { ToggleGroup, ToggleGroupItem } from "./shadcn/toggle-group.jsx";
export * as SelectParts from "./shadcn/select.jsx";
export * as DialogParts from "./shadcn/dialog.jsx";
export * as DropdownMenuParts from "./shadcn/dropdown-menu.jsx";
export { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./shadcn/tooltip.jsx";
export { Popover, PopoverTrigger, PopoverContent } from "./shadcn/popover.jsx";
export { OptionSelect, Segmented, ScrollTabs, Tip, InfoTip, SidePanel, SectionLabel, Spinner, Logo } from "./dz.jsx";
