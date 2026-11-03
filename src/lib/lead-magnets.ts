/**
 * The brand's lead magnets (free materials). Content scoring picks the one that fits the reel and the
 * CTA may only point to these — their DM keyword or name, never an invented one.
 * Edited as text, one per line: SŁOWO | Nazwa | o czym / dla kogo | link (optional)
 */
export interface LeadMagnet {
  keyword: string;
  name: string;
  about: string;
  url?: string | null;
}

/** DUO® – terapia par: the 10 "Wiedza" materials (DM keywords are a proposal — set them as in the DM automation). */
export const DUO_LEAD_MAGNETS: LeadMagnet[] = [
  { keyword: "DROGI", name: "Mapa 3 dróg", about: "Ratować związek, dać sobie czas czy się rozstać? Trzy kierunki i pytania przed decyzją – dla osób, którym myśli o związku krążą w kółko", url: "/wiedza/mapa-trzech-drog" },
  { keyword: "PYTANIA", name: "21 pytań o relacji", about: "Pytania do rozmowy lub refleksji w 5 obszarach (komunikacja, bliskość, zaufanie…) – gdy nie wiadomo, od czego zacząć rozmowę", url: "/wiedza/21-pytan-o-relacji" },
  { keyword: "KRYZYS", name: "Kryzys czy koniec miłości?", about: "10 pytań do autorefleksji i ćwiczenia – gdy nie wiadomo, czy to koniec, czy trudny okres", url: "/wiedza/kryzys-czy-koniec-milosci" },
  { keyword: "ROZMOWY", name: "7 dni lepszych rozmów", about: "Wyzwanie: jedno małe ćwiczenie dziennie przez 7 dni (słuchanie, potrzeby, docenianie)", url: "/wiedza/7-dni-lepszych-rozmow" },
  { keyword: "PLAN", name: "Trudna rozmowa bez kłótni", about: "Plan trudnej rozmowy krok po kroku: dobry moment, przygotowanie, przerwa, zakończenie", url: "/wiedza/trudna-rozmowa" },
  { keyword: "WPŁYW", name: "Gdy tylko jedna osoba chce ratować związek", about: "Na co masz wpływ, czego nie brać na siebie, granice – arkusz odpowiedzialności", url: "/wiedza/partner-nie-chce-ratowac-zwiazku" },
  { keyword: "PĘTLA", name: "Pętla konfliktu", about: "Cykl kłótni w 7 krokach (wyzwalacz → … → punkt przerwania) i arkusz do wypełnienia", url: "/wiedza/petla-konfliktu" },
  { keyword: "KROKI", name: "Pierwsze kroki po zdradzie", about: "Emocje pierwszych dni, checklista wsparcia, granice, bez presji natychmiastowej decyzji", url: "/wiedza/po-zdradzie" },
  { keyword: "ROZSTANIE", name: "Świadome rozstanie – co teraz?", about: "Checklista po decyzji o rozstaniu: sprawy emocjonalne, dzieci, organizacja", url: "/wiedza/swiadome-rozstanie" },
  { keyword: "MAPA", name: "Przykładowa Mapa Relacji", about: "Przykładowy raport Mapy Relacji (dane fikcyjne) – pokazuje, jak wygląda płatna Mapa Relacji (kwestionariusz + konsultacja z psychologiem + podsumowanie)", url: "/wiedza/przykladowa-mapa-relacji" },
];

export const LEAD_MAGNET_PRESETS: Array<{ key: string; name: string; items: LeadMagnet[] }> = [{ key: "duo", name: "DUO Terapia (10 materiałów)", items: DUO_LEAD_MAGNETS }];

const clean = (s: string) => s.replace(/\s+/g, " ").trim();

export function formatLeadMagnets(items: LeadMagnet[] | null | undefined): string {
  return (items ?? []).map((m) => [m.keyword, m.name, m.about, m.url ?? ""].map(clean).join(" | ").replace(/ \| $/, "")).join("\n");
}

/** "SŁOWO | Nazwa | o czym | link" per line; a line without "|" is a name only. */
export function parseLeadMagnets(text: string): LeadMagnet[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.split("|").map(clean))
    .filter((c) => c.some(Boolean))
    .map((c) => (c.length === 1 ? { keyword: "", name: c[0], about: "" } : { keyword: c[0].toUpperCase().replace(/^#/, ""), name: c[1] ?? "", about: c[2] ?? "", url: c[3] || null }))
    .filter((m) => m.name || m.keyword)
    .slice(0, 30);
}

/** Uppercase words the CTA asks to write in a DM ("Napisz PLAN", "wpisz „KRYZYS”") that are not on the list. */
export function foreignKeywords(cta: string, items: LeadMagnet[]): string[] {
  const known = new Set(items.map((m) => m.keyword.toUpperCase()).filter(Boolean));
  const out: string[] = [];
  for (const t of cta.matchAll(/\b(?:napisz|wpisz|wyślij|wyslij|odpisz|komentarzu?)\b/gi)) {
    const after = cta.slice((t.index ?? 0) + t[0].length, (t.index ?? 0) + t[0].length + 40);
    for (const w of after.match(/(?<![\p{L}\d])[A-ZĄĆĘŁŃÓŚŹŻ][A-ZĄĆĘŁŃÓŚŹŻ0-9]{2,}(?![\p{L}\d])/gu) ?? []) if (!known.has(w) && !out.includes(w)) out.push(w);
  }
  return out;
}
