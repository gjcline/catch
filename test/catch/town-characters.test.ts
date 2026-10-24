import {
  characterPickerKey,
  idleFrame,
  loadTownSprite,
  moveCharacterPicker,
  openCharacterPicker,
  playerAtlasKey,
  resolveTownSprite,
  saveTownSprite,
  selectedTownCharacter,
  spriteStorageKey,
  townCharacters,
  townFacings,
  walkAnimKey,
  walkFramePrefix,
} from "#app/catch/town-characters";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { stagePublicFiles } from "../../plugins/vite/vite-minify-json-plugin";

function memoryStore() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

function pngSize(file: string): { w: number; h: number } {
  const buf = readFileSync(file);
  expect(buf.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe("CatchCrypt town characters", () => {
  it("offers a handful of recolored walk sheets and falls back to misa", () => {
    expect(townCharacters.length).toBeGreaterThanOrEqual(4);
    expect(townCharacters.length).toBeLessThanOrEqual(6);
    expect(townCharacters.map(character => character.id)).toEqual([
      "misa",
      "misa-rose",
      "misa-sea",
      "misa-moss",
      "misa-gold",
      "misa-dusk",
    ]);
    expect(resolveTownSprite("misa-moss")).toBe("misa-moss");
    expect(resolveTownSprite("nope")).toBe("misa");
    expect(resolveTownSprite(4)).toBe("misa");
    expect(playerAtlasKey("misa")).toBe("cc_player");
    expect(playerAtlasKey("misa-rose")).toBe("cc_player_misa-rose");
    expect(playerAtlasKey("nope")).toBe("cc_player");

    const atlas = JSON.parse(readFileSync("catchcrypt/public/town/atlas.json", "utf8")) as {
      frames: Record<string, unknown>;
    };
    const base = pngSize("catchcrypt/public/town/atlas.png");
    for (const character of townCharacters) {
      const file = join("catchcrypt", "public", "town", character.file);
      expect(existsSync(file), character.file).toBe(true);
      expect(pngSize(file), character.file).toEqual(base);
    }
    for (const facing of townFacings()) {
      expect(atlas.frames[idleFrame(facing)]).toBeTruthy();
      for (let frame = 0; frame < 4; frame++) {
        const name = `${walkFramePrefix(facing)}${String(frame).padStart(3, "0")}`;
        expect(atlas.frames[name], name).toBeTruthy();
      }
      expect(walkAnimKey("misa-sea", facing)).toBe(`cc-misa-sea-${facing}`);
    }
  });

  it("keeps the server allowlist in step with the client", () => {
    const protocol = readFileSync("presence/src/protocol.js", "utf8");
    const listed = protocol.match(/export const SPRITE_IDS = \[([\s\S]*?)\]/);
    expect(listed).toBeTruthy();
    const ids = [...(listed?.[1] ?? "").matchAll(/"([^"]+)"/g)].map(match => match[1]);
    expect(ids).toEqual(townCharacters.map(character => character.id));
  });

  it("saves the choice per account and ignores an unknown id", () => {
    const store = memoryStore();
    expect(spriteStorageKey("Ada")).toBe("cc_town_sprite_Ada");
    expect(spriteStorageKey("Bea")).not.toBe(spriteStorageKey("Ada"));
    expect(spriteStorageKey(null)).toBe("cc_town_sprite_guest");
    expect(spriteStorageKey("  ")).toBe(spriteStorageKey(undefined));

    expect(saveTownSprite("Ada", "misa-gold", store)).toBe("misa-gold");
    expect(saveTownSprite("Bea", "misa-dusk", store)).toBe("misa-dusk");
    expect(loadTownSprite("Ada", store)).toBe("misa-gold");
    expect(loadTownSprite("Bea", store)).toBe("misa-dusk");
    expect(loadTownSprite("Cleo", store)).toBe("misa");

    expect(saveTownSprite("Ada", "not-a-sprite", store)).toBe("misa");
    expect(loadTownSprite("Ada", store)).toBe("misa");
    store.setItem(spriteStorageKey("Ada"), "misa-sea");
    expect(loadTownSprite("Ada", store)).toBe("misa-sea");
    store.setItem(spriteStorageKey("Ada"), "bogus");
    expect(loadTownSprite("Ada", store)).toBe("misa");
  });

  it("moves a picker with the keyboard and wraps around the list", () => {
    const picker = openCharacterPicker("misa-moss");
    expect(selectedTownCharacter(picker).name).toBe("Moss");
    moveCharacterPicker(picker, 1);
    expect(selectedTownCharacter(picker).id).toBe("misa-gold");
    moveCharacterPicker(picker, 1);
    expect(selectedTownCharacter(picker).id).toBe("misa-dusk");
    moveCharacterPicker(picker, 1);
    expect(selectedTownCharacter(picker).id).toBe("misa");
    moveCharacterPicker(picker, -1);
    expect(selectedTownCharacter(picker).id).toBe("misa-dusk");

    expect(characterPickerKey("b")).toBe("close");
    expect(characterPickerKey("Escape")).toBe("close");
    expect(characterPickerKey("esc")).toBe("close");
    expect(characterPickerKey("space")).toBe("confirm");
    expect(characterPickerKey("Enter")).toBe("confirm");
    expect(characterPickerKey("z")).toBe("confirm");
    expect(characterPickerKey("left")).toBe("prev");
    expect(characterPickerKey("a")).toBe("prev");
    expect(characterPickerKey("ArrowUp")).toBe("prev");
    expect(characterPickerKey("right")).toBe("next");
    expect(characterPickerKey("s")).toBe("next");
    expect(characterPickerKey("p")).toBe("ignore");
    expect(openCharacterPicker("nope").index).toBe(0);
  });

  it("copies every character sheet into the build output", () => {
    const dir = mkdtempSync(join(tmpdir(), "cc-characters-"));
    try {
      stagePublicFiles(join("catchcrypt", "public"), dir);
      for (const character of townCharacters) {
        expect(existsSync(join(dir, "town", character.file)), character.file).toBe(true);
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
