/**
 * Nowy Etap — Explainery: the registry. A reel = a beat table (timing, narration, on-screen words,
 * the visual metaphor) + a draw function built from the shared kit. Reels 4 and 5 have their beat
 * tables ready; their scenes are still to be drawn (status "planned").
 */
import type { Reel } from "./kit";
import { reel01 } from "./reel01";
import { reel02 } from "./reel02";
import { reel03 } from "./reel03";

const reel04: Reel = {
  id: "czy-jestescie-uzgodnieni",
  n: 4,
  title: "Czy naprawdę jesteście uzgodnieni?",
  idea: "Zgoda na rozwód to jeszcze nie uzgodniony rozwód.",
  duration: 29,
  status: "planned",
  beats: [
    { id: "dogadani", start: 0, end: 4, vo: "Mówisz: jesteśmy dogadani. Zrób prosty test.", screen: "„JESTEŚMY DOGADANI”", visual: "Dwie osoby (dwa znaki, nie postacie) po obu stronach jednego dokumentu; nad nimi jedno zdanie w cudzysłowie." },
    { id: "test", start: 4, end: 10.5, vo: "Gdyby Twój partner przeczytał dziś cały pozew - żądania, dzieci, finanse, uzasadnienie -", screen: "DZIECI · FINANSE · MIESZKANIE · UZASADNIENIE", visual: "Kamera wjeżdża w dokument; z jego wnętrza wysuwają się cztery karty (LifeArea), każda dostaje znak zapytania." },
    { id: "pytanie", start: 10.5, end: 15, vo: "czy powiedziałby: „Tak. Dokładnie tak się umówiliśmy”?", screen: "„TAK. DOKŁADNIE TAK SIĘ UMÓWILIŚMY”?", visual: "Jedno wielkie pytanie zajmuje cały kadr; karty z pytajnikami zostają w tle." },
    { id: "niewiem", start: 15, end: 24.5, vo: "Jeśli odpowiedź brzmi „nie wiem”, to prawdopodobnie nie macie jeszcze ustalonego rozwodu. Macie tylko wspólną decyzję, że chcecie się rozwieść.", screen: "ZGODA NA ROZWÓD", visual: "Karty z pytajnikami oddalają się od siebie; zostaje jedna wspólna rzecz - decyzja." },
    { id: "marka", start: 24.5, end: 29, vo: "A to nie jest to samo.", screen: "ZGODA NA ROZWÓD ≠ UZGODNIONY ROZWÓD", visual: "Dwa wyrażenia obok siebie i znak nierówności; zamknięcie marką." },
  ],
};

const reel05: Reel = {
  id: "nie-kazda-roznica",
  n: 5,
  title: "Nie każda różnica musi trafić do sądu",
  idea: "Sąd może rozstrzygnąć spór, ale nie każdą różnicę trzeba najpierw zamienić w spór sądowy.",
  duration: 28,
  status: "planned",
  beats: [
    { id: "spor", start: 0, end: 7, vo: "Sąd może rozstrzygnąć spór. Ale to nie znaczy, że każdą różnicę trzeba najpierw zamienić w spór sądowy.", screen: "NIE KAŻDA RÓŻNICA = SPÓR", visual: "Wiele małych różnic (dokumenty w czerwieni) rusza w stronę jednego dużego sądu." },
    { id: "stop", start: 7, end: 16.4, vo: "Jeżeli możecie wcześniej uzgodnić dzieci, finanse albo sposób rozstania, sąd nie musi zaczynać od poznawania dwóch kompletnie różnych wersji.", screen: "UZGODNIONE", visual: "Ruch zatrzymuje się przed sądem; część różnic łączy się parami (Lock) i zmienia kolor na zielony." },
    { id: "reszta", start: 16.4, end: 23.4, vo: "Najpierw sprawdź, co możecie ustalić. Dopiero potem zdecyduj, co naprawdę musi rozstrzygnąć sąd.", screen: "CO USTALICIE → CO ZOSTAJE DLA SĄDU", visual: "Tylko nieuzgodnione elementy jadą dalej do sądu - jest ich wyraźnie mniej." },
    { id: "marka", start: 23.4, end: 28, vo: "Nie wszystko musi stać się sporem.", screen: "NIE WSZYSTKO MUSI STAĆ SIĘ SPOREM.", visual: "Zamknięcie marką." },
  ],
};

export const REELS: Reel[] = [reel01, reel02, reel03, reel04, reel05];
export const reelById = (id: string) => REELS.find((r) => r.id === id) ?? null;
export type { Reel, Beat } from "./kit";
export { W as REEL_W, H as REEL_H, FPS as REEL_FPS } from "./kit";
