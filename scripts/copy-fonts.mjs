// Copies openly licensed (SIL OFL) TTF font files from @expo-google-fonts packages
// into public/fonts. The same files are used by the browser preview (@font-face)
// and by the server-side renderer (@napi-rs/canvas), which keeps preview/export parity.
import fs from "node:fs";
import path from "node:path";

const families = {
  Inter: "inter",
  Manrope: "manrope",
  Montserrat: "montserrat",
  Poppins: "poppins",
  "DM Sans": "dm-sans",
};
const weights = { 400: "400Regular", 500: "500Medium", 600: "600SemiBold", 700: "700Bold", 800: "800ExtraBold" };
const out = path.resolve("public/fonts");
fs.mkdirSync(out, { recursive: true });
for (const [family, pkg] of Object.entries(families)) {
  const base = path.resolve("node_modules/@expo-google-fonts", pkg);
  for (const [w, dir] of Object.entries(weights)) {
    const d = path.join(base, dir);
    if (!fs.existsSync(d)) continue;
    const ttf = fs.readdirSync(d).find((f) => f.endsWith(".ttf"));
    if (!ttf) continue;
    fs.copyFileSync(path.join(d, ttf), path.join(out, `${family.replace(/\s/g, "")}-${w}.ttf`));
  }
}
console.log("fonts copied to", out);
