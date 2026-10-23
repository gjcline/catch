/*
 * CatchCrypt presence process entry. AGPL-3.0.
 * SPDX-FileCopyrightText: 2026 Pagefault Games
 * SPDX-License-Identifier: AGPL-3.0-only
 */
import { createPresenceServer } from "./server.js";

const maxRaw = Number(process.env.PRESENCE_MAX);
const portRaw = Number(process.env.PORT);
const maxPlayers = Number.isFinite(maxRaw) && maxRaw > 0 ? maxRaw : 80;
const port = Number.isFinite(portRaw) && portRaw > 0 ? portRaw : 3001;

const server = createPresenceServer({ maxPlayers });
server.listen(port).then(
  actual => {
    console.log(`CatchCrypt presence listening on ${actual} (max ${maxPlayers})`);
  },
  err => {
    console.error(err);
    process.exit(1);
  },
);
