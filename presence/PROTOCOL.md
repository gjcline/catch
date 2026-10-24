<!--
SPDX-FileCopyrightText: 2026 Pagefault Games
SPDX-License-Identifier: CC-BY-NC-SA-4.0
-->

# CatchCrypt town presence protocol

Presence only. Players in the same between-wave area see each other walk. There is no combat, chat, loot, or wallet on this socket.

This follows the HUNT / BrowserQuest shape: Socket.IO v4, one event name `"message"` in both directions, and JSON-compatible arrays `[opcode, …]`. The first server message is the string `"go"`, not an array.

Numbers `0`, `1`, `2`, `4`, `16`, and `22` match HUNT. `30` is CatchCrypt-only (HUNT uses `9` for hurt, so refuse does not reuse it).

## Rooms

One Node process and one Socket.IO namespace. Each overworld area is a room: `town`, `grove`, `route1`, `forest`, `beach`, `cave`. A player only receives spawn, move, and leave for the area they are in. Changing area is a new hello, not a move.

Coordinates are pixel positions of the sprite center. Tiles are 32px. The server uses the same map sizes as `src/catch/town-maps.ts`:

| Area | Tiles | Pixels |
| --- | --- | --- |
| town | 76×72 | 2432×2304 |
| grove | 44×38 | 1408×1216 |
| route1 | 56×80 | 1792×2560 |
| forest | 64×88 | 2048×2816 |
| beach | 42×32 | 1344×1024 |
| cave | 38×30 | 1216×960 |

Facing is `front`, `back`, `left`, or `right` (the `misa-*` atlas frames).

Sprite is a string id on this allowlist: `misa`, `misa-rose`, `misa-sea`, `misa-moss`, `misa-gold`, `misa-dusk`. Anything else, including a missing or non-string value, is stored as `misa`. The hello is still accepted. Older clients that always send `misa` keep working, and older clients that ignore the field still draw the default sheet. A later hello is how a player changes character: the same socket updates its sprite, and the area receives another spawn so other clients can redraw them.

## Join

1. Client connects.
2. Server sends `"go"` if the process is under `PRESENCE_MAX` (default 80). If it is full, the server sends `[30, "full"]` and disconnects.
3. Client sends hello.
4. Server sends welcome, then list, then one spawn per player already in that area. Each of those players gets a spawn for the newcomer.

```
client → server  [0, name, x, y, facing, sprite, area]
server → client  [1, id, name, x, y, facing, sprite, area]     WELCOME
server → client  [16, [id, name, x, y, facing, sprite, area], …]  LIST
server → client  [2, id, name, x, y, facing, sprite, area]     SPAWN (one per neighbor)
```

Hello outside the map, or with a bad facing or area, is `[30, "bad-hello"]`. The socket stays up so the client can hello again. Names are trimmed to 16 visible characters; anything empty becomes `Guest`.

A later hello from the same socket is how the player changes area (or catches the server up after a long connect). The previous area receives `[22, id]`. The new area receives a spawn. Hello resets the step budget.

## Move

```
client → server  [4, x, y, facing, area]
server → others  [4, id, x, y, facing, area]
```

The server ignores a move whose area does not match the last hello. It rejects a position outside the map, and it rejects a step farther than the walk budget (about 180px/s, never more than 96px in one message). Rejected moves are not broadcast and do not move the server position. The local Phaser sprite is not snapped; other players simply do not see the illegal jump.

The town client sends a move after each accepted step and throttles to 80ms.

## Leave

Disconnect deletes the player once and broadcasts `[22, id]` to the area. A second cleanup for the same id does nothing. The client also disconnects when leaving town for a battle (Battle, B, Esc, or tall grass). An area change does not disconnect; it re-hellos.

## Solo play

If `VITE_CATCH_PRESENCE_URL` is empty, or the socket errors, the town does not wait on it. Walking, gates, tall grass, the party button, and Battle keep working.
