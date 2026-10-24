/*
 * CatchCrypt between-wave presence client. AGPL-3.0.
 * Socket.IO only. Cards and wallets stay in catch-client.ts.
 * Wire format: presence/PROTOCOL.md.
 */
import type { Socket } from "socket.io-client";

export type Facing = "front" | "back" | "left" | "right";

export const Op = {
  HELLO: 0,
  WELCOME: 1,
  SPAWN: 2,
  MOVE: 4,
  LIST: 16,
  LEAVE: 22,
  REFUSE: 30,
} as const;

/** How often a walking player tells the server where they are. */
export const PRESENCE_MOVE_MS = 80;

/** A step farther than this at join is sent as a fresh hello, not a move. */
const CATCH_UP_PX = 90;

const FULL_BACKOFF_MS = 15_000;

const FACING: readonly Facing[] = ["front", "back", "left", "right"];

let refusedUntil = 0;

export interface PresencePeer {
  id: string;
  name: string;
  x: number;
  y: number;
  facing: Facing;
  sprite: string;
  area: string;
}

export interface PresenceMove {
  id: string;
  x: number;
  y: number;
  facing: Facing;
  area: string;
}

export interface HelloState {
  name: string;
  x: number;
  y: number;
  facing: Facing;
  sprite: string;
  area: string;
}

export interface MoveState {
  x: number;
  y: number;
  facing: Facing;
  area: string;
}

export interface PresenceHandlers {
  spawn: (peer: PresencePeer) => void;
  move: (move: PresenceMove) => void;
  leave: (id: string) => void;
}

export type PresenceEvent =
  | { type: "go" }
  | { type: "welcome"; peer: PresencePeer }
  | { type: "spawn"; peer: PresencePeer }
  | { type: "list"; peers: PresencePeer[] }
  | { type: "move"; move: PresenceMove }
  | { type: "leave"; id: string }
  | { type: "refuse"; reason: string };

function isFacing(value: unknown): value is Facing {
  return typeof value === "string" && FACING.includes(value as Facing);
}

function peerFrom(parts: unknown): PresencePeer | null {
  if (!Array.isArray(parts) || parts.length < 7) {
    return null;
  }
  const [id, name, x, y, facing, sprite, area] = parts;
  if (typeof id !== "string" || typeof name !== "string" || typeof sprite !== "string" || typeof area !== "string") {
    return null;
  }
  if (
    typeof x !== "number"
    || typeof y !== "number"
    || !Number.isFinite(x)
    || !Number.isFinite(y)
    || !isFacing(facing)
  ) {
    return null;
  }
  return { id, name, x, y, facing, sprite, area };
}

/** Presence URL. Empty means the town stays solo. Dev with no env falls back to localhost. */
export function presenceUrl(): string {
  const raw = import.meta.env.VITE_CATCH_PRESENCE_URL;
  if (typeof raw === "string" && raw.trim().length > 0) {
    return raw.trim();
  }
  if (import.meta.env.MODE === "development") {
    return "http://localhost:3001";
  }
  return "";
}

export function encodeHello(state: HelloState): [number, string, number, number, Facing, string, string] {
  return [Op.HELLO, state.name, state.x, state.y, state.facing, state.sprite, state.area];
}

export function encodeMove(state: MoveState): [number, number, number, Facing, string] {
  return [Op.MOVE, state.x, state.y, state.facing, state.area];
}

export function decodePresenceMessage(payload: unknown): PresenceEvent | null {
  if (payload === "go") {
    return { type: "go" };
  }
  if (!Array.isArray(payload) || typeof payload[0] !== "number") {
    return null;
  }
  const op = payload[0];
  if (op === Op.WELCOME || op === Op.SPAWN) {
    const peer = peerFrom(payload.slice(1));
    if (!peer) {
      return null;
    }
    return op === Op.WELCOME ? { type: "welcome", peer } : { type: "spawn", peer };
  }
  if (op === Op.LIST) {
    const peers: PresencePeer[] = [];
    for (const item of payload.slice(1)) {
      const peer = peerFrom(item);
      if (peer) {
        peers.push(peer);
      }
    }
    return { type: "list", peers };
  }
  if (op === Op.MOVE) {
    const [, id, x, y, facing, area] = payload;
    if (typeof id !== "string" || typeof area !== "string" || !isFacing(facing)) {
      return null;
    }
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) {
      return null;
    }
    return { type: "move", move: { id, x, y, facing, area } };
  }
  if (op === Op.LEAVE && typeof payload[1] === "string") {
    return { type: "leave", id: payload[1] };
  }
  if (op === Op.REFUSE && typeof payload[1] === "string") {
    return { type: "refuse", reason: payload[1] };
  }
  return null;
}

/** A hidden or refused visit does not open a socket. A visible visit always reconnects. */
export function presenceResumePlan(input: {
  visible: boolean;
  closed: boolean;
  refused: boolean;
}): "ignore" | "reconnect" {
  if (!input.visible || input.closed || input.refused) {
    return "ignore";
  }
  return "reconnect";
}

/**
 * One socket for the visit. Failures are swallowed so the town still walks offline.
 */
export class TownPresence {
  private socket: Socket | null = null;
  private opening = false;
  private ready = false;
  private closed = false;
  /** Bumps when a socket is dropped so an in-flight connect cannot attach late. */
  private generation = 0;
  private selfId = "";
  private helloState: HelloState | null = null;
  private pendingMove: MoveState | null = null;
  private lastEmitAt = 0;
  private moveTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly handlers: PresenceHandlers;

  constructor(handlers: PresenceHandlers) {
    this.handlers = handlers;
  }

  isClosed(): boolean {
    return this.closed;
  }

  hello(state: HelloState): void {
    this.helloState = state;
    this.pendingMove = null;
    this.clearMoveTimer();
    if (this.closed || Date.now() < refusedUntil) {
      return;
    }
    if (!this.socket && !this.opening) {
      this.open();
      return;
    }
    if (this.socket?.connected) {
      this.emitHello();
    }
  }

  /** Latest accepted step. Sends at most once per PRESENCE_MOVE_MS, and only after welcome. */
  move(state: MoveState): void {
    if (this.closed || Date.now() < refusedUntil) {
      return;
    }
    this.pendingMove = state;
    this.scheduleMove();
  }

  /**
   * Open a new socket after the tab was frozen or the network returned.
   * Phones often keep a dead socket marked connected until the next packet fails.
   */
  reconnect(state: HelloState): void {
    this.helloState = state;
    this.pendingMove = null;
    this.clearMoveTimer();
    const plan = presenceResumePlan({
      visible: true,
      closed: this.closed,
      refused: Date.now() < refusedUntil,
    });
    if (plan === "ignore") {
      return;
    }
    this.dropSocket();
    this.open();
  }

  disconnect(): void {
    if (this.closed && !this.socket) {
      return;
    }
    this.closed = true;
    this.ready = false;
    this.opening = false;
    this.pendingMove = null;
    this.clearMoveTimer();
    const socket = this.socket;
    this.socket = null;
    socket?.removeAllListeners();
    socket?.disconnect();
  }

  private open(): void {
    const url = presenceUrl();
    if (url.length === 0 || this.closed || this.opening || Date.now() < refusedUntil) {
      return;
    }
    this.opening = true;
    this.openSocket(url).catch(err => {
      console.error("CatchCrypt: presence unavailable", err);
    });
  }

  private dropSocket(): void {
    this.generation += 1;
    this.ready = false;
    this.opening = false;
    const socket = this.socket;
    this.socket = null;
    if (!socket) {
      return;
    }
    socket.removeAllListeners();
    socket.disconnect();
  }

  private async openSocket(url: string): Promise<void> {
    const generation = this.generation;
    try {
      const { io } = await import("socket.io-client");
      if (this.closed || generation !== this.generation) {
        return;
      }
      const socket = io(url, {
        reconnection: false,
        timeout: 2500,
        transports: ["websocket", "polling"],
      });
      if (this.closed || generation !== this.generation) {
        socket.removeAllListeners();
        socket.disconnect();
        return;
      }
      this.socket = socket;
      socket.on("connect_error", () => {
        if (generation !== this.generation) {
          return;
        }
        this.failSoft(socket);
      });
      socket.on("disconnect", () => {
        if (this.closed || this.socket !== socket) {
          return;
        }
        this.ready = false;
        this.opening = false;
        this.socket = null;
      });
      socket.on("message", (payload: unknown) => {
        if (generation !== this.generation) {
          return;
        }
        this.onMessage(payload);
      });
    } catch (err) {
      console.error("CatchCrypt: presence unavailable", err);
      if (generation === this.generation) {
        this.opening = false;
        this.socket = null;
      }
    }
  }

  private failSoft(socket: Socket): void {
    this.ready = false;
    this.opening = false;
    if (this.socket === socket) {
      this.socket = null;
    }
    socket.removeAllListeners();
    socket.disconnect();
  }

  private onMessage(payload: unknown): void {
    const event = decodePresenceMessage(payload);
    if (!event || this.closed) {
      return;
    }
    if (event.type === "go") {
      this.opening = false;
      if (this.helloState && this.socket?.connected) {
        this.emitHello();
      }
      return;
    }
    if (event.type === "welcome") {
      this.selfId = event.peer.id;
      this.ready = true;
      this.opening = false;
      this.catchUp();
      return;
    }
    if (event.type === "refuse") {
      if (event.reason === "full") {
        refusedUntil = Date.now() + FULL_BACKOFF_MS;
      }
      console.warn("CatchCrypt presence:", event.reason);
      this.disconnect();
      return;
    }
    if (event.type === "spawn" || event.type === "list") {
      const peers = event.type === "spawn" ? [event.peer] : event.peers;
      for (const peer of peers) {
        if (peer.id !== this.selfId) {
          this.handlers.spawn(peer);
        }
      }
      return;
    }
    if (event.type === "move") {
      if (event.move.id !== this.selfId) {
        this.handlers.move(event.move);
      }
      return;
    }
    this.handlers.leave(event.id);
  }

  /** If the player walked a long way before welcome, snap the server with another hello. */
  private catchUp(): void {
    const pending = this.pendingMove;
    const hello = this.helloState;
    if (!pending || !hello) {
      this.scheduleMove();
      return;
    }
    const dist = Math.hypot(pending.x - hello.x, pending.y - hello.y);
    if (dist > CATCH_UP_PX || pending.area !== hello.area) {
      this.pendingMove = null;
      this.helloState = { ...hello, x: pending.x, y: pending.y, facing: pending.facing, area: pending.area };
      this.emitHello();
      return;
    }
    this.scheduleMove();
  }

  private emitHello(): void {
    if (!this.helloState || !this.socket?.connected) {
      return;
    }
    this.socket.emit("message", encodeHello(this.helloState));
  }

  private scheduleMove(): void {
    if (!this.ready || !this.pendingMove || !this.socket?.connected) {
      return;
    }
    const wait = PRESENCE_MOVE_MS - (Date.now() - this.lastEmitAt);
    if (wait <= 0) {
      this.flushMove();
      return;
    }
    if (this.moveTimer !== null) {
      return;
    }
    this.moveTimer = setTimeout(() => {
      this.moveTimer = null;
      this.flushMove();
    }, wait);
  }

  private flushMove(): void {
    const state = this.pendingMove;
    if (!state || !this.ready || !this.socket?.connected) {
      return;
    }
    this.pendingMove = null;
    this.lastEmitAt = Date.now();
    this.helloState = this.helloState
      ? { ...this.helloState, x: state.x, y: state.y, facing: state.facing, area: state.area }
      : null;
    this.socket.emit("message", encodeMove(state));
  }

  private clearMoveTimer(): void {
    if (this.moveTimer !== null) {
      clearTimeout(this.moveTimer);
      this.moveTimer = null;
    }
  }
}
