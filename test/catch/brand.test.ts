import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { applyCatchcryptBrand } from "../../catchcrypt/brand.mjs";
import { stagePublicFiles } from "../../plugins/vite/vite-minify-json-plugin";

describe("CatchCrypt branding", () => {
  it("overwrites the upstream title logo with the CatchCrypt wordmark", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-logo-"));
    try {
      mkdirSync(join(dir, "images"), { recursive: true });
      writeFileSync(join(dir, "images", "logo.png"), "pokerogue-logo");
      stagePublicFiles(join("catchcrypt", "public"), dir);
      const staged = readFileSync(join(dir, "images", "logo.png"));
      const branded = readFileSync(join("catchcrypt", "public", "images", "logo.png"));
      expect(Buffer.compare(staged, branded)).toBe(0);
      expect(staged.includes(Buffer.from("pokerogue-logo"))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("replaces PokéRogue strings and drops the Discord splash without renaming keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-brand-"));
    const locale = join(dir, "locales", "en");
    mkdirSync(locale, { recursive: true });
    writeFileSync(
      join(locale, "splash-texts.json"),
      JSON.stringify({
        alsoTryPokerogueWait: "Also Try PokéRogue! Wait…",
        pokerogueMorse: ".--. --- -.- . .-. --- --. ..- .",
        joinTheDiscord: "Join the Discord!",
        spookyScarySkeledirge: "Spooky, Scary Skeledirge!",
      }),
    );
    writeFileSync(
      join(locale, "tutorial.json"),
      JSON.stringify({ intro: "Welcome to PokéRogue!$This game is a work in progress.$Join our Discord." }),
    );
    try {
      const result = applyCatchcryptBrand(dir);
      expect(result.hits).toBeGreaterThan(0);
      const splash = JSON.parse(readFileSync(join(locale, "splash-texts.json"), "utf8")) as Record<string, string>;
      expect(splash.alsoTryPokerogueWait).toBe("Also Try CatchCrypt! Wait…");
      expect(splash.pokerogueMorse).toBe("-.-. .- - -.-. .... -.-. .-. -.-- .--. -");
      expect(splash.joinTheDiscord).toBeUndefined();
      expect(Object.values(splash).join("\n")).not.toMatch(/pok[eé]rogue/i);
      const tutorial = JSON.parse(readFileSync(join(locale, "tutorial.json"), "utf8")) as { intro: string };
      expect(tutorial.intro.startsWith("Welcome to CatchCrypt!")).toBe(true);
      expect(tutorial.intro.toLowerCase()).not.toContain("discord");
      expect(tutorial.intro).not.toMatch(/pok[eé]rogue/i);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
