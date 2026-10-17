"use client";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { FONT_FAMILIES } from "@/lib/themes";
import type { ThemeTokens } from "@/lib/editor/types";
import { resolveColor } from "@/lib/render/compositor";

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="border-b border-studio-line px-4 py-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-studio-muted">{title}</h3>
        {right}
      </div>
      <div className="space-y-3">{children}</div>
    </div>
  );
}

export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="grid grid-cols-[96px_1fr] items-center gap-3 text-[12.5px] text-studio-text">
      <span className="text-studio-muted">{label}</span>
      <span className="min-w-0">{children}</span>
    </label>
  );
}

export function Slider({ value, min, max, step = 1, onChange, format, "aria-label": label }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; format?: (v: number) => string; "aria-label"?: string }) {
  return (
    <span className="flex items-center gap-2">
      <input type="range" className="range" min={min} max={max} step={step} value={value} aria-label={label} onChange={(e) => onChange(Number(e.target.value))} />
      <span className="tabular w-12 shrink-0 text-right text-[11.5px] text-studio-muted">{format ? format(value) : Math.round(value * 100) / 100}</span>
    </span>
  );
}

export function NumberField({ value, onChange, step = 0.1, min, max, suffix }: { value: number; onChange: (v: number) => void; step?: number; min?: number; max?: number; suffix?: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="number"
        className="h-8 w-full rounded-lg border border-studio-line bg-studio-3 px-2 text-[12.5px] text-studio-text outline-none focus:border-white/30"
        value={Number.isFinite(value) ? Math.round(value * 1000) / 1000 : ""}
        step={step}
        min={min}
        max={max}
        onChange={(e) => {
          const v = Number(e.target.value);
          if (Number.isFinite(v)) onChange(v);
        }}
      />
      {suffix ? <span className="text-[11px] text-studio-muted">{suffix}</span> : null}
    </span>
  );
}

export function TextField(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn("h-8 w-full rounded-lg border border-studio-line bg-studio-3 px-2 text-[12.5px] text-studio-text outline-none focus:border-white/30", props.className)} />;
}

export function Select({ value, onChange, children, className, "aria-label": label }: { value: string | number; onChange: (v: string) => void; children: ReactNode; className?: string; "aria-label"?: string }) {
  return (
    <select value={value} aria-label={label} onChange={(e) => onChange(e.target.value)} className={cn("h-8 w-full rounded-lg border border-studio-line bg-studio-3 px-2 text-[12.5px] text-studio-text outline-none", className)}>
      {children}
    </select>
  );
}

export function FontSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Select value={value} onChange={onChange}>
      <option value="$question">Motyw: czcionka pytań</option>
      <option value="$subtitle">Motyw: czcionka napisów</option>
      <option value="$label">Motyw: czcionka etykiet</option>
      {FONT_FAMILIES.map((f) => (
        <option key={f} value={f}>
          {f}
        </option>
      ))}
    </Select>
  );
}

const TOKENS: Array<[string, string]> = [
  ["$primary", "Główny"],
  ["$accent", "Akcent"],
  ["$highlight", "Podświetlenie"],
  ["$text", "Tekst"],
  ["$secondary", "Dodatkowy"],
  ["$background", "Tło"],
];

/** Colour picker that can link to a theme token, so theme changes propagate. */
export function ColorField({ value, onChange, theme, allowNone }: { value: string | null; onChange: (v: string | null) => void; theme: ThemeTokens; allowNone?: boolean }) {
  const resolved = value ? resolveColor(value, theme) : "#000000";
  const isToken = !!value && value.startsWith("$");
  return (
    <span className="flex items-center gap-1.5">
      <input
        type="color"
        aria-label="Kolor"
        className="h-8 w-8 shrink-0 cursor-pointer rounded-md border border-studio-line bg-transparent p-0.5"
        value={/^#[0-9a-fA-F]{6}$/.test(resolved) ? resolved : "#000000"}
        onChange={(e) => onChange(e.target.value)}
      />
      <Select value={isToken ? value! : value === null ? "none" : "custom"} onChange={(v) => onChange(v === "none" ? null : v === "custom" ? resolved : v)}>
        {allowNone ? <option value="none">Brak</option> : null}
        <option value="custom">Własny {isToken ? "" : value ?? ""}</option>
        {TOKENS.map(([t, l]) => (
          <option key={t} value={t}>
            Motyw: {l}
          </option>
        ))}
      </Select>
    </span>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => onChange(!checked)} className="flex w-full items-center justify-between text-[12.5px] text-studio-text">
      <span>{label}</span>
      <span className={cn("relative inline-flex h-5 w-9 items-center rounded-full transition", checked ? "bg-white" : "bg-studio-line")}>
        <span className={cn("h-4 w-4 rounded-full transition", checked ? "translate-x-[18px] bg-black" : "translate-x-0.5 bg-white")} />
      </span>
    </button>
  );
}

export function Seg<T extends string>({ value, options, onChange }: { value: T; options: Array<[T, string]>; onChange: (v: T) => void }) {
  return (
    <span className="flex rounded-lg border border-studio-line bg-studio-3 p-0.5">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={cn("flex-1 rounded-md px-2 py-1 text-[11.5px] transition", value === v ? "bg-white text-black" : "text-studio-muted hover:text-studio-text")}>
          {l}
        </button>
      ))}
    </span>
  );
}

export function SButton({
  children,
  onClick,
  variant = "default",
  disabled,
  className,
  title,
  ...rest
}: { children: ReactNode; onClick?: () => void; variant?: "default" | "primary" | "ghost" | "danger"; disabled?: boolean; className?: string; title?: string; "data-testid"?: string }) {
  return (
    <button
      {...rest}
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-[12.5px] font-medium transition disabled:pointer-events-none disabled:opacity-40 [&_svg]:size-3.5",
        variant === "primary" && "bg-white text-black hover:bg-white/90",
        variant === "default" && "border border-studio-line bg-studio-3 text-studio-text hover:bg-studio-line",
        variant === "ghost" && "text-studio-muted hover:bg-studio-3 hover:text-studio-text",
        variant === "danger" && "border border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/20",
        className,
      )}
    >
      {children}
    </button>
  );
}
