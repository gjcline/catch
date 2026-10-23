// CatchCrypt strings on top of the upstream locale submodule.
// The AGPL license and credits are not in locales/, so PokeRogue attribution stays there.
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const MORSE = "-.-. .- - -.-. .... -.-. .-. -.-- .--. -";
const RULES = [
  [/\.--\. --- -\.- \. \.-\. --- --\. \.\.- \./g, MORSE],
  [/pok[eé]rogue\.net/gi, "CatchCrypt"],
  [/POK[EÉ]ROGUE/g, "CATCHCRYPT"],
  [/Pok[eé] ?Rogue|Pok[eé]rogue|pok[eé]rogue/g, "CatchCrypt"],
  [/ポケローグ/g, "CatchCrypt"],
  [/포켓로그/g, "CatchCrypt"],
];
const INTRO = "Welcome to CatchCrypt! This is a battle focused Pokémon fangame.";

function brandString(value) {
  let next = value;
  let hits = 0;
  for (const [re, to] of RULES) {
    // These regexes are reused. A global regexp keeps lastIndex, which skips later strings.
    re.lastIndex = 0;
    next = next.replace(re, () => {
      hits++;
      return to;
    });
  }
  return { next, hits };
}

function noDiscord(value) {
  if (value.includes("$")) {
    return value
      .split("$")
      .filter(page => !/discord/i.test(page))
      .join("$");
  }
  return value
    .split("\n")
    .filter(line => !/discord/i.test(line))
    .join("\n");
}

/**
 * Rewrite locale JSON already copied into `distDir/locales`.
 * Keys stay put so i18next lookups still resolve. Only player-facing strings change.
 */
export function applyCatchcryptBrand(distDir) {
  const locales = join(distDir, "locales");
  const result = { files: 0, hits: 0, edits: 0 };
  let names;
  try {
    names = readdirSync(locales);
  } catch {
    return result;
  }

  const origIntro = new Map();
  for (const lng of names) {
    try {
      origIntro.set(lng, JSON.parse(readFileSync(join(locales, lng, "tutorial.json"), "utf8")).intro);
    } catch {
      // locale without a tutorial file
    }
  }

  const filesIn = dir => {
    const found = [];
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        found.push(...filesIn(path));
      } else if (name.endsWith(".json")) {
        found.push(path);
      }
    }
    return found;
  };

  for (const lng of names) {
    const dir = join(locales, lng);
    if (!statSync(dir).isDirectory()) {
      continue;
    }
    for (const path of filesIn(dir)) {
      const file = path.split("/").pop();
      let json;
      try {
        json = JSON.parse(readFileSync(path, "utf8"));
      } catch {
        continue;
      }
      let changed = false;
      const visit = node => {
        if (!node || typeof node !== "object") {
          return;
        }
        for (const key of Object.keys(node)) {
          const value = node[key];
          if (value && typeof value === "object") {
            visit(value);
            continue;
          }
          if (typeof value !== "string") {
            continue;
          }
          const branded = brandString(value);
          let next = branded.next;
          result.hits += branded.hits;
          if (branded.hits > 0) {
            changed = true;
          }
          if (/discord/i.test(next) && !/^(linkDiscord|unlinkDiscord)$/.test(key)) {
            next = noDiscord(next);
            changed = true;
            result.edits++;
          }
          if (next !== value) {
            node[key] = next;
          }
        }
      };
      visit(json);
      if (file === "tutorial.json" && origIntro.has(lng)) {
        const pages = origIntro.get(lng).split("$");
        const discordAt = pages.findIndex(page => /discord/i.test(page));
        const keep = pages.filter((page, index) => {
          if (discordAt < 0) {
            return true;
          }
          if (index === discordAt) {
            return false;
          }
          return !(index === discordAt - 1 && !/pok/i.test(page) && index > 0);
        });
        const branded = brandString(keep.map(page => noDiscord(page)).join("$"));
        result.hits += branded.hits;
        const out = branded.next.split("$");
        out[0] = INTRO;
        json.intro = out.join("$");
        changed = true;
      } else if (file === "tutorial.json" && typeof json.intro === "string") {
        const pages = json.intro.split("$");
        pages[0] = INTRO;
        json.intro = pages.join("$");
        changed = true;
      }
      if (file === "splash-texts.json") {
        for (const key of Object.keys(json)) {
          if (/discord/i.test(key) || /discord/i.test(String(json[key]))) {
            delete json[key];
            changed = true;
          }
        }
      }
      if (changed) {
        writeFileSync(path, JSON.stringify(json));
        result.files++;
      }
    }
  }
  return result;
}
