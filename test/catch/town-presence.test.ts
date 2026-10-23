import { decodePresenceMessage, encodeHello, encodeMove, Op, presenceUrl } from "#app/catch/town-presence";
import { describe, expect, it } from "vitest";

describe("CatchCrypt town presence messages", () => {
  it("stays solo when the presence URL is unset", () => {
    expect(presenceUrl()).toBe("");
  });

  it("encodes hello and move the way the presence server reads them", () => {
    expect(encodeHello({ name: "Ada", x: 12, y: 34, facing: "front", sprite: "misa", area: "town" })).toEqual([
      Op.HELLO,
      "Ada",
      12,
      34,
      "front",
      "misa",
      "town",
    ]);
    expect(encodeMove({ x: 40, y: 34, facing: "left", area: "grove" })).toEqual([Op.MOVE, 40, 34, "left", "grove"]);
  });

  it("decodes the join, walk, and leave packets", () => {
    expect(decodePresenceMessage("go")).toEqual({ type: "go" });
    expect(decodePresenceMessage([Op.WELCOME, "p1", "Ada", 1, 2, "front", "misa", "town"])).toEqual({
      type: "welcome",
      peer: { id: "p1", name: "Ada", x: 1, y: 2, facing: "front", sprite: "misa", area: "town" },
    });
    expect(decodePresenceMessage([Op.LIST, ["p2", "Bea", 8, 9, "back", "misa", "town"]])).toEqual({
      type: "list",
      peers: [{ id: "p2", name: "Bea", x: 8, y: 9, facing: "back", sprite: "misa", area: "town" }],
    });
    expect(decodePresenceMessage([Op.LIST])).toEqual({ type: "list", peers: [] });
    expect(decodePresenceMessage([Op.SPAWN, "p2", "Bea", 8, 9, "back", "misa", "town"])).toEqual({
      type: "spawn",
      peer: { id: "p2", name: "Bea", x: 8, y: 9, facing: "back", sprite: "misa", area: "town" },
    });
    expect(decodePresenceMessage([Op.MOVE, "p2", 11, 9, "right", "town"])).toEqual({
      type: "move",
      move: { id: "p2", x: 11, y: 9, facing: "right", area: "town" },
    });
    expect(decodePresenceMessage([Op.LEAVE, "p2"])).toEqual({ type: "leave", id: "p2" });
    expect(decodePresenceMessage([Op.REFUSE, "full"])).toEqual({ type: "refuse", reason: "full" });
    expect(decodePresenceMessage("nope")).toBeNull();
    expect(decodePresenceMessage([Op.MOVE, "p2", 1, 2, "spin", "town"])).toBeNull();
    expect(decodePresenceMessage([Op.WELCOME, "p1"])).toBeNull();
  });
});
