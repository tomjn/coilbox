# Multiplayer Battle Mod/Map Options Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Joined multiplayer battles launch with the host's mod options, map options, and start-pos type, and a battle-room drawer lets privileged users view and edit them (founder via lobby, autohost via `!bSet`) with a pending→confirm-on-echo model.

**Architecture:** Reuse the low-level `ModOptionField` renderer from the singleplayer `play` UI; a new battle-specific drawer + hook own the async state machine and founder-vs-autohost dispatch. Mod/map options live in a battle's `script_tags` (`game/modoptions/*`, `game/mapoptions/*`, `game/startpostype`) which the lobby already delivers via `SETSCRIPTTAGS` and mirrors to the frontend as `battle.scriptTags`. Backend `battle_to_config` translates those tags into the `play` `BattleConfig`. Edits are optimistic-pending, confirmed when the server echoes `SETSCRIPTTAGS`, and reverted on an 8s timeout (the authoritative revert signal for both edit paths).

**Tech Stack:** Rust (Tauri plugin), React + TypeScript, radix-ui `Dialog` (drawer), unitsync worker (option schemas), vitest, cargo test.

---

## File Structure

- **Modify** `crates/tauri-plugin-coilbox-multiplayer/src/lib.rs` — `battle_to_config`: translate `script_tags` into `startPosType` / `modOptions` / `mapOptions`. (Rust test in the existing `mod tests`.)
- **Create** `src/multiplayer/battle/battleOptions.ts` — pure helpers: script-tag key building, case-insensitive value lookup, raw-entry extraction, changed-count, and the pending-reconcile reducer.
- **Create** `src/multiplayer/battle/battleOptions.test.ts` — vitest for the pure helpers.
- **Create** `src/multiplayer/battle/useBattleOptions.ts` — hook owning the pending map + per-key 8s timers, reconciling against `scriptTags` echoes.
- **Create** `src/multiplayer/battle/BattleOptionsDrawer.tsx` — the always-mounted section: trigger button + radix `Dialog` drawer rendering mod/map option editors (or raw read-only fallback).
- **Modify** `src/play/pages/components/GameOptionsPanel.tsx` — `export` the `ModOptionField` function so the battle drawer can reuse it.
- **Modify** `src/multiplayer/battle/useBattleRoom.ts` — fetch map-info, expose `modOptionsSchema` / `mapOptionsSchema` / `canEditOptions` / `sendOption`, plus `gameMissing`/`mapMissing` already present.
- **Modify** `src/multiplayer/pages/BattleRoomPage.tsx` — mount `BattleOptionsDrawer` in the right `aside`.

Reused as-is: `ModOptionField`, `START_POS_OPTIONS` (from `GameOptionsPanel`), `OptionSelect`, `mpSetScriptTags`, `mpSayBattle`/`autohostSend`, `useUnitsyncGameInfo`, `useUnitsyncMapInfo`.

---

### Task 1: Backend — translate script tags into BattleConfig

**Files:**
- Modify: `crates/tauri-plugin-coilbox-multiplayer/src/lib.rs` (`battle_to_config` ~520-590; tests ~658-753)

- [ ] **Step 1: Write the failing test**

Add script tags to the shared `joined_state()` fixture, then a new test. In `mod tests`, extend `joined_state()` just before `state.battles.insert(7, battle);`:

```rust
        battle.script_tags.insert("game/startpostype".into(), "2".into());
        battle
            .script_tags
            .insert("game/modoptions/maxunits".into(), "2000".into());
        battle
            .script_tags
            .insert("game/mapoptions/waterlevel".into(), "-50".into());
```

Add a new test after `build_config_maps_join_case`:

```rust
    #[test]
    fn build_config_maps_script_tags_to_options() {
        let cfg = battle_to_config(&joined_state()).unwrap();
        assert_eq!(cfg["startPosType"], 2);
        assert_eq!(cfg["modOptions"]["maxunits"], "2000");
        assert_eq!(cfg["mapOptions"]["waterlevel"], "-50");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cargo test -p tauri-plugin-coilbox-multiplayer build_config_maps_script_tags_to_options`
Expected: FAIL — `startPosType` is `0` and `modOptions`/`mapOptions` are `Null` (assertion/index panic).

- [ ] **Step 3: Write the implementation**

Add a helper above `battle_to_config`:

```rust
/// Split a battle's opaque `script_tags` into the engine option maps the `play`
/// `BattleConfig` consumes. Keys are matched case-insensitively (SPADS lowercases
/// tag paths, but the engine is case-insensitive): `game/startpostype`,
/// `game/modoptions/<k>`, `game/mapoptions/<k>`. Anything else is ignored.
fn split_script_tags(tags: &BTreeMap<String, String>) -> (u8, BTreeMap<String, String>, BTreeMap<String, String>) {
    const MOD: &str = "game/modoptions/";
    const MAP: &str = "game/mapoptions/";
    let mut start_pos_type = 0u8;
    let mut mod_opts = BTreeMap::new();
    let mut map_opts = BTreeMap::new();
    for (k, v) in tags {
        let lk = k.to_ascii_lowercase();
        if lk == "game/startpostype" {
            start_pos_type = v.trim().parse().unwrap_or(0);
        } else if let Some(name) = lk.strip_prefix(MOD) {
            mod_opts.insert(name.to_string(), v.clone());
        } else if let Some(name) = lk.strip_prefix(MAP) {
            map_opts.insert(name.to_string(), v.clone());
        }
    }
    (start_pos_type, mod_opts, map_opts)
}
```

In `battle_to_config`, just before the final `Ok(json!({ ... }))`, add:

```rust
    let (start_pos_type, mod_options, map_options) = split_script_tags(&battle.script_tags);
```

Then in the returned `json!`, replace the `"startPosType": 0,` line with:

```rust
        "startPosType": start_pos_type,
        "modOptions": mod_options,
        "mapOptions": map_options,
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test -p tauri-plugin-coilbox-multiplayer`
Expected: PASS — both `build_config_maps_join_case` and `build_config_maps_script_tags_to_options` green (the first still passes: its fixture now carries tags but it does not assert their absence).

- [ ] **Step 5: Commit**

```bash
git add crates/tauri-plugin-coilbox-multiplayer/src/lib.rs
git commit -m "feat(multiplayer): apply battle script-tag mod/map options + startpostype on launch"
```

---

### Task 2: Frontend pure helpers + pending reconciler

**Files:**
- Create: `src/multiplayer/battle/battleOptions.ts`
- Test: `src/multiplayer/battle/battleOptions.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import {
  changedCount,
  displayedValue,
  optionValue,
  rawOptionEntries,
  reconcilePending,
  scriptTagKey,
} from "./battleOptions";

const opt = (over: Partial<ConfigOption> = {}): ConfigOption => ({
  key: "maxunits",
  name: "Max units",
  default: "1000",
  type: "number",
  ...over,
});

describe("battleOptions", () => {
  it("builds scoped script-tag keys", () => {
    expect(scriptTagKey("mod", "maxunits")).toBe("game/modoptions/maxunits");
    expect(scriptTagKey("map", "waterlevel")).toBe("game/mapoptions/waterlevel");
  });

  it("resolves option values case-insensitively", () => {
    const tags = { "GAME/MODOPTIONS/MaxUnits": "2000" };
    expect(optionValue(tags, "mod", "maxunits")).toBe("2000");
    expect(optionValue(tags, "mod", "missing")).toBeUndefined();
  });

  it("counts options changed from default", () => {
    const tags = { "game/modoptions/maxunits": "2000" };
    expect(changedCount([opt()], tags, "mod")).toBe(1);
    expect(changedCount([opt()], { "game/modoptions/maxunits": "1000" }, "mod")).toBe(0);
  });

  it("extracts raw entries for a scope", () => {
    const tags = {
      "game/modoptions/a": "1",
      "game/mapoptions/b": "2",
      "game/startpostype": "2",
    };
    expect(rawOptionEntries(tags, "mod")).toEqual([{ key: "a", value: "1" }]);
  });

  it("keeps pending until an echo changes the confirmed value", () => {
    const pending = { "game/modoptions/maxunits": { target: "2000", prev: "1000" } };
    // No echo yet: confirmed still equals prev -> stays pending.
    expect(
      reconcilePending(pending, { "game/modoptions/maxunits": "1000" }),
    ).toEqual(pending);
    // Echo arrives (value changed): resolved -> dropped.
    expect(
      reconcilePending(pending, { "game/modoptions/maxunits": "2000" }),
    ).toEqual({});
  });

  it("shows the pending target over the confirmed value", () => {
    const pending = { "game/modoptions/maxunits": { target: "2000", prev: "1000" } };
    const tags = { "game/modoptions/maxunits": "1000" };
    expect(displayedValue(pending, tags, "mod", "maxunits")).toBe("2000");
    expect(displayedValue({}, tags, "mod", "maxunits")).toBe("1000");
    expect(displayedValue({}, {}, "mod", "maxunits")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run test src/multiplayer/battle/battleOptions.test.ts`
Expected: FAIL — cannot resolve `./battleOptions` (module does not exist).

- [ ] **Step 3: Write the implementation**

```ts
import type { ConfigOption } from "@/content/bindings";

/** Engine script-tag prefixes for the two option scopes + the start-pos tag. */
export const MODOPT_PREFIX = "game/modoptions/";
export const MAPOPT_PREFIX = "game/mapoptions/";
export const STARTPOSTYPE_KEY = "game/startpostype";

export type OptionScope = "mod" | "map";

const prefixFor = (scope: OptionScope) =>
  scope === "mod" ? MODOPT_PREFIX : MAPOPT_PREFIX;

/** The full script-tag key for a scoped option, e.g. `game/modoptions/maxunits`. */
export const scriptTagKey = (scope: OptionScope, key: string) =>
  `${prefixFor(scope)}${key}`;

/** Case-insensitive lookup of a script tag (SPADS lowercases; engine is CI). */
export function lookupTag(
  scriptTags: Record<string, string>,
  tagKey: string,
): string | undefined {
  const want = tagKey.toLowerCase();
  for (const [k, v] of Object.entries(scriptTags)) {
    if (k.toLowerCase() === want) return v;
  }
  return undefined;
}

/** The current value set for a scoped option, or undefined if unset. */
export const optionValue = (
  scriptTags: Record<string, string>,
  scope: OptionScope,
  key: string,
): string | undefined => lookupTag(scriptTags, scriptTagKey(scope, key));

/** Raw `{ key, value }` pairs for a scope — the read-only fallback when we have
 * no schema (content not installed) but the host has set options. */
export function rawOptionEntries(
  scriptTags: Record<string, string>,
  scope: OptionScope,
): { key: string; value: string }[] {
  const prefix = prefixFor(scope);
  return Object.entries(scriptTags)
    .filter(([k]) => k.toLowerCase().startsWith(prefix))
    .map(([k, value]) => ({ key: k.slice(prefix.length), value }));
}

/** How many of `options` are set away from their default. */
export function changedCount(
  options: ConfigOption[],
  scriptTags: Record<string, string>,
  scope: OptionScope,
): number {
  return options.filter((o) => {
    const v = optionValue(scriptTags, scope, o.key);
    return v !== undefined && v !== (o.default ?? "");
  }).length;
}

/** Whether the local user may edit options: they founded the battle, or the host
 * is an autohost bot (we send `!bSet`; the autohost still enforces privilege). */
export const canEditBattleOptions = (isFounder: boolean, hostIsBot: boolean) =>
  isFounder || hostIsBot;

/** One in-flight edit: the value we asked for and the confirmed value at the time. */
export interface PendingEdit {
  target: string;
  prev: string;
}
/** Pending edits keyed by lowercased script-tag key. */
export type PendingMap = Record<string, PendingEdit>;

/** Drop pending edits the server has echoed (confirmed value moved off `prev`). */
export function reconcilePending(
  pending: PendingMap,
  scriptTags: Record<string, string>,
): PendingMap {
  const next: PendingMap = {};
  for (const [tagKey, edit] of Object.entries(pending)) {
    const confirmed = lookupTag(scriptTags, tagKey) ?? "";
    if (confirmed === edit.prev) next[tagKey] = edit; // no echo yet
  }
  return next;
}

/** The value to display for a scoped option: the pending target if in flight,
 * else the confirmed value, else undefined (so the field shows its default). */
export function displayedValue(
  pending: PendingMap,
  scriptTags: Record<string, string>,
  scope: OptionScope,
  key: string,
): string | undefined {
  const tagKey = scriptTagKey(scope, key).toLowerCase();
  const p = pending[tagKey];
  if (p) return p.target;
  return optionValue(scriptTags, scope, key);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run test src/multiplayer/battle/battleOptions.test.ts`
Expected: PASS — all cases green.

- [ ] **Step 5: Commit**

```bash
git add src/multiplayer/battle/battleOptions.ts src/multiplayer/battle/battleOptions.test.ts
git commit -m "feat(multiplayer): pure helpers for battle option resolution + pending reconcile"
```

---

### Task 3: Export ModOptionField for reuse

**Files:**
- Modify: `src/play/pages/components/GameOptionsPanel.tsx:122`

- [ ] **Step 1: Add the export**

Change the declaration:

```ts
/** Render one mod option as the control its type calls for. */
function ModOptionField({
```

to:

```ts
/** Render one mod option as the control its type calls for. */
export function ModOptionField({
```

(Leave the JSDoc and body untouched. `GameOptionsPanel` in the same file keeps using it; adding `export` is non-breaking.)

- [ ] **Step 2: Verify it still typechecks**

Run: `bun run typecheck`
Expected: PASS — no new errors.

- [ ] **Step 3: Commit**

```bash
git add src/play/pages/components/GameOptionsPanel.tsx
git commit -m "refactor(play): export ModOptionField for reuse in multiplayer"
```

---

### Task 4: Pending/echo/timeout hook

**Files:**
- Create: `src/multiplayer/battle/useBattleOptions.ts`

- [ ] **Step 1: Write the hook**

There is no unit test here — the pure reconcile logic is already covered in Task 2; this hook only wires React state and timers. Verified live in Task 7/8.

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { lookupTag, type PendingMap, reconcilePending } from "./battleOptions";

/** How long to wait for the server to echo an edit before reverting the control. */
const ECHO_TIMEOUT_MS = 8000;

/**
 * Owns the optimistic-pending state for battle option edits. On `setOption` it
 * records the target value (and the confirmed value at that instant), fires the
 * wire send, and starts an 8s timer. Pending entries clear when the server echoes
 * the change into `scriptTags` (confirmed value moves off `prev`) or when the
 * timer fires (covers rejected / insufficient-privilege edits — the only revert
 * signal on the founder path, which has no per-tag reject reply).
 *
 * `send(tagKey, spadsName, value)` performs the actual dispatch (founder
 * `mpSetScriptTags` vs autohost `!bSet`); this hook is agnostic to which.
 */
export function useBattleOptions(
  scriptTags: Record<string, string>,
  send: (tagKey: string, spadsName: string, value: string) => void,
) {
  const [pending, setPending] = useState<PendingMap>({});
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const clearTimer = (lower: string) => {
    const t = timers.current[lower];
    if (t) {
      clearTimeout(t);
      delete timers.current[lower];
    }
  };

  // Reconcile against server echoes whenever the confirmed tags change.
  useEffect(() => {
    setPending((prev) => {
      const next = reconcilePending(prev, scriptTags);
      for (const key of Object.keys(prev)) if (!next[key]) clearTimer(key);
      return next;
    });
  }, [scriptTags]);

  const setOption = useCallback(
    (tagKey: string, spadsName: string, value: string) => {
      const lower = tagKey.toLowerCase();
      const prev = lookupTag(scriptTags, tagKey) ?? "";
      setPending((p) => ({ ...p, [lower]: { target: value, prev } }));
      clearTimer(lower);
      timers.current[lower] = setTimeout(() => {
        setPending(({ [lower]: _dropped, ...rest }) => rest);
        delete timers.current[lower];
      }, ECHO_TIMEOUT_MS);
      send(tagKey, spadsName, value);
    },
    [scriptTags, send],
  );

  // Clear any outstanding timers on unmount.
  useEffect(() => {
    const map = timers.current;
    return () => {
      for (const t of Object.values(map)) clearTimeout(t);
    };
  }, []);

  return { pending, setOption };
}
```

- [ ] **Step 2: Verify it typechecks**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/multiplayer/battle/useBattleOptions.ts
git commit -m "feat(multiplayer): pending/echo/timeout hook for battle option edits"
```

---

### Task 5: Extend useBattleRoom with option schemas + dispatch

**Files:**
- Modify: `src/multiplayer/battle/useBattleRoom.ts`

- [ ] **Step 1: Add imports**

At the top, extend the `@/content/config` import to include `useUnitsyncMapInfo`, and add the option types + helper + binding:

```ts
import {
  invalidateMapPreview,
  useUnitsyncGameInfo,
  useUnitsyncMapInfo,
  useUnitsyncScan,
} from "@/content/config";
```

Add to the existing `@/content/bindings` type import (currently `GameItem, MapItem, Side`):

```ts
import type { ConfigOption, GameItem, MapItem, Side } from "@/content/bindings";
```

Add to the `../bindings` value import (currently `mpLeaveBattle, mpSayBattle, mpSetBattleStatus`):

```ts
import {
  mpLeaveBattle,
  mpSayBattle,
  mpSetBattleStatus,
  mpSetScriptTags,
} from "../bindings";
```

Add to the `./config`... — no, the helper lives in `./battleOptions`:

```ts
import { canEditBattleOptions, scriptTagKey } from "./battleOptions";
```

- [ ] **Step 2: Add fields to the `BattleRoomView` interface**

Insert after the `sides: Side[];` line:

```ts
  /** Mod-option schema from the game archive (empty if the game isn't installed). */
  modOptionsSchema: ConfigOption[];
  /** Map-option schema from the map archive (empty if the map isn't installed). */
  mapOptionsSchema: ConfigOption[];
  /** Whether the local user may edit options (founder, or the host is an autohost). */
  canEditOptions: boolean;
  /** Dispatch one option edit: founder → SETSCRIPTTAGS, autohost → `!bSet`. */
  sendOption: (tagKey: string, spadsName: string, value: string) => void;
```

- [ ] **Step 3: Compute the values in the hook body**

After the existing `const sides = gameInfo.info?.sides ?? [];` line, add:

```ts
  const mapInfo = useUnitsyncMapInfo(enginePath, dataDir, battle?.map);
  const modOptionsSchema = gameInfo.info?.options ?? [];
  const mapOptionsSchema = mapInfo.info?.options ?? [];
  const hostIsBot = !!battle && !!state?.users[battle.host]?.status.bot;
  const canEditOptions = canEditBattleOptions(isFounder, hostIsBot);
```

After the `autohostSend` callback (around line 183), add the dispatcher:

```ts
  // Route one option edit. Founder: set the script tag directly. Autohost battle:
  // send `!bSet <name> <value>`; the autohost validates + echoes SETSCRIPTTAGS.
  const sendOption = useCallback(
    (tagKey: string, spadsName: string, value: string) => {
      if (!activeKey) return;
      if (isFounder) {
        mpSetScriptTags({ serverKey: activeKey, tags: { [tagKey]: value } }).catch(
          () => {},
        );
      } else {
        autohostSend(`!bSet ${spadsName} ${value}`);
      }
    },
    [activeKey, isFounder, autohostSend],
  );
```

- [ ] **Step 4: Return the new fields**

In the returned object, after `sides,` add:

```ts
    modOptionsSchema,
    mapOptionsSchema,
    canEditOptions,
    sendOption,
```

- [ ] **Step 5: Verify it typechecks**

Run: `bun run typecheck`
Expected: PASS. (`scriptTagKey` is imported for use by the drawer via the view; if the linter flags it unused here, drop it from this file's import — the drawer imports it directly. See Task 6.)

Note: remove `scriptTagKey` from the Step 1 import if unused in this file — only `canEditBattleOptions` is used here. Corrected import:

```ts
import { canEditBattleOptions } from "./battleOptions";
```

- [ ] **Step 6: Commit**

```bash
git add src/multiplayer/battle/useBattleRoom.ts
git commit -m "feat(multiplayer): expose option schemas + edit dispatch from useBattleRoom"
```

---

### Task 6: BattleOptionsDrawer component

**Files:**
- Create: `src/multiplayer/battle/BattleOptionsDrawer.tsx`

- [ ] **Step 1: Write the component**

```tsx
import { Button } from "@picoframe/frame";
import { Settings2, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";
import type { ConfigOption } from "@/content/bindings";
import {
  ModOptionField,
  START_POS_OPTIONS,
} from "@/play/pages/components/GameOptionsPanel";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { Battle } from "../bindings";
import {
  changedCount,
  displayedValue,
  type OptionScope,
  type PendingMap,
  rawOptionEntries,
  scriptTagKey,
  STARTPOSTYPE_KEY,
} from "./battleOptions";
import { useBattleOptions } from "./useBattleOptions";

/**
 * The battle-room options surface: an always-mounted trigger button plus a
 * right-hand slide-in drawer (radix `Dialog`, matching `MapPickerDrawer`) that
 * renders the game's mod options and the map's map options. The host/founder gets
 * editable controls; everyone else sees them read-only. When the schema is
 * unavailable (content not installed) but the host has set options, we show the
 * raw `key=value` pairs instead of pretending we can render them typed.
 */
export function BattleOptionsDrawer({
  battle,
  modOptionsSchema,
  mapOptionsSchema,
  canEdit,
  gameMissing,
  mapMissing,
  sendOption,
}: {
  battle: Battle;
  modOptionsSchema: ConfigOption[];
  mapOptionsSchema: ConfigOption[];
  canEdit: boolean;
  gameMissing: boolean;
  mapMissing: boolean;
  sendOption: (tagKey: string, spadsName: string, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const { pending, setOption } = useBattleOptions(battle.scriptTags, sendOption);

  const changed =
    changedCount(modOptionsSchema, battle.scriptTags, "mod") +
    changedCount(mapOptionsSchema, battle.scriptTags, "map");

  const startPos =
    displayedValue(pending, battle.scriptTags, "mod", "__startpostype__") ??
    // startpostype is not scoped; resolve it explicitly.
    battle.scriptTags[STARTPOSTYPE_KEY] ??
    "0";

  return (
    <>
      <div className="rounded-lg border border-border/50 bg-card">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left hover:bg-muted/30"
        >
          <span className="flex items-center gap-2 text-sm font-semibold">
            <Settings2 className="size-4 text-muted-foreground" />
            Battle options
          </span>
          <span className="text-xs text-muted-foreground">
            {changed > 0 ? `${changed} changed` : "defaults"}
          </span>
        </button>
      </div>

      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content className="fixed inset-y-0 right-0 z-50 flex w-[480px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right">
            <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
              <DialogPrimitive.Title className="text-base font-semibold">
                Battle options
              </DialogPrimitive.Title>
              <DialogPrimitive.Close asChild>
                <Button variant="ghost" size="icon" aria-label="Close">
                  <X className="size-4" />
                </Button>
              </DialogPrimitive.Close>
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-4">
              {!canEdit && (
                <p className="text-xs text-muted-foreground">
                  Read-only — only the host can change battle options.
                </p>
              )}

              <section>
                <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
                  Start positions
                </div>
                <OptionSelect
                  value={startPos}
                  disabled={!canEdit}
                  options={START_POS_OPTIONS}
                  onValueChange={(v) =>
                    setOption(STARTPOSTYPE_KEY, "startpostype", v)
                  }
                />
              </section>

              <OptionSection
                title="Mod options"
                scope="mod"
                schema={modOptionsSchema}
                missing={gameMissing}
                battle={battle}
                pending={pending}
                canEdit={canEdit}
                setOption={setOption}
              />
              <OptionSection
                title="Map options"
                scope="map"
                schema={mapOptionsSchema}
                missing={mapMissing}
                battle={battle}
                pending={pending}
                canEdit={canEdit}
                setOption={setOption}
              />
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}

/** One scope's block: typed editors from the schema, or a raw read-only fallback
 * when the schema is unavailable (content not installed) but options are set. */
function OptionSection({
  title,
  scope,
  schema,
  missing,
  battle,
  pending,
  canEdit,
  setOption,
}: {
  title: string;
  scope: OptionScope;
  schema: ConfigOption[];
  missing: boolean;
  battle: Battle;
  pending: PendingMap;
  canEdit: boolean;
  setOption: (tagKey: string, spadsName: string, value: string) => void;
}) {
  const raw = rawOptionEntries(battle.scriptTags, scope);

  return (
    <section>
      <div className="mb-2 text-[11px] uppercase tracking-wide text-muted-foreground">
        {title}
      </div>

      {schema.length > 0 ? (
        <div className="grid grid-cols-1 gap-x-4 gap-y-3">
          {schema.map((o) => (
            <ModOptionField
              key={o.key}
              option={o}
              value={displayedValue(pending, battle.scriptTags, scope, o.key)}
              disabled={!canEdit}
              onChange={(v) => setOption(scriptTagKey(scope, o.key), o.key, v)}
            />
          ))}
        </div>
      ) : missing && raw.length > 0 ? (
        <div className="space-y-1">
          <p className="text-xs text-muted-foreground">
            Content not installed — showing raw values.
          </p>
          <ul className="space-y-1 text-sm">
            {raw.map((e) => (
              <li key={e.key} className="flex justify-between gap-3">
                <span className="truncate text-muted-foreground">{e.key}</span>
                <span className="font-mono">{e.value}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">No options.</p>
      )}
    </section>
  );
}
```

Note: the `startPos` fallback above references a non-scoped tag. Simplify it — replace the `startPos` block with a direct helper that reads the pending or confirmed startpostype:

```tsx
  const startPosPending = pending[STARTPOSTYPE_KEY.toLowerCase()]?.target;
  const startPos =
    startPosPending ?? battle.scriptTags[STARTPOSTYPE_KEY] ?? "0";
```

(Use this instead of the `displayedValue(... "__startpostype__" ...)` version — startpostype is not a scoped mod/map option.)

- [ ] **Step 2: Verify it typechecks**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/multiplayer/battle/BattleOptionsDrawer.tsx
git commit -m "feat(multiplayer): battle options drawer (mod/map editors + raw fallback)"
```

---

### Task 7: Wire the drawer into the battle room

**Files:**
- Modify: `src/multiplayer/pages/BattleRoomPage.tsx`

- [ ] **Step 1: Import the drawer**

Add to the imports (alphabetical with the other `../battle/*`):

```ts
import { BattleOptionsDrawer } from "../battle/BattleOptionsDrawer";
```

- [ ] **Step 2: Mount it in the aside**

In the right `aside`, immediately after the `<StartPosOptions ... />` block (before the `{room.gameMissing && ...}` `MissingContentCard`), add:

```tsx
          <BattleOptionsDrawer
            battle={battle}
            modOptionsSchema={room.modOptionsSchema}
            mapOptionsSchema={room.mapOptionsSchema}
            canEdit={room.canEditOptions}
            gameMissing={room.gameMissing}
            mapMissing={room.mapMissing}
            sendOption={room.sendOption}
          />
```

- [ ] **Step 3: Verify build + lint**

Run: `bun run typecheck`
Expected: PASS.

Run: `bunx biome ci .`
Expected: PASS (no lint/format errors in the new files).

- [ ] **Step 4: Commit**

```bash
git add src/multiplayer/pages/BattleRoomPage.tsx
git commit -m "feat(multiplayer): mount battle options drawer in the battle room"
```

---

### Task 8: Manual verification

**Files:** none (runtime verification).

- [ ] **Step 1: Launch the app**

Run: `bun tauri dev`

- [ ] **Step 2: Join a battle and open the drawer**

Connect to a lobby server, join an active autohost (SPADS) battle, and click **Battle options** in the right column. Expected:
- Mod options and map options render as typed controls (checkboxes/selects/number/text) when the game+map are installed.
- Current values reflect the host's `SETSCRIPTTAGS` (change something via the autohost and watch it update).
- If you are not the host, the note "Read-only — only the host can change battle options" shows and controls are disabled.

- [ ] **Step 3: Edit an option (host / boss)**

As the founder of a coilbox-hosted battle (or a privileged user in an autohost battle), change a mod option. Expected: the control shows the new value immediately (pending), and stays once the server echoes `SETSCRIPTTAGS`. If the autohost rejects it (e.g. not in the battle preset), the control reverts within ~8s.

- [ ] **Step 4: Content-missing fallback**

Join a battle whose game/map you don't have installed. Expected: the corresponding section shows "Content not installed — showing raw values." with the raw `key=value` pairs (if the host has set any), and no crash.

- [ ] **Step 5: Launch applies options**

Let the match start (autohost goes in-game). Expected: the engine launches with the host's start-pos type and options (verify start positions match the battle's mode rather than always "Fixed").

---

### Task 9: Full lint suite + wrap-up

**Files:** none.

- [ ] **Step 1: Run the full CI-equivalent checks**

```bash
cargo fmt --all --check
cargo clippy --all-targets --all-features -- -D warnings
bunx biome ci .
bun run typecheck
bun run test
```

Expected: all PASS. Fix any findings (run `cargo fmt --all` for formatting).

- [ ] **Step 2: Confirm nothing else regressed**

Run: `git status` and review the diff is limited to the files in this plan.

- [ ] **Step 3: Final commit if fixes were needed**

```bash
git add -u
git commit -m "chore(multiplayer): lint/format pass for battle options"
```

(Skip if Step 1 was already clean.)

---

## Self-Review Notes

- **Spec coverage:** launch correctness (Task 1), schema source incl. map-info fetch (Task 5), drawer UI + raw fallback (Task 6/7), founder vs autohost dispatch (Task 5 `sendOption`), pending/echo/timeout (Task 2 reconcile + Task 4 hook), start-pos-type editing (Task 6). All spec sections map to a task.
- **Type consistency:** `sendOption(tagKey, spadsName, value)` and `setOption(tagKey, spadsName, value)` share one signature across Tasks 4–7; `PendingMap`/`PendingEdit`/`displayedValue`/`reconcilePending` defined in Task 2 and consumed unchanged in Tasks 4/6; `modOptionsSchema`/`mapOptionsSchema`/`canEditOptions` defined in Task 5's interface and consumed in Task 7.
- **Serde contract (verified):** `play::BattleConfig` is `#[serde(rename_all = "camelCase")]` with `start_pos_type: u8`, `mod_options`/`map_options: BTreeMap<String,String>` (each `#[serde(default)]`), so the camelCase JSON keys `startPosType`/`modOptions`/`mapOptions` emitted in Task 1 Step 3 deserialize correctly.
