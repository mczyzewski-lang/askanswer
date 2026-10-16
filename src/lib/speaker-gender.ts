/**
 * Who is asking? Polish questions often reveal the asker's gender:
 *   - the spouse they talk about: "Jak powiedzieć MĘŻOWI o rozwodzie?" → a woman asks;
 *     "Czy moja żona dostanie alimenty?" → a man asks;
 *   - first-person past / conditional verbs: "zrobiłam", "mogłabym" (woman) vs "zrobiłem", "mógłbym" (man);
 *   - "jestem sama / pewna / w ciąży" (woman) vs "jestem sam / pewien" (man).
 * Used to give the narrator a matching voice ("Pani" / "Pan" voices in a collection).
 * Returns null when the text gives no hint or contradicts itself.
 */
export type Gender = "female" | "male";

const W = "(?<![\\p{L}])"; // word start (Unicode-aware)
const E = "(?![\\p{L}])"; // word end

const FEMALE: RegExp[] = [
  // husband / ex-husband / fiancé as "my partner"
  new RegExp(`${W}(mąż|męża|mężowi|mężem|mężu|mężusia|eksmęża|eks-męża|byłego męża|byłym mężem|byłemu mężowi|narzeczonego|narzeczonemu|narzeczonym)${E}`, "iu"),
  // 1st person feminine past / conditional: zrobiłam, byłam, mogłabym, poszłabym
  new RegExp(`${W}\\p{L}{2,}(łam|łabym|łaby[mś]?)${E}`, "iu"),
  // jestem / czuję się / zostałam + feminine adjective
  new RegExp(`${W}(jestem|czuję się|będę)\\s+(sama|pewna|gotowa|zmuszona|zobowiązana|samotna|zmęczona|rozwiedziona|w ciąży|matką|mamą|żoną|wdową)${E}`, "iu"),
  new RegExp(`${W}(jako (matka|mama|żona|kobieta|wdowa))${E}`, "iu"),
];
const MALE: RegExp[] = [
  new RegExp(`${W}(żona|żony|żonie|żonę|żoną|żono|eksżony|byłej żony|byłą żoną|byłej żonie|narzeczona|narzeczonej|narzeczoną)${E}`, "iu"),
  new RegExp(`${W}\\p{L}{2,}(łem|łbym)${E}`, "iu"),
  new RegExp(`${W}(mógłbym|poszedłbym|zrobiłbym)${E}`, "iu"),
  new RegExp(`${W}(jestem|czuję się|będę)\\s+(sam|pewien|pewny|gotowy|zmuszony|zobowiązany|samotny|zmęczony|rozwiedziony|ojcem|tatą|mężem|wdowcem)${E}`, "iu"),
  new RegExp(`${W}(jako (ojciec|tata|mąż|mężczyzna|wdowiec))${E}`, "iu"),
];

export function detectSpeakerGender(text: string): Gender | null {
  const f = FEMALE.filter((r) => r.test(text)).length;
  const m = MALE.filter((r) => r.test(text)).length;
  if (f > m) return "female";
  if (m > f) return "male";
  return null;
}

/** Voice gender from its name in a collection: "Pani …" = female, "Pan …" = male. */
export function genderFromVoiceName(name: string | null | undefined): Gender | null {
  if (!name) return null;
  if (/(?<![\p{L}])pani(?![\p{L}])/iu.test(name)) return "female";
  if (/(?<![\p{L}])pan(?![\p{L}])/iu.test(name)) return "male";
  return null;
}

/** ElevenLabs voice labels ("gender": "female" | "male") as a fallback. */
export function genderFromVoiceLabels(labels: Record<string, string> | null | undefined): Gender | null {
  const g = labels?.gender?.toLowerCase();
  return g === "female" ? "female" : g === "male" ? "male" : null;
}
