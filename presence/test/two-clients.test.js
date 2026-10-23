/*
 * Two-client presence golden path. AGPL-3.0.
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { io } from "socket.io-client";
import { attemptStep, inBounds, Op, sanitizeName } from "../src/protocol.js";
import { createPresenceServer } from "../src/server.js";

async function waitFor(msgs, pred, timeout = 3000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const index = msgs.findIndex(pred);
    if (index >= 0) {
      return msgs.splice(index, 1)[0];
    }
    await delay(10);
  }
  throw new Error(`timed out; pending=${JSON.stringify(msgs)}`);
}

function connect(url) {
  const socket = io(url, {
    autoConnect: false,
    forceNew: true,
    reconnection: false,
    transports: ["websocket"],
  });
  const msgs = [];
  socket.on("message", msg => {
    msgs.push(msg);
  });
  socket.connect();
  return { socket, msgs };
}

function hello(socket, name, x, y, facing, area) {
  socket.emit("message", [Op.HELLO, name, x, y, facing, "misa", area]);
}

function move(socket, x, y, facing, area) {
  socket.emit("message", [Op.MOVE, x, y, facing, area]);
}

describe("presence protocol helpers", () => {
  it("clamps names and map bounds to the town Grant already has", () => {
    assert.equal(sanitizeName("  Ada!!! "), "Ada");
    assert.equal(sanitizeName(""), "Guest");
    assert.equal(sanitizeName(12), "Guest");
    assert.equal(inBounds("town", 0, 0), true);
    assert.equal(inBounds("town", 76 * 32, 72 * 32), true);
    assert.equal(inBounds("town", 76 * 32 + 1, 10), false);
    assert.equal(inBounds("grove", 10, 10), true);
    assert.equal(inBounds("nope", 10, 10), false);
  });

  it("rejects a step that is faster than the walk budget", () => {
    const state = { x: 200, y: 200, budgetPx: 96, budgetAt: 1000 };
    assert.equal(attemptStep(state, 700, 200, 1010), false);
    assert.equal(state.x, 200);
    assert.equal(attemptStep(state, 220, 200, 1020), true);
    assert.equal(state.x, 220);
  });
});

describe("two clients on the town", () => {
  /** @type {ReturnType<typeof createPresenceServer>} */
  let server;
  let url;

  before(async () => {
    server = createPresenceServer({ maxPlayers: 8 });
    const port = await server.listen(0, "127.0.0.1");
    url = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await server.close();
  });

  it("joins, sees the other walk, and clears them on disconnect", async () => {
    const ada = connect(url);
    const bea = connect(url);
    try {
      assert.equal(await waitFor(ada.msgs, msg => msg === "go"), "go");
      assert.equal(await waitFor(bea.msgs, msg => msg === "go"), "go");

      hello(ada.socket, "Ada", 200, 200, "front", "town");
      const adaWelcome = await waitFor(ada.msgs, msg => Array.isArray(msg) && msg[0] === Op.WELCOME);
      const adaList = await waitFor(ada.msgs, msg => Array.isArray(msg) && msg[0] === Op.LIST);
      assert.equal(adaWelcome[2], "Ada");
      assert.equal(adaWelcome[7], "town");
      assert.equal(adaList.length, 1);

      hello(bea.socket, "Bea", 260, 200, "left", "town");
      const beaWelcome = await waitFor(bea.msgs, msg => Array.isArray(msg) && msg[0] === Op.WELCOME);
      const beaList = await waitFor(bea.msgs, msg => Array.isArray(msg) && msg[0] === Op.LIST);
      assert.equal(beaWelcome[2], "Bea");
      assert.equal(beaList[1][0], adaWelcome[1]);
      assert.equal(beaList[1][1], "Ada");

      const adaSeesBea = await waitFor(
        ada.msgs,
        msg => Array.isArray(msg) && msg[0] === Op.SPAWN && msg[1] === beaWelcome[1],
      );
      const beaSeesAda = await waitFor(
        bea.msgs,
        msg => Array.isArray(msg) && msg[0] === Op.SPAWN && msg[1] === adaWelcome[1],
      );
      assert.equal(adaSeesBea[2], "Bea");
      assert.deepEqual(adaSeesBea.slice(3, 8), [260, 200, "left", "misa", "town"]);
      assert.equal(beaSeesAda[2], "Ada");

      move(bea.socket, 280, 210, "right", "town");
      const adaSeesMove = await waitFor(
        ada.msgs,
        msg => Array.isArray(msg) && msg[0] === Op.MOVE && msg[1] === beaWelcome[1],
      );
      assert.deepEqual(adaSeesMove, [Op.MOVE, beaWelcome[1], 280, 210, "right", "town"]);

      move(ada.socket, 230, 200, "front", "town");
      const beaSeesMove = await waitFor(
        bea.msgs,
        msg => Array.isArray(msg) && msg[0] === Op.MOVE && msg[1] === adaWelcome[1],
      );
      assert.deepEqual(beaSeesMove, [Op.MOVE, adaWelcome[1], 230, 200, "front", "town"]);

      assert.equal(server.removePlayer(adaWelcome[1]), true);
      const left = await waitFor(bea.msgs, msg => Array.isArray(msg) && msg[0] === Op.LEAVE);
      assert.deepEqual(left, [Op.LEAVE, adaWelcome[1]]);
      assert.equal(server.playerCount(), 1);
      assert.equal(server.removePlayer(adaWelcome[1]), false);
      await delay(80);
      assert.equal(
        bea.msgs.some(msg => Array.isArray(msg) && msg[0] === Op.LEAVE),
        false,
      );
    } finally {
      ada.socket.disconnect();
      bea.socket.disconnect();
      await delay(30);
    }
  });

  it("hides other areas, drops illegal steps, and follows a re-hello into the new area", async () => {
    const town = connect(url);
    const watch = connect(url);
    const grove = connect(url);
    try {
      await waitFor(town.msgs, msg => msg === "go");
      await waitFor(watch.msgs, msg => msg === "go");
      await waitFor(grove.msgs, msg => msg === "go");

      hello(town.socket, "Townie", 200, 200, "front", "town");
      const townWelcome = await waitFor(town.msgs, msg => Array.isArray(msg) && msg[0] === Op.WELCOME);
      hello(watch.socket, "Watcher", 320, 200, "front", "town");
      await waitFor(watch.msgs, msg => Array.isArray(msg) && msg[0] === Op.WELCOME);
      await waitFor(town.msgs, msg => Array.isArray(msg) && msg[0] === Op.SPAWN && msg[2] === "Watcher");

      hello(grove.socket, "Grover", 180, 180, "back", "grove");
      await waitFor(grove.msgs, msg => Array.isArray(msg) && msg[0] === Op.WELCOME);
      await delay(40);
      assert.equal(
        watch.msgs.some(msg => Array.isArray(msg) && msg[0] === Op.SPAWN && msg[2] === "Grover"),
        false,
      );

      move(town.socket, 900, 200, "front", "town");
      move(town.socket, 9000, 10, "front", "town");
      await delay(40);
      assert.equal(
        watch.msgs.some(msg => Array.isArray(msg) && msg[0] === Op.MOVE),
        false,
      );

      move(town.socket, 230, 200, "left", "town");
      const watched = await waitFor(watch.msgs, msg => Array.isArray(msg) && msg[0] === Op.MOVE);
      assert.deepEqual(watched, [Op.MOVE, townWelcome[1], 230, 200, "left", "town"]);
      assert.equal(
        grove.msgs.some(msg => Array.isArray(msg) && msg[0] === Op.MOVE),
        false,
      );

      hello(town.socket, "Townie", 200, 200, "front", "grove");
      const left = await waitFor(watch.msgs, msg => Array.isArray(msg) && msg[0] === Op.LEAVE);
      assert.deepEqual(left, [Op.LEAVE, townWelcome[1]]);
      const arrived = await waitFor(
        grove.msgs,
        msg => Array.isArray(msg) && msg[0] === Op.SPAWN && msg[1] === townWelcome[1],
      );
      assert.equal(arrived[7], "grove");

      move(town.socket, 240, 200, "right", "grove");
      const walked = await waitFor(
        grove.msgs,
        msg => Array.isArray(msg) && msg[0] === Op.MOVE && msg[1] === townWelcome[1],
      );
      assert.deepEqual(walked, [Op.MOVE, townWelcome[1], 240, 200, "right", "grove"]);
    } finally {
      town.socket.disconnect();
      watch.socket.disconnect();
      grove.socket.disconnect();
      await delay(40);
    }
  });

  it("refuses a hello outside the map and still accepts a later good one", async () => {
    const start = Date.now();
    while (server.playerCount() > 0 && Date.now() - start < 1000) {
      await delay(10);
    }
    assert.equal(server.playerCount(), 0);
    const client = connect(url);
    try {
      await waitFor(client.msgs, msg => msg === "go");
      hello(client.socket, "Nope", -10, 10, "front", "town");
      const refused = await waitFor(client.msgs, msg => Array.isArray(msg) && msg[0] === Op.REFUSE);
      assert.deepEqual(refused, [Op.REFUSE, "bad-hello"]);
      assert.equal(server.playerCount(), 0);
      hello(client.socket, "", 32, 32, "front", "beach");
      const welcome = await waitFor(client.msgs, msg => Array.isArray(msg) && msg[0] === Op.WELCOME);
      assert.equal(welcome[2], "Guest");
      assert.equal(welcome[7], "beach");
    } finally {
      client.socket.disconnect();
      await delay(30);
    }
  });
});

describe("a full town", () => {
  it("refuses the next connection when PRESENCE_MAX is reached", async () => {
    const server = createPresenceServer({ maxPlayers: 1 });
    const port = await server.listen(0, "127.0.0.1");
    const url = `http://127.0.0.1:${port}`;
    const first = connect(url);
    try {
      await waitFor(first.msgs, msg => msg === "go");
      hello(first.socket, "Only", 64, 64, "front", "town");
      await waitFor(first.msgs, msg => Array.isArray(msg) && msg[0] === Op.WELCOME);
      const second = connect(url);
      try {
        const refused = await waitFor(second.msgs, msg => Array.isArray(msg) && msg[0] === Op.REFUSE);
        assert.deepEqual(refused, [Op.REFUSE, "full"]);
        await delay(80);
        assert.equal(server.socketCount(), 1);
        assert.equal(server.playerCount(), 1);
      } finally {
        second.socket.disconnect();
      }
    } finally {
      first.socket.disconnect();
      await delay(30);
      await server.close();
    }
  });
});

describe("health", () => {
  it("answers /health", async () => {
    const server = createPresenceServer({ maxPlayers: 4 });
    const port = await server.listen(0, "127.0.0.1");
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`);
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.deepEqual(body, { ok: true, players: 0, max: 4 });
    } finally {
      await server.close();
    }
  });
});
