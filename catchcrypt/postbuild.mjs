// CatchCrypt branding pass, run after `vite build`.
// Copies catchcrypt/public over dist and rebrands translation files (the locales are an upstream submodule).
// The AGPL license and credits keep their PokeRogue / pagefaultgames attribution.
import { cpSync } from "node:fs";
import { applyCatchcryptBrand } from "./brand.mjs";

const dist = "dist";
cpSync("catchcrypt/public", dist, { recursive: true });
const { files, hits, edits } = applyCatchcryptBrand(dist);
console.log(`catchcrypt postbuild: intro set, ${edits} Discord mentions removed`);
console.log(`catchcrypt postbuild: overlay copied, ${hits} brand strings replaced in ${files} locale files`);
