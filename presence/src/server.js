/*
 * CatchCrypt between-wave presence server. AGPL-3.0.
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * One process, one Socket.IO namespace. Each overworld area is its own room
 * inside that process. No combat, loot, or accounts.
 */
import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { Server } from "socket.io";
import { attemptStep, LIMITS, Op, parseHello, parseMove } from "./protocol.js";

function corsOrigin() {
  const raw = process.env.PRESENCE_CORS ?? "*";
  if (raw.trim() === "*") {
    return "*";
  }
  const list = raw
    .split(",")
    .map(item => item.trim())
    .filter(item => item.length > 0);
  if (list.length === 0) {
    return "*";
  }
  return list.length === 1 ? list[0] : list;
}

function describe(player) {
  return [player.id, player.name, player.x, player.y, player.facing, player.sprite, player.area];
}

/**
 * @param {{ maxPlayers?: number }} [options]
 */
export function createPresenceServer(options = {}) {
  const maxPlayers = options.maxPlayers ?? 80;
  const players = new Map();
  let held = 0;

  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: corsOrigin() },
    maxHttpBufferSize: 16000,
  });

  app.get("/health", (_req, res) => {
    res.json({ ok: true, players: players.size, max: maxPlayers });
  });

  const broadcast = (area, packet, exceptId) => {
    for (const other of players.values()) {
      if (other.area !== area || other.id === exceptId) {
        continue;
      }
      other.socket.emit("message", packet);
    }
  };

  /** Idempotent. A second call for the same id does not broadcast again. */
  const forget = player => {
    if (!player || !players.has(player.id)) {
      return false;
    }
    const area = player.area;
    const id = player.id;
    players.delete(id);
    broadcast(area, [Op.LEAVE, id], id);
    return true;
  };

  const sendRoster = (socket, self) => {
    const others = [];
    for (const other of players.values()) {
      if (other.id === self.id || other.area !== self.area) {
        continue;
      }
      others.push(other);
    }
    socket.emit("message", [Op.LIST, ...others.map(describe)]);
    for (const other of others) {
      socket.emit("message", [Op.SPAWN, ...describe(other)]);
      other.socket.emit("message", [Op.SPAWN, ...describe(self)]);
    }
  };

  /**
   * @returns {{ player: object, accepted: boolean }}
   */
  const applyHello = (socket, current, parsed, now) => {
    if (!current) {
      const created = {
        id: `p${randomBytes(4).toString("hex")}`,
        socket,
        ...parsed,
        budgetPx: LIMITS.initialBudgetPx,
        budgetAt: now,
        helloWindowAt: now,
        hellosThisSecond: 1,
      };
      players.set(created.id, created);
      return { player: created, accepted: true };
    }
    if (now - current.helloWindowAt >= 1000) {
      current.helloWindowAt = now;
      current.hellosThisSecond = 0;
    }
    if (current.hellosThisSecond >= LIMITS.maxHellosPerSec) {
      return { player: current, accepted: false };
    }
    current.hellosThisSecond += 1;
    if (current.area !== parsed.area) {
      broadcast(current.area, [Op.LEAVE, current.id], current.id);
    }
    current.name = parsed.name;
    current.x = parsed.x;
    current.y = parsed.y;
    current.facing = parsed.facing;
    current.sprite = parsed.sprite;
    current.area = parsed.area;
    current.budgetPx = LIMITS.initialBudgetPx;
    current.budgetAt = now;
    return { player: current, accepted: true };
  };

  io.on("connection", socket => {
    if (held >= maxPlayers) {
      socket.emit("message", [Op.REFUSE, "full"]);
      setTimeout(() => socket.disconnect(true), 50);
      return;
    }
    held += 1;
    let player = null;
    let gone = false;
    const helloWait = setTimeout(() => {
      if (!player) {
        socket.disconnect(true);
      }
    }, 10000);
    const cleanup = () => {
      if (gone) {
        return;
      }
      gone = true;
      clearTimeout(helloWait);
      held -= 1;
      forget(player);
      player = null;
    };
    socket.on("disconnect", cleanup);
    socket.emit("message", "go");

    socket.on("message", raw => {
      if (gone || !Array.isArray(raw)) {
        return;
      }
      if (raw[0] === Op.MOVE) {
        if (!player) {
          return;
        }
        const move = parseMove(raw);
        if (!move || move.area !== player.area) {
          return;
        }
        const prevX = player.x;
        const prevY = player.y;
        const prevFacing = player.facing;
        if (!attemptStep(player, move.x, move.y, Date.now())) {
          return;
        }
        player.facing = move.facing;
        if (player.x === prevX && player.y === prevY && player.facing === prevFacing) {
          return;
        }
        broadcast(player.area, [Op.MOVE, player.id, player.x, player.y, player.facing, player.area], player.id);
        return;
      }
      if (raw[0] !== Op.HELLO) {
        return;
      }
      const parsed = parseHello(raw);
      if (!parsed) {
        socket.emit("message", [Op.REFUSE, "bad-hello"]);
        return;
      }
      const applied = applyHello(socket, player, parsed, Date.now());
      player = applied.player;
      if (!applied.accepted) {
        return;
      }
      clearTimeout(helloWait);
      socket.emit("message", [Op.WELCOME, ...describe(player)]);
      sendRoster(socket, player);
    });
  });

  return {
    listen(port = 0, host = "0.0.0.0") {
      return new Promise((resolve, reject) => {
        httpServer.once("error", reject);
        httpServer.listen(port, host, () => {
          const address = httpServer.address();
          resolve(typeof address === "object" && address ? address.port : port);
        });
      });
    },
    close() {
      return new Promise(resolve => {
        io.close(() => {
          httpServer.close(() => resolve());
        });
      });
    },
    playerCount() {
      return players.size;
    },
    socketCount() {
      return held;
    },
    /** Disconnects the socket. A second call is a no-op and does not broadcast. */
    removePlayer(id) {
      const found = players.get(id);
      if (!found) {
        return false;
      }
      found.socket.disconnect(true);
      return true;
    },
  };
}
