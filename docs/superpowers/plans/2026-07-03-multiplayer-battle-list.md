# Multiplayer Battle List Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a dedicated `/battles` surface to the multiplayer module that lists open TASServer battles, lets the user filter/sort them, and join one (with in-place status), reusing the existing lobby mirror.

**Architecture:** Battles already stream into `LobbyState.battles` and refresh the frontend mirror via the store's "any delta → re-snapshot" rule, so the UI is read-only off `mirror.state.battles`. Filter/sort logic is a pure function (unit-tested). A small store addition retains the transient `joinBattleFailed` reason so failures can be shown. Join success is observed from `currentBattle` flipping in the snapshot.

**Tech Stack:** React 19 + react-router 7, `@picoframe/frame` (`Button`, `Input`) + picoframe shadcn registry (`popover`), lucide-react icons, Tauri command bindings in `src/multiplayer/bindings.ts`. New frontend test harness: **vitest** (node environment; pure-function tests only).

**UI note:** the passworded-join prompt is a **popover** anchored on the Join button (user preference: drawers/popovers over modal dialogs), not a centered dialog.

---

## Reference facts (verified against the codebase)

- `useMultiplayer()` (`src/multiplayer/store.tsx:296`) returns `{ mirror, activeKey, busy, connect, disconnect, unreadFor, markSeen, rememberChannel, forgetChannel }`. This plan adds `lastJoinError` and `clearJoinError` to it.
- `LobbyMirror` (`store.tsx:32`): `{ connected, phase, state, consoleLines, error }`. This plan adds `lastJoinError: string | null`.
- `mirrorReducer` (`store.tsx:61`): folds `MirrorAction`; a `delta` event currently falls to `default: return m` (`store.tsx:90-92`) because the provider re-snapshots. This plan adds a `delta` case that extracts the failure reason.
- `Battle` type (`bindings.ts:97-117`): `{ id, host, ip, port, map, maphash, modname, engine, version, maxPlayers, passworded, locked, spectatorCount, title, channel, members: Record<string, MemberStatus>, bots, scriptTags, startRects }`.
- `LobbyState.battles: Record<string, Battle>` keyed by **stringified** `id`; `currentBattle: number | null` (`bindings.ts:125-126`).
- `Delta` variants `{ kind: "joinBattleFailed"; reason: string }` and `{ kind: "openBattleFailed"; reason: string }` (`bindings.ts:171-172`); `LobbyEvent` `{ kind: "delta"; delta: Delta }` (`bindings.ts:179`).
- `mpJoinBattle({ serverKey, id, key? })` and `mpLeaveBattle({ serverKey })` (`bindings.ts:249-262`) — already registered + ACL-permitted (LobbyPage uses `mpJoinBattle`). **No Rust changes in this plan.**
- Not-connected guard + nav/route patterns to mirror: `pages/ChatPage.tsx:48-63`, `index.ts:29-50`. `@/` import alias resolves to `src/` (per project CLAUDE.md); `Input` is exported from `@picoframe/frame`.

## File structure

- Create `vitest.config.ts` — node-env test config.
- Modify `package.json` — add `vitest` devDep + `test` script.
- Create `src/multiplayer/battles/battleList.ts` — pure `occupancy` + `filterSortBattles` + types.
- Create `src/multiplayer/battles/battleList.test.ts` — unit tests.
- Modify `src/multiplayer/store.tsx` — `lastJoinError` + `clearJoinError`.
- Create `src/multiplayer/store.test.ts` — reducer unit tests.
- Modify `src/multiplayer/index.ts` — nav item + route.
- Create `src/components/ui/popover.tsx` — via shadcn (registry component).
- Create `src/multiplayer/battles/JoinBattlePopover.tsx` — password prompt anchored on Join.
- Create `src/multiplayer/battles/BattleRow.tsx` — one battle row.
- Create `src/multiplayer/battles/BattleList.tsx` — list + empty states.
- Create `src/multiplayer/pages/BattlesPage.tsx` — page shell wiring it together.

---

### Task 1: Add the vitest test harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`

- [ ] **Step 1: Install vitest**

Run: `bun add -d vitest`
Expected: `vitest` appears under `devDependencies` in `package.json`.
Note (risk): the repo pins `vite@^8`. If bun reports a peer-dependency conflict with vitest, install the newest vitest that resolves against Vite 8 and confirm `bunx vitest --version` prints a version. Do not downgrade Vite.

- [ ] **Step 2: Add the test script**

Edit `package.json` `scripts` to add (keep existing entries):

```json
    "test": "vitest run"
```

- [ ] **Step 3: Create the vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
```

- [ ] **Step 4: Verify the harness launches**

Run: `bunx vitest run --passWithNoTests`
Expected: exits 0, reporting "No test files found" (config loads without error).

- [ ] **Step 5: Commit**

```bash
git add package.json vitest.config.ts bun.lock
git commit -m "test: add vitest harness (node env, pure-function tests)"
```

---

### Task 2: Pure battle filter/sort logic

**Files:**
- Create: `src/multiplayer/battles/battleList.ts`
- Test: `src/multiplayer/battles/battleList.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/multiplayer/battles/battleList.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Battle, MemberStatus } from "../bindings";
import { type BattleFilters, filterSortBattles, occupancy } from "./battleList";

function mk(p: Partial<Battle>): Battle {
  return {
    id: 1,
    host: "host",
    ip: "",
    port: "",
    map: "Map",
    maphash: "",
    modname: "Game",
    engine: "",
    version: "",
    maxPlayers: 8,
    passworded: false,
    locked: false,
    spectatorCount: 0,
    title: "Title",
    channel: null,
    members: {},
    bots: {},
    scriptTags: {},
    startRects: {},
    ...p,
  };
}

const M = {} as MemberStatus;

const base: BattleFilters = {
  search: "",
  hideEmpty: false,
  hideLockedPassworded: false,
  hideFull: false,
  sortKey: "players",
  sortDir: "desc",
};

describe("occupancy", () => {
  it("counts the host when absent from members", () => {
    expect(occupancy(mk({ members: {} }))).toBe(1);
    expect(occupancy(mk({ members: { alice: M } }))).toBe(2);
  });

  it("does not double-count a host present in members", () => {
    expect(occupancy(mk({ host: "host", members: { host: M, alice: M } }))).toBe(
      2,
    );
  });
});

describe("filterSortBattles", () => {
  it("search matches title, map, host, and game case-insensitively", () => {
    const list = [
      mk({ id: 1, title: "Alpha" }),
      mk({ id: 2, title: "Beta", map: "DeltaVista" }),
      mk({ id: 3, title: "Gamma", host: "zed" }),
      mk({ id: 4, title: "Delta", modname: "BAR" }),
    ];
    const ids = (q: string) =>
      filterSortBattles(list, { ...base, search: q }).map((b) => b.id).sort();
    expect(ids("delta")).toEqual([2, 4]);
    expect(ids("ZED")).toEqual([3]);
    expect(ids("bar")).toEqual([4]);
  });

  it("hideEmpty drops host-only battles", () => {
    const list = [mk({ id: 1, members: {} }), mk({ id: 2, members: { a: M } })];
    expect(
      filterSortBattles(list, { ...base, hideEmpty: true }).map((b) => b.id),
    ).toEqual([2]);
  });

  it("hideLockedPassworded drops locked or passworded battles", () => {
    const list = [
      mk({ id: 1 }),
      mk({ id: 2, locked: true }),
      mk({ id: 3, passworded: true }),
    ];
    expect(
      filterSortBattles(list, { ...base, hideLockedPassworded: true }).map(
        (b) => b.id,
      ),
    ).toEqual([1]);
  });

  it("hideFull drops battles at or over capacity", () => {
    const list = [
      mk({ id: 1, maxPlayers: 2, members: { a: M } }), // occ 2 == max
      mk({ id: 2, maxPlayers: 4, members: { a: M } }), // occ 2 < max
    ];
    expect(
      filterSortBattles(list, { ...base, hideFull: true }).map((b) => b.id),
    ).toEqual([2]);
  });

  it("sorts by player count descending then ascending", () => {
    const list = [
      mk({ id: 1, members: {} }), // occ 1
      mk({ id: 2, members: { a: M, b: M } }), // occ 3
      mk({ id: 3, members: { a: M } }), // occ 2
    ];
    expect(
      filterSortBattles(list, { ...base, sortDir: "desc" }).map((b) => b.id),
    ).toEqual([2, 3, 1]);
    expect(
      filterSortBattles(list, { ...base, sortDir: "asc" }).map((b) => b.id),
    ).toEqual([1, 3, 2]);
  });

  it("sorts by map name", () => {
    const list = [
      mk({ id: 1, map: "Charlie" }),
      mk({ id: 2, map: "Alpha" }),
      mk({ id: 3, map: "Bravo" }),
    ];
    expect(
      filterSortBattles(list, { ...base, sortKey: "map", sortDir: "asc" }).map(
        (b) => b.id,
      ),
    ).toEqual([2, 3, 1]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/multiplayer/battles/battleList.test.ts`
Expected: FAIL — cannot resolve `./battleList` (module not created yet).

- [ ] **Step 3: Write the implementation**

Create `src/multiplayer/battles/battleList.ts`:

```ts
import type { Battle } from "../bindings";

export type BattleSortKey = "players" | "map" | "game" | "title";

export interface BattleFilters {
  search: string;
  hideEmpty: boolean;
  hideLockedPassworded: boolean;
  hideFull: boolean;
  sortKey: BattleSortKey;
  sortDir: "asc" | "desc";
}

/**
 * Total occupants of a battle. The founder is tracked in `host` and is not
 * guaranteed to appear in `members` (classic TASServer sends no JOINEDBATTLE for
 * the founder), so add one for the host unless they are already a member key.
 */
export function occupancy(b: Battle): number {
  const m = Object.keys(b.members).length;
  return b.host in b.members ? m : m + 1;
}

function compareBy(key: BattleSortKey, a: Battle, b: Battle): number {
  switch (key) {
    case "players":
      return occupancy(a) - occupancy(b) || a.id - b.id;
    case "map":
      return a.map.localeCompare(b.map) || a.id - b.id;
    case "game":
      return a.modname.localeCompare(b.modname) || a.id - b.id;
    case "title":
      return a.title.localeCompare(b.title) || a.id - b.id;
  }
}

/** Filter and sort a battle list for display. Pure — no snapshot access. */
export function filterSortBattles(battles: Battle[], f: BattleFilters): Battle[] {
  const q = f.search.trim().toLowerCase();
  const filtered = battles.filter((b) => {
    if (q) {
      const hay = `${b.title} ${b.map} ${b.host} ${b.modname}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (f.hideEmpty && occupancy(b) <= 1) return false;
    if (f.hideLockedPassworded && (b.locked || b.passworded)) return false;
    if (f.hideFull && occupancy(b) >= b.maxPlayers) return false;
    return true;
  });
  const dir = f.sortDir === "asc" ? 1 : -1;
  return [...filtered].sort((a, b) => dir * compareBy(f.sortKey, a, b));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/multiplayer/battles/battleList.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/multiplayer/battles/battleList.ts src/multiplayer/battles/battleList.test.ts
git commit -m "feat(multiplayer): pure battle filter/sort logic"
```

---

### Task 3: Retain join-failure reason in the store

**Files:**
- Modify: `src/multiplayer/store.tsx`
- Test: `src/multiplayer/store.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `src/multiplayer/store.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LobbyState } from "./bindings";
import { initialMirror, mirrorReducer } from "./store";

const emptyState = {} as LobbyState;

describe("mirrorReducer join-failure handling", () => {
  it("sets lastJoinError from a joinBattleFailed delta", () => {
    const m = mirrorReducer(initialMirror, {
      type: "event",
      ev: { kind: "delta", delta: { kind: "joinBattleFailed", reason: "Wrong password" } },
    });
    expect(m.lastJoinError).toBe("Wrong password");
  });

  it("sets lastJoinError from an openBattleFailed delta", () => {
    const m = mirrorReducer(initialMirror, {
      type: "event",
      ev: { kind: "delta", delta: { kind: "openBattleFailed", reason: "Nope" } },
    });
    expect(m.lastJoinError).toBe("Nope");
  });

  it("ignores unrelated deltas", () => {
    const m = mirrorReducer(initialMirror, {
      type: "event",
      ev: { kind: "delta", delta: { kind: "battleOpened", id: 4 } },
    });
    expect(m.lastJoinError).toBeNull();
  });

  it("clearJoinError resets it", () => {
    const withErr = { ...initialMirror, lastJoinError: "x" };
    expect(mirrorReducer(withErr, { type: "clearJoinError" }).lastJoinError).toBeNull();
  });

  it("snapshot preserves lastJoinError", () => {
    const withErr = { ...initialMirror, lastJoinError: "x" };
    expect(
      mirrorReducer(withErr, { type: "snapshot", state: emptyState }).lastJoinError,
    ).toBe("x");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/multiplayer/store.test.ts`
Expected: FAIL — `lastJoinError` missing and `clearJoinError` action unhandled.

- [ ] **Step 3: Add `lastJoinError` to the mirror interface + initial value**

In `src/multiplayer/store.tsx`, edit the `LobbyMirror` interface (currently ends `error: string | null;` at line 37) to add:

```ts
  error: string | null;
  /** Reason from the last failed JOINBATTLE/OPENBATTLE, cleared on next attempt. */
  lastJoinError: string | null;
```

And `initialMirror` (line 42-48) to include the field:

```ts
export const initialMirror: LobbyMirror = {
  connected: false,
  phase: null,
  state: null,
  consoleLines: [],
  error: null,
  lastJoinError: null,
};
```

- [ ] **Step 4: Add the `clearJoinError` action and handle the delta**

Add to the `MirrorAction` union (line 50-54):

```ts
  | { type: "reset" }
  | { type: "clearJoinError" };
```

In `mirrorReducer`, add a `clearJoinError` case (next to `reset`):

```ts
    case "reset":
      return initialMirror;
    case "clearJoinError":
      return { ...m, lastJoinError: null };
```

Inside the `case "event":` inner `switch (ev.kind)` (line 74), add a `delta` case **before** the `default`:

```ts
        case "delta": {
          const d = ev.delta;
          if (d.kind === "joinBattleFailed" || d.kind === "openBattleFailed") {
            return { ...m, lastJoinError: d.reason };
          }
          return m;
        }
        // `delta` snapshot refresh is handled by the provider.
        default:
          return m;
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bunx vitest run src/multiplayer/store.test.ts`
Expected: PASS.

- [ ] **Step 6: Expose `lastJoinError` + `clearJoinError` from the provider**

Add to the `MultiplayerContextValue` interface (line 100-116):

```ts
  /** Reason from the last failed battle join, or null. */
  lastJoinError: string | null;
  /** Clear the last join-failure reason (call at the start of a join attempt). */
  clearJoinError: () => void;
```

In `MultiplayerProvider`, define the callback (near `disconnect`, after line 274):

```ts
  const clearJoinError = useCallback(() => {
    dispatch({ type: "clearJoinError" });
  }, []);
```

Add both to the context `value` object (line 278-288):

```ts
        rememberChannel,
        forgetChannel,
        lastJoinError: mirror.lastJoinError,
        clearJoinError,
```

- [ ] **Step 7: Typecheck**

Run: `bun run typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/multiplayer/store.tsx src/multiplayer/store.test.ts
git commit -m "feat(multiplayer): retain join-failure reason in mirror"
```

---

### Task 4: Add the Battles nav item + route

**Files:**
- Modify: `src/multiplayer/index.ts`

- [ ] **Step 1: Add the nav item**

In `src/multiplayer/index.ts`, add after the `multiplayer.chat` item (line 30-36), inside `items`:

```ts
        {
          id: "multiplayer.battles",
          label: "Battles",
          to: "/battles",
          end: true,
          order: 2,
          icon: Swords,
        },
```

- [ ] **Step 2: Add the route**

In the `routes` array (after the `chat` route, line 46-50):

```ts
    {
      path: "battles",
      lazy: () => import("./pages/BattlesPage"),
      crumb: "Battles",
    },
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: FAIL — `./pages/BattlesPage` does not exist yet (created in Task 8). This is expected; it resolves once Task 8 lands.

- [ ] **Step 4: Commit**

```bash
git add src/multiplayer/index.ts
git commit -m "feat(multiplayer): battles nav item + route"
```

---

### Task 5: JoinBattlePopover (popover primitive already vendored)

**Files:**
- Create: `src/multiplayer/battles/JoinBattlePopover.tsx`

> Note: `src/components/ui/popover.tsx` **already exists** (added by concurrent work, commit `68bc4a3`) and exports `Popover`, `PopoverTrigger`, `PopoverContent`, `PopoverAnchor` from `@/components/ui/popover` (radix-ui wrapper; default content width `w-72`). Do NOT run shadcn or modify that file — just import from it.

- [ ] **Step 1: Confirm the popover primitive exports**

Read `src/components/ui/popover.tsx` and confirm it exports `Popover`, `PopoverTrigger`, `PopoverContent`. (It does as of commit `68bc4a3`.) No install needed.

- [ ] **Step 2: Create the password-prompt popover**

The popover owns the Join button as its trigger, so the prompt pops from the exact button the user clicked. On submit it hands the key up and closes.

Create `src/multiplayer/battles/JoinBattlePopover.tsx`:

```tsx
import { Button, Input } from "@picoframe/frame";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

/**
 * Join affordance for a passworded battle: the Join button is the popover trigger,
 * and the content is a small password form. Submitting hands the key up and closes;
 * closing resets the field. Used in place of a modal dialog (drawers/popovers
 * preferred over dialogs).
 */
export function JoinBattlePopover({
  title,
  disabled,
  onSubmit,
}: {
  title: string;
  disabled: boolean;
  onSubmit: (key: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setKey("");
      }}
    >
      <PopoverTrigger asChild>
        <Button className="h-8 shrink-0 px-3" disabled={disabled}>
          Join
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-64">
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(key);
            setOpen(false);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Join {title}</span>
            {/* biome-ignore lint/a11y/noAutofocus: focus the sole field on open */}
            <Input
              autoFocus
              type="password"
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="Battle password"
            />
          </label>
          <Button type="submit" className="h-8">
            Join
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `bun run typecheck`
Expected: FAIL only on the still-missing `./pages/BattlesPage` (from Task 4). `JoinBattlePopover.tsx` itself must not add new errors — if the popover import path or exports differ, fix the import to match `src/components/ui/popover.tsx`'s actual exports.

- [ ] **Step 4: Commit**

```bash
git add src/multiplayer/battles/JoinBattlePopover.tsx
git commit -m "feat(multiplayer): join-battle password popover"
```

---

### Task 6: BattleRow component

**Files:**
- Create: `src/multiplayer/battles/BattleRow.tsx`

- [ ] **Step 1: Create the row**

Create `src/multiplayer/battles/BattleRow.tsx`:

```tsx
import { Button } from "@picoframe/frame";
import { Lock, Users } from "lucide-react";
import type { Battle } from "../bindings";
import { occupancy } from "./battleList";
import { JoinBattlePopover } from "./JoinBattlePopover";

/**
 * One battle in the list: title (with a lock glyph when passworded/locked), map ·
 * game · host, occupancy and spectators, and a join affordance. `joined` highlights
 * the battle the user is in; `canJoin` gates joining (ready, not busy, not already
 * in a battle). Passworded battles join via a password popover; others via a plain
 * button. `onJoin`'s optional `key` carries the popover password.
 */
export function BattleRow({
  battle,
  joined,
  canJoin,
  onJoin,
}: {
  battle: Battle;
  joined: boolean;
  canJoin: boolean;
  onJoin: (b: Battle, key?: string) => void;
}) {
  const players = occupancy(battle);
  const full = players >= battle.maxPlayers;
  const restricted = battle.passworded || battle.locked;
  const disabled = joined || !canJoin || full;
  return (
    <li
      className={`flex items-center gap-4 rounded-md border p-3 ${
        joined ? "border-primary bg-primary/5" : "border-border"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-medium">
          {restricted && (
            <Lock
              className="size-3.5 shrink-0 text-muted-foreground"
              aria-label={battle.passworded ? "Passworded" : "Locked"}
            />
          )}
          <span className="truncate">{battle.title}</span>
        </p>
        <p className="truncate text-xs text-muted-foreground">
          {battle.map} · {battle.modname} · host {battle.host}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
        <Users className="size-3.5" aria-hidden />
        <span>
          {players}/{battle.maxPlayers}
        </span>
        {battle.spectatorCount > 0 && (
          <span className="ml-1">+{battle.spectatorCount} spec</span>
        )}
      </div>
      {joined ? (
        <Button className="h-8 shrink-0 px-3" disabled>
          Joined
        </Button>
      ) : battle.passworded ? (
        <JoinBattlePopover
          title={battle.title}
          disabled={disabled}
          onSubmit={(key) => onJoin(battle, key)}
        />
      ) : (
        <Button
          className="h-8 shrink-0 px-3"
          disabled={disabled}
          onClick={() => onJoin(battle)}
        >
          Join
        </Button>
      )}
    </li>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: FAIL only on the still-missing `./pages/BattlesPage`. `BattleRow.tsx` must add no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/multiplayer/battles/BattleRow.tsx
git commit -m "feat(multiplayer): battle row component"
```

---

### Task 7: BattleList component

**Files:**
- Create: `src/multiplayer/battles/BattleList.tsx`

- [ ] **Step 1: Create the list**

Create `src/multiplayer/battles/BattleList.tsx`:

```tsx
import type { Battle } from "../bindings";
import { BattleRow } from "./BattleRow";

/**
 * The scrollable battle list. `totalCount` is the unfiltered battle count so the
 * empty state can distinguish "no battles at all" from "filtered everything out".
 */
export function BattleList({
  battles,
  totalCount,
  joinedId,
  canJoin,
  onJoin,
}: {
  battles: Battle[];
  totalCount: number;
  joinedId: number | null;
  canJoin: boolean;
  onJoin: (b: Battle) => void;
}) {
  if (totalCount === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        No open battles right now.
      </p>
    );
  }
  if (battles.length === 0) {
    return (
      <p className="p-6 text-center text-sm text-muted-foreground">
        No battles match your filters.
      </p>
    );
  }
  return (
    <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-4">
      {battles.map((b) => (
        <BattleRow
          key={b.id}
          battle={b}
          joined={b.id === joinedId}
          canJoin={canJoin}
          onJoin={onJoin}
        />
      ))}
    </ul>
  );
}
```

- [ ] **Step 2: Typecheck**

Run: `bun run typecheck`
Expected: FAIL only on the still-missing `./pages/BattlesPage`.

- [ ] **Step 3: Commit**

```bash
git add src/multiplayer/battles/BattleList.tsx
git commit -m "feat(multiplayer): battle list component"
```

---

### Task 8: BattlesPage (wire it together)

**Files:**
- Create: `src/multiplayer/pages/BattlesPage.tsx`

- [ ] **Step 1: Create the page**

Create `src/multiplayer/pages/BattlesPage.tsx`:

```tsx
import { Button, Input } from "@picoframe/frame";
import { LogOut } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { type Battle, mpJoinBattle, mpLeaveBattle } from "../bindings";
import {
  type BattleFilters,
  type BattleSortKey,
  filterSortBattles,
} from "../battles/battleList";
import { BattleList } from "../battles/BattleList";
import { useMultiplayer } from "../store";

const SORTS: { key: BattleSortKey; label: string }[] = [
  { key: "players", label: "Players" },
  { key: "map", label: "Map" },
  { key: "game", label: "Game" },
];

/**
 * The Battles hub: search + filter/sort controls over the live battle list, with
 * in-place join. Battles come from the mirror snapshot (kept fresh by the store's
 * delta→snapshot rule); joining is reflected by the joined banner rather than
 * navigating away. Connection lives on the Lobby page; disconnected shows a prompt.
 */
export default function BattlesPage() {
  const { mirror, activeKey, busy, lastJoinError, clearJoinError } =
    useMultiplayer();
  const [filters, setFilters] = useState<BattleFilters>({
    search: "",
    hideEmpty: false,
    hideLockedPassworded: false,
    hideFull: false,
    sortKey: "players",
    sortDir: "desc",
  });

  const all = useMemo(
    () => Object.values(mirror.state?.battles ?? {}),
    [mirror.state?.battles],
  );
  const shown = useMemo(() => filterSortBattles(all, filters), [all, filters]);

  const ready = mirror.phase === "ready";
  const joinedId = mirror.state?.currentBattle ?? null;
  const canJoin = ready && !busy && joinedId == null;
  const joinedBattle =
    joinedId != null ? mirror.state?.battles[String(joinedId)] : undefined;

  // `key` is supplied by the row's password popover for passworded battles.
  async function onJoin(b: Battle, key?: string) {
    if (!activeKey) return;
    clearJoinError();
    try {
      await mpJoinBattle({ serverKey: activeKey, id: b.id, key });
    } catch {
      // Wire-level failures surface via lastJoinError or a disconnect.
    }
  }

  async function leave() {
    if (!activeKey) return;
    await mpLeaveBattle({ serverKey: activeKey }).catch(() => {});
  }

  if (!activeKey) {
    return (
      <main className="flex flex-col items-center justify-center gap-4 p-10 text-center">
        <h1 className="text-lg font-semibold">Battles</h1>
        <p className="text-sm text-muted-foreground">
          You are not connected to a lobby server.
        </p>
        <Link
          to="/lobby"
          className="inline-flex h-9 items-center rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          Go to the Lobby to connect
        </Link>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex flex-col gap-3 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Battles</h1>
          <span className="text-sm text-muted-foreground">({all.length})</span>
        </div>
        <Input
          value={filters.search}
          onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          placeholder="Search battles by title, map, host, or game"
        />
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Toggle
            label="Hide empty"
            on={filters.hideEmpty}
            onClick={() => setFilters((f) => ({ ...f, hideEmpty: !f.hideEmpty }))}
          />
          <Toggle
            label="Hide locked"
            on={filters.hideLockedPassworded}
            onClick={() =>
              setFilters((f) => ({
                ...f,
                hideLockedPassworded: !f.hideLockedPassworded,
              }))
            }
          />
          <Toggle
            label="Hide full"
            on={filters.hideFull}
            onClick={() => setFilters((f) => ({ ...f, hideFull: !f.hideFull }))}
          />
          <span className="ml-2 text-muted-foreground">Sort:</span>
          {SORTS.map((s) => (
            <Toggle
              key={s.key}
              label={
                s.key === filters.sortKey
                  ? `${s.label} ${filters.sortDir === "desc" ? "↓" : "↑"}`
                  : s.label
              }
              on={s.key === filters.sortKey}
              onClick={() =>
                setFilters((f) =>
                  f.sortKey === s.key
                    ? { ...f, sortDir: f.sortDir === "desc" ? "asc" : "desc" }
                    : { ...f, sortKey: s.key, sortDir: "desc" },
                )
              }
            />
          ))}
        </div>
      </header>

      {joinedBattle && (
        <div className="flex items-center justify-between gap-3 border-b border-border bg-primary/5 px-4 py-2 text-sm">
          <span>
            You are in <strong>{joinedBattle.title}</strong>.
          </span>
          <Button className="h-8 px-3" onClick={leave} aria-label="Leave battle">
            <LogOut className="mr-1 size-4" />
            Leave
          </Button>
        </div>
      )}

      {lastJoinError && (
        <div
          role="alert"
          className="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          Join failed: {lastJoinError}
        </div>
      )}

      <BattleList
        battles={shown}
        totalCount={all.length}
        joinedId={joinedId}
        canJoin={canJoin}
        onJoin={onJoin}
      />
    </main>
  );
}

function Toggle({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <Button
      className={`h-7 px-2 ${on ? "" : "opacity-60"}`}
      aria-pressed={on}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}
```

- [ ] **Step 2: Typecheck (now the route resolves)**

Run: `bun run typecheck`
Expected: PASS — the `./pages/BattlesPage` import from Task 4 now resolves and all components typecheck.

- [ ] **Step 3: Lint the frontend as CI does**

Run: `bunx biome ci .`
Expected: PASS. Fix any formatting/lint findings (biome owns formatting; run `bunx biome format --write .` if needed, then re-run `bunx biome ci .`).

- [ ] **Step 4: Run the full test suite**

Run: `bun run test`
Expected: PASS (battleList + store tests).

- [ ] **Step 5: Commit**

```bash
git add src/multiplayer/pages/BattlesPage.tsx
git commit -m "feat(multiplayer): battles page (browse + join in place)"
```

---

### Task 9: Manual smoke + final verification

**Files:** none (verification only).

- [ ] **Step 1: Confirm static checks are green**

Run each and confirm PASS:
- `bun run typecheck`
- `bunx biome ci .`
- `bun run test`

(Rust was not touched, so `cargo fmt`/`clippy` are unchanged — run them only if you want the full CI parity: `cargo fmt --all --check` and `cargo clippy --all-targets --all-features -- -D warnings`.)

- [ ] **Step 2: Launch the app for live smoke**

Run: `bun tauri dev`

- [ ] **Step 3: Verify against a live TASServer**

With a lobby connection open (from the Lobby page), navigate to **Multiplayer → Battles** and confirm:
- Battles list populates; opening/closing/updating a battle on the server reflects live (list re-renders without manual refresh).
- Occupancy `players/max` matches the server's count for a battle (validates the host-counting rule).
- Search narrows the list; each toggle (hide empty / locked / full) behaves; sort buttons reorder and flip direction.
- Join a public battle → the joined banner appears with the battle title, the row highlights, other Join buttons disable, and Leave returns to the browsing state.
- Join a passworded battle → the password popover opens from the Join button; a wrong password shows "Join failed: <reason>" from the server.

- [ ] **Step 4: Report results**

Report the smoke outcome honestly (what worked, what didn't). If occupancy is off by one against the live server, revisit `occupancy()` in `battleList.ts` — the host-counting assumption is the likely cause.

- [ ] **Step 5 (after user confirms): offer PR**

Per project CLAUDE.md, give the user the chance to test via `bun tauri dev` before any PR, and get approval on the PR description before creating it.

---

## Self-review notes

- **Spec coverage:** dedicated route/nav (Task 4); list with title/map/game/host/occupancy/spectators/lock (Tasks 6-7); search + hide-empty/locked/full + sort (Tasks 2, 8); join in place with a password popover + success banner + failure reason (Tasks 3, 5, 8); Leave (Task 8); not-connected/empty/joined/busy states (Tasks 7-8); vitest tests for pure logic + reducer (Tasks 1-3); manual smoke + full lint (Task 9). LobbyPage untouched; no Rust changes.
- **Deviation from spec:** the spec said "column-header sorting"; the list renders as cards, not a table, so sorting is a compact button group (Players/Map/Game) that toggles direction — same intent, fits the layout.
- **Deferred:** battle-room UI, battle chat, game launch (`mpBuildBattleConfig`), hosting — all explicitly out of scope.
