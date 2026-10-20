// CatchCrypt branding pass, run after `vite build`.
// Copies catchcrypt/public over dist and rebrands translation files (the locales are an upstream submodule).
// The AGPL license and credits keep their PokeRogue / pagefaultgames attribution.
import { cpSync, readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";

const dist = "dist";
cpSync("catchcrypt/public", dist, { recursive: true });

const MORSE = "-.-. .- - -.-. .... -.-. .-. -.-- .--. -";
const rules = [
  [/\.--\. --- -\.- \. \.-\. --- --\. \.\.- \./g, MORSE],
  [/pok[eé]rogue\.net/gi, "CatchCrypt"],
  [/POK[EÉ]ROGUE/g, "CATCHCRYPT"],
  [/Pok[eé] ?Rogue|Pok[eé]rogue|pok[eé]rogue/g, "CatchCrypt"],
  [/ポケローグ/g, "CatchCrypt"],
  [/포켓로그/g, "CatchCrypt"],
];
let files = 0, hits = 0;
function walk(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) walk(p);
    else if (p.endsWith(".json")) {
      let s = readFileSync(p, "utf8"), o = s;
      for (const [re, to] of rules) s = s.replace(re, () => (hits++, to));
      if (s !== o) { writeFileSync(p, s); files++; }
    }
  }
}
walk(join(dist, "locales"));
console.log(`catchcrypt postbuild: overlay copied, ${hits} brand strings replaced in ${files} locale files`);
