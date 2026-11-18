"use client";

// DZ: one settings control drawn from a server spec (range with "Auto",
// switch, segmented choice, text). Shared by image and video upscaling.
import { Button, Segmented, Slider, Switch, Textarea, InfoTip, cn } from "../ui/index.js";

export function FieldLabel({ field }) {
  return (
    <span className="flex items-center gap-2 text-base font-medium text-foreground">
      {field.label}
      <InfoTip text={field.hint} />
    </span>
  );
}

// One control, drawn from the server spec. Ranges without a default are
// "Auto" (the model decides) until switched to manual.
export function Field({ field, value, onChange }) {
  if (field.type === "bool") {
    const on = value === undefined || value === null ? Boolean(field.default) : Boolean(value);
    return (
      <div className="flex items-center justify-between gap-3 py-2.5">
        <FieldLabel field={field} />
        <Switch checked={on} onCheckedChange={onChange} aria-label={field.label} />
      </div>
    );
  }
  if (field.type === "select") {
    const current = value === undefined || value === null || value === "" ? field.default : value;
    const options = [
      ...(field.default == null ? [{ value: "__auto", label: "Auto" }] : []),
      ...field.options.map((o) => ({ value: o, label: field.labels?.[o] || o })),
    ];
    return (
      <div className="space-y-2 py-2.5">
        <FieldLabel field={field} />
        <Segmented size="sm" value={current ?? "__auto"} onChange={(v) => onChange(v === "__auto" ? null : v)} options={options} aria-label={field.label} />
      </div>
    );
  }
  if (field.type === "text") {
    return (
      <div className="space-y-2 py-2.5">
        <FieldLabel field={field} />
        <Textarea value={value || ""} maxLength={field.max} onChange={(e) => onChange(e.target.value)} placeholder="Describe the image (optional)" rows={3} />
      </div>
    );
  }
  const canAuto = field.default === null || field.default === undefined;
  const isAuto = canAuto && (value === undefined || value === null || value === "");
  const shown = isAuto ? field.start : (value === undefined || value === null || value === "" ? field.default : Number(value));
  return (
    <div className="space-y-1 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel field={field} />
        <span className="flex items-center gap-2">
          {canAuto && (
            <Button
              size="sm"
              variant={isAuto ? "secondary" : "ghost"}
              className={cn("h-8 px-2.5", isAuto && "text-primary")}
              onClick={() => onChange(isAuto ? field.start : null)}
              aria-pressed={isAuto}
            >
              Auto
            </Button>
          )}
          <span className={cn("w-12 text-right tabular-nums", isAuto ? "text-muted-foreground/60" : "text-foreground")}>{field.step === 1 ? shown : Number(shown).toFixed(2)}</span>
        </span>
      </div>
      <Slider min={field.min} max={field.max} step={field.step} value={[Number(shown)]} disabled={isAuto} onValueChange={([v]) => onChange(v)} aria-label={field.label} />
    </div>
  );
}

export const fieldApplies = (field, valueOf) => !field.when || Object.entries(field.when).every(([k, want]) => valueOf(k) === want);
