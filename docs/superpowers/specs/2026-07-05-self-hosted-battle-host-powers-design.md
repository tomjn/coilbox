# Self-hosted battle: native host powers

## Problem

When a user hosts their own multiplayer battle (`selfHost = isFounder && !hostIsBot`), the battle room still assumes a SPADS autohost is present. Every "host" action is a `!command` typed into battle chat (`autohostSend` → `SAYBATTLE`), which no one interprets when there is no bot. Concretely:

1. The **Host commands** panel (`!balance`/`!fixcolors`/`!ring`) is shown to the self-host, but the commands are inert (SPADS-only).
2. You cannot really **leave** a battle you host - leaving closes it - so the "Leave" button is misleading; it should read **Close battle**.
3. There is no way to **change the map** as host: the map picker only ever **suggests** (`!map`).
4. There is no native **lock** control (only the SPADS `!lock`).
5. Per-player host actions (kick / force-spectate) are implemented but not surfaced cleanly.

Changing the **game/mod** of an open battle is out of scope: the TASServer protocol fixes the mod at `OPENBATTLE` and has no mutator. The game card stays read-only.

## Principle

The `selfHost` flag already exists and already gates roster force-controls. This work applies it to three more surfaces (map card, host-commands panel, leave button) and wires one dormant protocol builder. No new concepts.

## Backend (Rust) - wire dormant founder commands

Audit found several founder builders that exist in `crates/coilbox-lobby-protocol/src/command.rs` but were never exposed. Per the "maximise protocol support" preference, wire all host/founder-relevant dormant builders as Tauri commands + bindings (only `update_battle_info` gets UI now; the rest are exposed for completeness/future use):

| builder | verb | new Tauri command | new binding |
|---|---|---|---|
| `update_battle_info` | `UPDATEBATTLEINFO` | `mp_update_battle_info` | `mpUpdateBattleInfo` |
| `remove_start_rect` | `REMOVESTARTRECT` | `mp_remove_start_rect` | `mpRemoveStartRect` |
| `remove_script_tags` | `REMOVESCRIPTTAGS` | `mp_remove_script_tags` | `mpRemoveScriptTags` |
| `join_battle_deny` | `JOINBATTLEDENY` | `mp_join_battle_deny` | `mpJoinBattleDeny` |

Each new command needs an ACL entry (`build.rs` COMMANDS + `permissions/default.toml`) or it is blocked at runtime. Follow the existing `mp_*` command pattern in `tauri-plugin-coilbox-multiplayer/src/lib.rs`.

`UPDATEBATTLEINFO` carries all four fields at once (`spectators, locked, maphash, map`). To mutate one field the caller resends the current values for the others (see frontend `setMap`/`setLocked`).

### Chat notice on battle-info change (Rust reducer)

The notice infrastructure already exists: `ChatMsg { kind: ChatKind::System }` renders in `ChatPane` as a centered, muted, non-bubble line (`text` printed verbatim). Battle events do not currently emit any chat notice.

In `reduce.rs`, where `ServerMessage::UpdateBattleInfo` is applied, compare the incoming values against the battle's current state **before** overwriting, and push a `System` `ChatMsg` into the battle's channel for what changed:

- map changed → `"Host changed the map to <map>"`
- `locked` false→true → `"Host locked the battle"`
- `locked` true→false → `"Host unlocked the battle"`

(Spectator-count-only changes produce no notice.) Because the server echoes `UPDATEBATTLEINFO` to all battle members including the founder, every client - host included - derives the same notice from the real state change. No client sends a `SAYBATTLE`, so it is never a bubble. Wording uses the literal "Host" to match the requested copy.

## Frontend

### `bindings.ts`
Add the four bindings above (mirroring existing `mp*` binding shape).

### `useBattleRoom.ts`
Add two founder actions that read current battle state for the unchanged fields:

- `setMap(name, hash)` → `mpUpdateBattleInfo(currentSpectatorCount, currentLocked, hash, name)`
- `setLocked(locked)` → `mpUpdateBattleInfo(currentSpectatorCount, locked, currentMapHash, currentMap)`

Expose both on `BattleRoomView` alongside the existing `selfHost` flag. The map hash for a newly-picked map is resolved the same way the `OPENBATTLE` flow resolves map→maphash (confirm the exact source during implementation - reuse it, do not duplicate).

### Map card - `BattleMapCard.tsx` (item 5)
When `selfHost`: label the action **"Change map"** and call `setMap` directly (optimistic; the `UPDATEBATTLEINFO` echo reconciles the view). When not self-host: unchanged ("Suggest map" → `!map`).

### Host-commands panel - `BattleRoomPage.tsx` (items 1 & 4)
When `selfHost`: do not render `AutohostControls` (its buttons are SPADS-only). The native **Lock** control moves to the header (below). When not self-host: render `AutohostControls` as today.

### Header - `BattleRoomHeader.tsx` (items 2 & 4)
When `selfHost`:
- The leave button reads **"Close battle"** (icon swap) and opens a small **confirm popover** (not a modal - matches the drawers/popovers-over-modals preference) before calling `mpLeaveBattle`. Closing drops everyone, hence the confirm.
- A **Lock** toggle (switch) sits in the header (important, always-visible control), calling `setLocked`. Reflects `battle.locked`.

When not self-host: header is unchanged (plain "Leave", no lock toggle).

### Roster per-player menu - `MemberRow.tsx` / `BattleMembersTable.tsx` (item 6)
When `selfHost`: render a trailing **vertical triple-dot** button at the end of each member row that opens a `popover` menu (no `dropdown-menu` in the picoframe registry; compose from `popover`). Menu items reuse the already-wired `hostControls`: **Kick**, **Force spectate**, and the existing force team/ally/ color actions. When not self-host: no menu button.

## Out of scope
- Changing the game/mod of an open battle (protocol cannot).
- Disable/enable-units, dedicated handicap command (no builders exist).
- UI for `remove_start_rect` / `remove_script_tags` / `join_battle_deny` (wired at the binding layer only).

## Verification
- `cargo fmt --all --check`, `cargo clippy --all-targets --all-features -- -D warnings`
- `bunx biome ci .`, `bun run typecheck`
- Live via `bun tauri dev`: host a battle, confirm the map picker changes the map (with a system notice in chat), the header lock toggles + notices, "Close battle" confirms and tears down, and the per-row triple-dot menu kicks / force-spectates. Confirm a non-self-host (joined/autohost) battle still shows the old suggest/`!command` UI.
