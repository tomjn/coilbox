# Multiplayer Battle Mod/Map Options - Design

Date: 2026-07-03
Branch: `feat/multiplayer-battle-options`

## Problem

Multiplayer battles carry mod options, map options, and start-pos type as
`script_tags` on the `Battle` (delivered by the lobby `SETSCRIPTTAGS` command and
already mirrored to the frontend as `battle.scriptTags`). Nothing interprets
them:

1. **Launch is wrong.** `battle_to_config()` in
   `tauri-plugin-coilbox-multiplayer/src/lib.rs` hardcodes `startPosType: 0` and
   emits no `modOptions`/`mapOptions`, so a joined battle launches ignoring the
   host's chosen options.
2. **No visibility or control.** The battle room shows no mod/map options, and
   there is no way to change them.

## Goal

- Joined battles launch with the correct start-pos type + mod/map options.
- The battle room displays current mod/map options (and start-pos type) against
  the archive's option schema.
- Privileged users can edit them: the battle founder writes directly via the
  lobby; in autohost (SPADS) battles coilbox sends `!bSet` chat commands.
- Edits use a pending -> confirm-on-echo model with a timeout-authoritative
  revert.

## Non-goals (this pass)

- Autohost chat-reply parsing for fast/annotated rejection (timeout is the
  authoritative revert signal; chat-parse is a deferrable UX fast-path).
- Extracting a shared options component used by both `play` and multiplayer
  (Approach C). We reuse only the low-level field renderer.
- Battle presets (`!bPreset`) / hosting settings.

## Architecture (Approach B)

Reuse the low-level per-option field renderer (`ModOptionField`) from the
singleplayer `play` UI. Do **not** reuse `play`'s `GameOptionsPanel` wholesale -
it edits a local config object and has no concept of a remote authority or
pending/echo. A new battle-specific container owns the async state machine and
the founder-vs-autohost dispatch. `play` is untouched.

### 1. Backend - launch correctness

`battle_to_config()` (`tauri-plugin-coilbox-multiplayer/src/lib.rs`) translates
the joined battle's `script_tags` into the existing `play` `BattleConfig`:

- `game/startpostype` -> `start_pos_type` (replaces hardcoded `0`)
- `game/modoptions/<k>` -> `mod_options[k]`
- `game/mapoptions/<k>` -> `map_options[k]`

Pure string->config mapping; `BattleConfig` already accepts all three. Unknown /
malformed `startpostype` falls back to `0`. Keys outside these three prefixes are
ignored for launch.

### 2. Options schema source (unitsync)

- **Mod options:** `gameInfo.options` (`GameInfoOutput.options: Vec<ConfigOption>`),
  already fetched in `useBattleRoom` via `useUnitsyncGameInfo` (currently only
  `.sides` is read).
- **Map options:** add a map-info fetch for `MapInfoOutput.options` (parallel to
  the existing game-info fetch).
- Both are `ConfigOption[]` (type/key/name/default/listItems...), the schema
  `ModOptionField` already renders.

**Content-not-installed fallback:** if unitsync cannot provide a schema (game or
map not installed locally), render the raw `game/modoptions/*` /
`game/mapoptions/*` entries from `scriptTags` as a read-only `key=value` list.
Fail loud - do not hide the fact that the schema is unavailable.

### 3. Frontend UI - `BattleOptionsDrawer`

A drawer (not an inline collapsible pane) opened from a trigger in the battle
room - the right `aside` is already busy (`BattleMapCard` / `BattleGameCard` /
`StartPosOptions` / `MissingContentCard` / `AutohostControls`) and a full
mod+map option list would overflow it. This follows the project's
drawers-over-dialogs/panes preference. The trigger is a compact "Battle options"
button/summary in the aside (showing e.g. a count of non-default options);
opening it slides in the drawer with the full list.

Drawer contents:

- Two sections: **Mod Options** and **Map Options**, each mapping its
  `ConfigOption[]` schema.
- Current value per option resolved from `battle.scriptTags`
  (`game/modoptions/<key>` / `game/mapoptions/<key>`), falling back to the
  option's `default`.
- Renders via `ModOptionField`.
- Read-only when the user cannot edit; interactive controls when they can.
- When schema is unavailable, the raw read-only fallback replaces that section.

Build on the existing drawer pattern: a `radix-ui` `Dialog` primitive styled as a
slide-in, matching `src/play/pages/components/MapPickerDrawer.tsx` /
`GamePickerDrawer.tsx` / `src/multiplayer/ConsoleDrawer.tsx`. There is no
`@picoframe` registry drawer; do not hand-roll a new primitive - follow those.
Field controls inside still use `ModOptionField` (which uses registry inputs).

### 4. Editing dispatch + pending/echo state machine

Lives in `useBattleRoom` (state) + `BattleOptionsDrawer` (presentation).

**Can-edit detection:** editable if `battle.host === myUsername` (founder) OR the
founder account is a bot (autohost battle). Spectators may still be refused by the
autohost; we show controls and let the timeout/echo surface the outcome rather
than predicting privilege.

**Dispatch on change:**

- **Founder:** `mpSetScriptTags({ "game/modoptions/<k>": v })` (also
  `game/mapoptions/*`, `game/startpostype`).
- **Autohost battle:** send `!bSet <name> <value>` to the battle
  (`sayBattle`/`autohostSend`). For start-pos type: `!bSet startpostype <n>`.

Both paths end with the server broadcasting `SETSCRIPTTAGS`, so a single
pending/echo model covers both.

**Pending/echo/timeout:**

- On edit, mark that option key `pending` and display the pending value.
- When the next `SETSCRIPTTAGS` echo carries the key with the new value, confirm
  (clear pending).
- If no confirming echo arrives within a timeout (~8s), revert to the last
  confirmed value and clear pending. The timeout is authoritative and identical
  for founder and autohost paths (the founder/lobby path has no per-tag reject
  reply by protocol, so timeout is the only signal there).

### 5. Start-pos type

`game/startpostype` is handled as a battle option through the same dispatch +
pending/echo path. The existing `StartPosOptions` display stays; editing is added
via the same mechanism (`!bSet startpostype <n>` / `mpSetScriptTags`).

## Edge cases

- **Schema unavailable** (content not installed): raw read-only `key=value`
  fallback per section.
- **Edit rejected / no privilege:** control reverts on timeout to the confirmed
  value; no false "it worked".
- **Malformed `startpostype`:** launch falls back to `0`.
- **Option present in `scriptTags` but not in schema:** shown in the raw
  fallback / ignored by the typed renderer; still applied at launch.
- **Option in schema but absent from `scriptTags`:** displayed at its `default`.

## Testing

- **Rust (protocol/plugin):** unit-test the `script_tags` -> `BattleConfig`
  translation in `battle_to_config` (startpostype parse incl. malformed, mod/map
  option prefix routing, empty tags).
- **Frontend:** the value-resolution + pending/echo/timeout state logic is the
  risk area; unit-test the pure reducer/helper that maps
  `(scriptTags, pendingEdits, schema)` -> displayed values and the edit-dispatch
  key mapping. Component wiring verified live via `bun tauri dev`.
- Full lint suite before PR (Rust fmt+clippy, `biome ci`, typecheck) per
  CLAUDE.md.

## Integration points (files)

- `crates/tauri-plugin-coilbox-multiplayer/src/lib.rs` - `battle_to_config`
- `src/multiplayer/battle/useBattleRoom.ts` - map-info fetch, can-edit, dispatch,
  pending/echo state
- `src/multiplayer/battle/BattleOptionsDrawer.tsx` - new (drawer + trigger)
- `src/multiplayer/pages/BattleRoomPage.tsx` - mount the trigger/drawer
- Drawer built on `radix-ui` `Dialog`, following `MapPickerDrawer.tsx` /
  `ConsoleDrawer.tsx` (no new shared primitive)
- `src/multiplayer/battle/config.ts` - pure helpers (value resolution) if needed
- Reused: `ModOptionField` (from `play`), `mpSetScriptTags`, `sayBattle`/
  `autohostSend`, unitsync game/map-info hooks
