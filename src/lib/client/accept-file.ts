/** "video/*,.csv" → does the file match (by MIME type or extension)? */
export function acceptsFile(f: File, accept?: string): boolean {
  if (!accept) return true;
  const name = f.name.toLowerCase();
  return accept
    .split(",")
    .map((a) => a.trim().toLowerCase())
    .filter(Boolean)
    .some((a) => (a.startsWith(".") ? name.endsWith(a) : a.endsWith("/*") ? f.type.startsWith(a.slice(0, -1)) : f.type === a));
}
