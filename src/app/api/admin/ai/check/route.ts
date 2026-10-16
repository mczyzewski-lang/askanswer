import { requireAdmin } from "@/lib/server/auth";
import { json, route } from "@/lib/server/http";
import { env, higgsfieldConfigured } from "@/lib/server/env";
import { checkConnection } from "@/lib/server/higgsfield";

/** "Sprawdź połączenie" in the Studio AI tab — tells exactly what is wrong with the Higgsfield setup. */
export const POST = route(async () => {
  await requireAdmin();
  const creds = env.higgsfieldCredentials;
  if (!higgsfieldConfigured()) {
    return json({ ok: false, message: "Brak klucza Higgsfield. W Railway → Variables dodaj HIGGSFIELD_CREDENTIALS = KEY_ID:KEY_SECRET (oba z panelu API Higgsfield, połączone dwukropkiem) i poczekaj na ponowne wdrożenie." });
  }
  const r = await checkConnection();
  const hint = !r.ok && !creds.includes(":") ? " Wpisany klucz nie zawiera części KEY_SECRET — Higgsfield zwykle wymaga obu: KEY_ID:KEY_SECRET." : "";
  return json({ ok: r.ok, message: r.message + hint, claude: env.anthropicConfigured });
});
