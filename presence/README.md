<!--
SPDX-FileCopyrightText: 2026 Pagefault Games
SPDX-License-Identifier: CC-BY-NC-SA-4.0
-->

# CatchCrypt presence

Socket.IO service for the between-wave town. Players in the same area see each other walk. Nothing else is synced. The wire format is [PROTOCOL.md](./PROTOCOL.md).

## Run locally

From the repo root, with Node 20+:

```bash
pnpm --dir presence --ignore-workspace install
pnpm --dir presence start
```

The process listens on `PORT` or **3001**. Health check: `GET /health` → `{ "ok": true, "players": 0, "max": 80 }`.

Then start the game (`pnpm start:dev`). `.env.development` points the client at `http://localhost:3001`. Open two browsers, walk both into the town, and each player sprite should follow the other. A name override for the second window is `localStorage.cc_presence_name`. The Character button in town picks a sprite; the id is sent on hello.

```bash
pnpm --dir presence test
```

That test connects two Socket.IO clients, checks that each sees the other's move, and checks that disconnect clears the sprite.

## Environment

| Name | Where | Default |
| --- | --- | --- |
| `PORT` | Railway / local server | `3001` |
| `PRESENCE_MAX` | server | `80` concurrent sockets (about 50–100) |
| `PRESENCE_CORS` | server | `*` (comma-separated origins also work) |
| `VITE_CATCH_PRESENCE_URL` | **Vite build** of the game | empty in production, so the town stays solo |

`VITE_CATCH_PRESENCE_URL` is baked in at `pnpm build:catchcrypt` / `vite build`. Set it in the Vercel project (or `.env.production`) to the public Railway URL, including `https://`, and redeploy the game. An empty value, or a server that is down, does not block the town.

There is no wallet, Privy, Postgres, or fee-claimer on this service. Display names are the logged-in username, `Guest`, or `cc_presence_name`.

## Railway

Create the service with **root directory `presence`** so Nixpacks uses this `package.json`. [`railway.toml`](./railway.toml) sets:

- start: `node src/index.js`
- health: `/health`

Do not point this service at the game's Vite start command. The game stays on Vercel and only dials the presence URL.

Redeploy this service when the sprite allowlist in `src/protocol.js` changes. Until then every hello is stored as `misa`, so other players only see the default sheet. The town itself still walks if this process is down.
