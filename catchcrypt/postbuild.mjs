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

// Tutorial intro + no Discord in UI text (all locales)
const INTRO = "Welcome to CatchCrypt! This is a battle focused Pok\u00e9mon fangame.";
const noDiscord = (v) => v.includes("$")
  ? v.split("$").filter((pg) => !/discord/i.test(pg)).join("$")
  : v.split("\n").filter((ln) => !/discord/i.test(ln)).join("\n");
let edits = 0;
const origIntro = new Map();
for (const lng of readdirSync(join(dist, "locales"))) { try { origIntro.set(lng, JSON.parse(readFileSync(join(dist, "locales", lng, "tutorial.json"), "utf8")).intro); } catch {} }
for (const lng of readdirSync(join(dist, "locales"))) {
  const dir = join(dist, "locales", lng); if (!statSync(dir).isDirectory()) continue;
  for (const f of readdirSync(dir).filter((x) => x.endsWith(".json"))) {
    const p = join(dir, f); let j; try { j = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
    let changed = false;
    const visit = (o) => { for (const k of Object.keys(o)) {
      if (typeof o[k] === "object" && o[k]) visit(o[k]);
      else if (typeof o[k] === "string" && /discord/i.test(o[k]) && !/^(linkDiscord|unlinkDiscord)$/.test(k)) { o[k] = noDiscord(o[k]); changed = true; edits++; }
    } };
    visit(j);
    if (f === "tutorial.json" && typeof j.intro === "string" && origIntro.has(lng)) {
      // drop the work in progress page(s): the Discord page and, if separate, the page right before it
      const o = origIntro.get(lng).split("$"); const di = o.findIndex((pg) => /discord/i.test(pg));
      const keep = o.filter((pg, i) => di < 0 || !(i === di || (i === di - 1 && !/pok/i.test(pg) && i > 0)));
      j.intro = keep.join("$"); }
    if (f === "tutorial.json" && typeof j.intro === "string") { const pages = j.intro.split("$"); pages[0] = INTRO; j.intro = pages.join("$"); changed = true; }
    if (f === "splash-texts.json") { for (const k of Object.keys(j)) if (/discord/i.test(k)) { delete j[k]; changed = true; } }
    if (changed) writeFileSync(p, JSON.stringify(j, null, 2));
  }
}
console.log(`catchcrypt postbuild: intro set, ${edits} Discord mentions removed`);
console.log(`catchcrypt postbuild: overlay copied, ${hits} brand strings replaced in ${files} locale files`);
