# Multiplayer Battle List — Design

Date: 2026-07-03 Branch: feat/multiplayer-lobby

## Goal

A dedicated, polished **Battles** surface for the multiplayer module: browse the open battles streaming from the TASServer lobby, filter/sort them, and join one. "Join in place" — joining is reflected as status on the Battles page itself; we do not navigate away and we do not build a battle-room UI in this pass.

## Context / what already exists

Battles are already plumbed end-to-end below the UI:

- **Protocol + state**: `crates/coilbox-lobby-protocol/` parses and reduces all BATTLE messages into `LobbyState.battles: Record<string, Battle>` (keys are stringified `u32`). `current_battle` / `last_battle` track own membership.
- **Tauri plugin**: `crates/tauri-plugin-coilbox-multiplayer/` exposes `mp_join_battle`, `mp_leave_battle`, and the rest. Battles arrive **passively** in the login state stream — there is no `mp_list_battles` to call.
- **Frontend mirror**: `src/multiplayer/store.tsx` keeps a `LobbyMirror`; on **any** delta it re-fetches a full snapshot (`mpSnapshot`) — "correctness over incremental cleverness." So a list reading `mirror.state.battles` stays fresh for free. `useMultiplayer()` exposes `{ mirror, activeKey, busy, connect, ... }`.
- A **rudimentary** battle list already lives inside `pages/LobbyPage.tsx` (lines ~165-202). It stays as-is; this work does not touch LobbyPage.

Reference for patterns: the recently-built Chat hub (`pages/ChatPage.tsx`, `chat/ConversationSidebar.tsx`, `chat/ChannelBrowser.tsx`).

## Scope

In scope:
- New nav item + route `multiplayer.battles` → `/battles`.
- Battle list: rows with title, map, game, host, occupancy, spectators, lock/password.
- Search box + toggles: hide-empty, hide-passworded/locked, hide-full. Column sort.
- Join action, incl. password prompt for passworded battles, with success/failure status shown in place. Leave action while joined.

Out of scope (later passes):
- Battle-room UI (members/teams/allies/ready/start, start rects).
- Battle chat (SAIDBATTLE) — the ChatPane reuse seam is noted but not built here.
- Launching the game (`mpBuildBattleConfig` → `play` plugin).
- Spectate-vs-play choice, hosting/opening a battle.

## Architecture

```
src/multiplayer/
  index.ts                    // + battles nav item + route            (edit)
  store.tsx                   // + lastJoinError field + clear on join  (edit)
  pages/BattlesPage.tsx       // page shell: guard, header, banner, list (new)
  battles/
    useBattles.ts             // derive filtered+sorted Battle[]         (new)
    BattleList.tsx            // maps rows, empty state                  (new)
    BattleRow.tsx             // one battle row + Join                   (new)
    JoinBattlePopover.tsx     // password prompt anchored on Join (picoframe popover)  (new)
```

### Data flow (read-only off the mirror)

```ts
const { mirror, activeKey, busy, lastJoinError } = useMultiplayer()
const battles = Object.values(mirror.state?.battles ?? {})   // auto-fresh
const ready   = mirror.phase === "ready"
const joined  = mirror.state?.currentBattle ?? null           // number | null

// occupancy computed defensively — host is NOT guaranteed in `members`
// (classic TASServer sends no JOINEDBATTLE for the founder):
function occupancy(b: Battle): number {
  const m = Object.keys(b.members).length
  return b.host in b.members ? m : m + 1
}
```

`Battle` fields used: `id, host, map, modname, maxPlayers, passworded, locked,` `spectatorCount, title, members`.

### Components

- **`BattlesPage`** — owns filter/sort UI state via `useState` (`search`, `hideEmpty`, `hideLockedPassworded`, `hideFull`, `sortKey`, `sortDir`). Renders: not-connected guard (mirror the ChatPage guard), joined banner when `joined != null`, header controls, and `<BattleList>`. Passes derived list down.
- **`useBattles(battles, filters)`** — pure hook: applies search (title/map/host/modname, case-insensitive), toggles, and sort. Default sort = occupancy desc. Returns `Battle[]`. No side effects, unit-testable.
- **`BattleList`** — maps rows; renders empty state ("No open battles" vs "No battles match your filters"). Column headers act as sort controls.
- **`BattleRow`** — one battle: title, map, game (`modname`), host, `occupancy/maxPlayers`, spectatorCount, lock + password icons (picoframe/lucide). Join button: disabled when `!ready`, `busy`, or already `joined`. Highlighted when this row is the joined battle.
- **`JoinBattlePopover`** — picoframe `popover` whose trigger is the row's Join button (drawers/popovers preferred over modal dialogs). Collects the key, then calls the join. Closing resets the field.

### Join flow (join in place)

```
Join(b) →
  b.passworded ? open JoinBattlePopover(on Join button) : joinNow(b)
  onSubmit(key) → joinNow(b, key)
  joinNow(b, key?) →
    clearJoinError()                                   // reset lastJoinError
    mpJoinBattle({ serverKey: activeKey, id: b.id, key })   // gated on ready
  success → snapshot's currentBattle flips → banner "You're in <title>" + [Leave]
  failure → Delta::JoinBattleFailed{reason} → store sets lastJoinError → shown inline
Leave → mpLeaveBattle({ serverKey: activeKey })        // clears currentBattle
```

### Store change (small, surgical)

Join **success** is observable from the snapshot (`currentBattle` flips), but the **failure reason** is a transient delta the store currently discards (it only re-snapshots on delta). Add:

- `LobbyMirror.lastJoinError: string | null` (in `store.tsx`).
- `mirrorReducer`: on a `joinBattleFailed` / `openBattleFailed` event, set `lastJoinError = reason` (in addition to the existing snapshot refresh).
- Expose `lastJoinError` and a `clearJoinError()` from `useMultiplayer()`; `clearJoinError()` is called at the start of each join attempt.

This is the only change to existing state plumbing. Everything else is additive.

### States handled

- Not connected / not `ready` → guard message, Join disabled.
- Empty battle list vs filtered-to-empty → distinct empty copy.
- `busy` (a command in flight) → Join/Leave disabled.
- Joined → banner + Leave; other rows' Join disabled; joined row highlighted.
- Join failed → inline error from `lastJoinError` (e.g. wrong password, locked).

## Testing

- **`useBattles`** unit tests: search matching across fields, each toggle, sort by occupancy/map/game asc+desc, occupancy edge case (host absent vs present in `members`), filtered-to-empty.
- **Store**: `joinBattleFailed` sets `lastJoinError`; `clearJoinError()` resets it; a subsequent successful snapshot leaves it cleared.
- **Manual smoke** (`bun tauri dev`, live TASServer): battle appears/updates/closes live; join a public battle → banner + Leave works; join a passworded battle → popover → wrong key shows reason; occupancy matches the server.
- Full lint suite before PR: `cargo fmt --all --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `bunx biome ci .`, `bun run typecheck`. (Rust only changes if any; this pass is frontend + store.)

## Risks / notes

- **Occupancy correctness** depends on whether the server seeds the founder into `members`. The defensive `host in members ? m : m+1` handles both; verify against a live server during smoke.
- **spectatorCount** from `UPDATEBATTLEINFO` is a count of spectating members, a subset — shown separately, not subtracted from occupancy in this pass.
- Reusing picoframe `popover` requires it be present in `src/components/ui/`; add via `npx shadcn@latest add @picoframe/popover` if missing.
