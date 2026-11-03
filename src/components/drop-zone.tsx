"use client";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { acceptsFile } from "@/lib/client/accept-file";

/**
 * Drag files from the computer onto this area (as well as clicking the usual button inside). While
 * files are dragged over it, the area is outlined with a "drop here" hint; files of another type are
 * left out (onRejected tells which).
 */
export function DropZone({
  onFiles,
  accept,
  multiple = true,
  label = "Upuść pliki tutaj",
  className,
  dark,
  children,
  onRejected,
  "data-testid": testId,
}: {
  onFiles: (files: File[]) => void;
  accept?: string;
  multiple?: boolean;
  label?: string;
  className?: string;
  dark?: boolean;
  children: React.ReactNode;
  onRejected?: (names: string[]) => void;
  "data-testid"?: string;
}) {
  const [over, setOver] = useState(false);
  // dragenter / dragleave fire for every child: count them so the outline does not flicker
  const depth = useRef(0);
  const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  return (
    <div
      className={cn("relative", className)}
      data-testid={testId}
      onDragEnter={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setOver(true);
      }}
      onDragOver={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(e) => {
        if (!hasFiles(e)) return;
        depth.current = Math.max(0, depth.current - 1);
        if (!depth.current) setOver(false);
      }}
      onDrop={(e) => {
        if (!hasFiles(e)) return;
        e.preventDefault();
        depth.current = 0;
        setOver(false);
        const all = Array.from(e.dataTransfer.files);
        const ok = all.filter((f) => acceptsFile(f, accept));
        const bad = all.filter((f) => !ok.includes(f)).map((f) => f.name);
        if (bad.length) onRejected?.(bad);
        if (ok.length) onFiles(multiple ? ok : ok.slice(0, 1));
      }}
    >
      {children}
      {over ? (
        <div className={cn("pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-[inherit] border-2 border-dashed text-sm font-medium", dark ? "border-sky-400 bg-sky-400/10 text-sky-200" : "border-brand bg-brand/[.06] text-brand")}>
          {label}
        </div>
      ) : null}
    </div>
  );
}
