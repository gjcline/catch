# Catch: game to server hooks
`src/catch/catch-client.ts` reports events to the private catch-backend (`VITE_CATCH_API`).
- title-phase `end()` (new run) → `POST /api/runs`; the server's seed is applied with `setSeed()`, except daily runs.
- attempt-capture-phase `catch()` → `catch` {speciesId, shiny, legendary, mythical, boss}
- battle-end-phase (victory) → `battle_won` {boss, trainer} + `wave_reached`
- game-over-phase (victory) → `run_won`
A reward arrives as a `catch:reward` window event for the UI.

## Anti cheat (the client is untrusted)
v1, now: server makes all rolls (crypto RNG); one event per type per wave; waves must be monotonic with no skips; there's a minimum real time per wave; runs that break the rules are flagged and can't claim; daily caps apply per account AND per wallet; claims are rate limited; a hold check runs at claim time; the card value cap and blacklist are enforced server side.
v1 gaps: a modified client can still fake a shiny/legendary catch payload. That's why drop chances and daily caps bound the loss.
v2, before real cards: the server already issues the seed. Make the client upload its input log (turn commands), and re-simulate the run headlessly in Node with PokeRogue's own engine (the vitest GameManager harness) to confirm the encounter species, shininess and outcome before a reward becomes claimable. Until then, high value triggers should go through manual review.
