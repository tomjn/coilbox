# Unit morph targets implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read what a unit morphs or upgrades into, group a unit's stages as one unit in coilbox and in the hub, and send the edges with the game's facts.

**Architecture:** The unitsync worker's Lua shim gains a second relationship beside `buildoptions`, read from two places at once because games arrange morph two ways: `customparams` on the def (Zero-K) and a config file a gadget loads (Metal Factions, Spring 1944, Expand and Exterminate, SplinterFaction). Each edge carries the conditions the game wrote as free JSON, because four games spell them four ways. The graph helpers that group a unit's stages are written once in `src/content` and vendored byte identical into the hub, so both sides group the same way by construction rather than by agreement.

**Tech Stack:** Rust (unitsync worker, Tauri plugins), Lua 5.1 (the shim, tested under `mlua`), TypeScript with vitest (coilbox app), Next.js with bun test (hub), PL/pgSQL and Supabase migrations (hub storage).

**Spec:** https://github.com/tomjn/coilbox/issues/2063 and https://github.com/tomjn/coilbox-hub/issues/295. Read both. The coilbox issue carries the archive measurements this plan builds on.

## Global constraints

- Absent means unread, never zero. A unit with no morph carries an empty list, and a dataset line written before the column existed carries no claim at all. `shared/unitdef-stats.json` writes the rule down.
- Def keys are lowercased everywhere: the shim lowercases both the source key and the `into` target, so the morph graph's edges match the build graph's node names.
- Conditions are free JSON, keyed however the game keyed them, lowercased. Nothing in Rust, TypeScript or SQL names an individual condition.
- The largest morph JSON measured on a real archive is 1586 bytes, on Metal Factions' `gear_commander`. The cap is 8192, the same number `MAX_STATS_JSON` already uses on both sides, which leaves five times the widest thing anyone has seen.
- Morph edges are a graph. A unit morphs into two things, a game loops back to where it started, and every walk here is cycle guarded.
- The hub accepts the field before coilbox sends it. `parseGameFactsBody` refuses an unknown field on a unit entry rather than dropping it, so sending first would refuse every unit of every game. Phase 3 ships before phase 4.
- Commit messages are plain imperative sentences in this repo's house style, no `feat:` prefixes.
- Five steps describe a change to a file this plan did not read: the picker in Task 4, the two tree views in Task 5, and the three hub readers in Tasks 10, 11 and 12. They name the function to change and what it must do rather than the lines to type, because inventing the surrounding code would be worse than reading it. Read the file first, then follow the step.
- Before any PR: `cargo fmt --all --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `bunx biome ci .` and `bun run typecheck` in coilbox. In the hub: `bun test`, `bun run lint`, `bun run typecheck`.

## File structure

Phase 1, extraction (coilbox):
- Modify `crates/coilbox-unitsync-worker/src/dataset.rs` - the Lua shim gains the morph block and a fourteenth column, `parse_dataset_units` gains `parse_morph_targets`, the test module gains a path-aware `VFS.Include` stub.
- Modify `crates/coilbox-unitsync-worker/src/model.rs` - `UnitDatasetEntry.morph_targets`.
- Modify `crates/coilbox-unitsync-worker/src/infocache.rs` - `INFO_CACHE_VERSION` bump, because a cached line written by the old shim has no column to read.
- Modify `shared/unitdef-stats.json` - what a morph entry holds and where it was read from.

Phase 2, the app (coilbox):
- Modify `src/content/bindings.ts` - `morphTargets` on `UnitDatasetEntry`.
- Create `src/content/morphGraph.ts` - the whole grouping rule, pure functions over the dataset. Its own file rather than more of `buildTree.ts`, because it is vendored into the hub as a unit and a reviewer of either repo should be able to hold it in one screen.
- Create `src/content/morphGraph.test.ts`.
- Modify `src/content/techForest.ts` and `src/content/pages/components/UnitPicker.tsx` - one row per group.
- Modify `src/content/pages/components/BuildTreeDrawer.tsx` and `src/content/pages/components/FactionBuildList.tsx` - one node per group.

Phase 3, the hub accepts and stores:
- Modify `lib/api/gameFacts.ts` - `morphTargets` on the unit entry, validated and capped.
- Modify `lib/games/submit.ts` - the digest covers it.
- Create `supabase/migrations/<stamp>_game_unit_morph.sql` - two columns and a new `submit_game_facts`.
- Modify `supabase/tests/game_submission.test.sql`.

Phase 4, coilbox sends:
- Modify `crates/tauri-plugin-coilbox-hub/src/games.rs`, `src/hub/games/facts.ts`, `src/hub/games/factsSweep.ts`.

Phase 5, the hub shows one unit (closes hub#295):
- Modify `scripts/sync-vendor.ts` to vendor `morphGraph.ts`, then `lib/games/units.ts`, `app/games/[shortname]/units/...` and `components/GameTree.tsx`.

---

### Task 1: The worker reads morph targets

**Files:**
- Modify: `crates/coilbox-unitsync-worker/src/dataset.rs` (shim constant, `parse_dataset_units:519`, tests from `:974`)
- Modify: `crates/coilbox-unitsync-worker/src/model.rs:531-600`
- Modify: `crates/coilbox-unitsync-worker/src/infocache.rs:43`
- Modify: `shared/unitdef-stats.json`

**Interfaces:**
- Produces: `UnitDatasetEntry.morph_targets: Vec<serde_json::Map<String, serde_json::Value>>`, serialised as `morphTargets`, skipped when empty. Each map holds `into` (a lowercased def key, always present) plus whatever conditions the game declared, lowercased.
- Produces: the dataset line's fourteenth tab-separated column, a JSON array, always written by this shim.

- [ ] **Step 1: Write the failing tests**

Add to the test module in `dataset.rs`. The first replaces the existing `extract` helper with a path-aware one, so keep the old name working for the tests that already call it:

```rust
    /// Run [`UNIT_DATASET_SHIM_SCRIPT`] over a fixture `defs` table, and
    /// optionally one morph config mounted at `path`, in stock Lua 5.1.
    ///
    /// `VFS.Include` answers by path and raises on anything else, the way the
    /// real one does: the shim asks for two config paths that most games do
    /// not have, and a stub that answered every path would hide a missing
    /// `pcall`.
    fn extract_with_config(
        defs_lua: &str,
        path: &str,
        config_lua: &str,
    ) -> Vec<UnitDatasetEntry> {
        let lua = mlua::Lua::new();
        let script = format!(
            "VFS = {{ Include = function(name)\n\
               if name == 'gamedata/defs.lua' then return {defs_lua} end\n\
               if name == '{path}' then return {config_lua} end\n\
               error(\"Include() file missing '\" .. name .. \"'\")\n\
             end }}\n\
             __cb_chunk = function(s) return s end\n\
             return (function()\n{UNIT_DATASET_SHIM_SCRIPT}\nend)()"
        );
        let raw: String = lua
            .load(script)
            .eval()
            .expect("the shim script did not run");
        parse_dataset_units(&raw)
    }

    fn extract(defs_lua: &str) -> Vec<UnitDatasetEntry> {
        extract_with_config(defs_lua, "", "nil")
    }

    /// A commander whose two stages live in the config shape Metal Factions,
    /// SplinterFaction and Zero-K's own generated half all write: a list of
    /// entries per source unit.
    const A_MORPH_CONFIG: &str = r#"{
      fedcommander = {
        {
          into = 'fedcommander_up1',
          time = 3,
          research = 150,
          require = 'tech1',
          cmdname = 'Tech 1 Upgrade',
        },
      },
    }"#;

    /// The shape Spring 1944 writes: one entry per source unit, not a list.
    const A_SINGLE_MORPH_CONFIG: &str = r#"{
      swepontoontruck = { into = 'sweboatyard', time = 5, metal = 0 },
    }"#;

    const TWO_COMMANDERS: &str = r#"{
      unitdefs = {
        fedcommander = { name = 'Commander' },
        fedcommander_up1 = { name = 'Commander Tech 1' },
      },
    }"#;

    #[test]
    fn a_morph_config_names_what_a_unit_turns_into() {
        let units = extract_with_config(
            TWO_COMMANDERS,
            "luarules/configs/morph_defs.lua",
            A_MORPH_CONFIG,
        );
        let com = units.iter().find(|u| u.name == "fedcommander").unwrap();
        assert_eq!(com.morph_targets.len(), 1);
        assert_eq!(com.morph_targets[0]["into"], serde_json::json!("fedcommander_up1"));
    }

    #[test]
    fn a_morph_carries_the_conditions_the_game_wrote() {
        let units = extract_with_config(
            TWO_COMMANDERS,
            "luarules/configs/morph_defs.lua",
            A_MORPH_CONFIG,
        );
        let entry = &units
            .iter()
            .find(|u| u.name == "fedcommander")
            .unwrap()
            .morph_targets[0];
        assert_eq!(entry["research"], serde_json::json!(150));
        assert_eq!(entry["require"], serde_json::json!("tech1"));
        assert_eq!(entry["time"], serde_json::json!(3));
        assert_eq!(entry["cmdname"], serde_json::json!("Tech 1 Upgrade"));
    }

    #[test]
    fn a_config_that_writes_one_entry_rather_than_a_list_is_read_too() {
        let defs = r#"{
          unitdefs = {
            swepontoontruck = { name = 'Pontoon Truck' },
            sweboatyard = { name = 'Boatyard' },
          },
        }"#;
        let units = extract_with_config(
            defs,
            "luarules/configs/morph_defs.lua",
            A_SINGLE_MORPH_CONFIG,
        );
        let truck = units.iter().find(|u| u.name == "swepontoontruck").unwrap();
        assert_eq!(truck.morph_targets.len(), 1);
        assert_eq!(truck.morph_targets[0]["into"], serde_json::json!("sweboatyard"));
    }

    #[test]
    fn a_def_that_names_its_own_morph_in_customparams_is_read() {
        let defs = r#"{
          unitdefs = {
            armcom0 = {
              name = 'Commander',
              customparams = { morphto = 'ARMCOM1', morphtime = 10, level = 0 },
            },
            armcom1 = { name = 'Commander' },
          },
        }"#;
        let units = extract(defs);
        let com = units.iter().find(|u| u.name == "armcom0").unwrap();
        assert_eq!(com.morph_targets[0]["into"], serde_json::json!("armcom1"));
        assert_eq!(com.morph_targets[0]["morphtime"], serde_json::json!(10));
        assert_eq!(com.morph_targets[0]["level"], serde_json::json!(0));
    }

    #[test]
    fn a_def_that_lists_several_morphs_in_customparams_gets_all_of_them() {
        let defs = r#"{
          unitdefs = {
            factory = {
              name = 'Factory',
              customparams = {
                morphto_1 = 'gunyard',
                morphcost_1 = 250,
                morphto_2 = 'airyard',
                morphcost_2 = 400,
              },
            },
            gunyard = { name = 'Gun Yard' },
            airyard = { name = 'Air Yard' },
          },
        }"#;
        let units = extract(defs);
        let factory = units.iter().find(|u| u.name == "factory").unwrap();
        let into: Vec<&serde_json::Value> =
            factory.morph_targets.iter().map(|m| &m["into"]).collect();
        assert_eq!(
            into,
            vec![&serde_json::json!("airyard"), &serde_json::json!("gunyard")]
        );
    }

    #[test]
    fn a_unit_that_morphs_nowhere_claims_nothing() {
        let units = extract(TWO_COMMANDERS);
        assert!(units.iter().all(|u| u.morph_targets.is_empty()));
    }

    #[test]
    fn a_line_written_before_the_column_existed_claims_no_morphs() {
        let units = parse_dataset_units("armsolar\tSolar\t\t0\tARMSOLAR");
        assert!(units[0].morph_targets.is_empty());
    }

    #[test]
    fn a_morph_column_that_is_not_an_array_of_targets_is_dropped() {
        // A target with no `into` names nothing, and a column that is not an
        // array at all is a line this cannot read. Neither is an error: the
        // rest of the unit is still a unit.
        let units = parse_dataset_units(
            "armcom\tCommander\t\t1\tARMCOM\t2\t2\t0.0000\t0\t0\t0\t0\t{}\t[{\"time\":3},\"nonsense\"]",
        );
        assert!(units[0].morph_targets.is_empty());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p coilbox-unitsync-worker morph`
Expected: compile failure, `no field morph_targets on type UnitDatasetEntry`.

- [ ] **Step 3: Add the field to the model**

In `model.rs`, after the `stats` field of `UnitDatasetEntry`:

```rust
    /// What this unit can turn into: a morph, an upgrade, a tech level
    /// (issue #2063). One object per edge, each holding `into` (the target's
    /// lowercased def key) plus whatever conditions the game declared beside
    /// it, lowercased and passed through as written.
    ///
    /// Deliberately untyped, for the reason `stats` is. Four games spell the
    /// conditions four ways: `research` and `require` in SplinterFaction,
    /// `morphcost` and `level` in Zero-K, `xp` and `rank` in the shared morph
    /// gadget's documentation, `facing` and `tech` in Spring 1944. A struct
    /// naming today's set would be wrong by the fifth game.
    ///
    /// Empty for a unit that morphs nowhere and for a line written before the
    /// column existed. The two are the same claim here, which they are not for
    /// `max_slope`: an edge nobody reported and an edge that does not exist
    /// both mean no reader should draw one.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub morph_targets: Vec<serde_json::Map<String, serde_json::Value>>,
```

- [ ] **Step 4: Add the morph block to the Lua shim**

In `dataset.rs`, inside `UNIT_DATASET_SHIM_SCRIPT`, after `stats_of` and before the `wdefs` table is built. It uses `json_string`, `json_number` and `lowered`, so it has to come after all three:

```lua
-- What a unit turns into (issue #2063). Not a unitdef field: games arrange it
-- themselves, and two arrangements are both real. Zero-K writes the target onto
-- the def's own `customparams`. Metal Factions, Spring 1944, Expand and
-- Exterminate and SplinterFaction ship a config file that a gadget loads. Both
-- are read and a unit's edges are the union, because a game may do both and
-- taking both costs one table lookup.
--
-- Zero-K's own config file cannot stand in for its customparams: it loops over
-- `UnitDefs` and `UnitDefNames`, which this parser does not have, and wants
-- `Spring.Utilities.CMD` and `gadget:GetInfo()` besides.
local MORPH_CONFIGS = { 'luarules/configs/morph_defs.lua', 'gamedata/morph_defs.lua' }

-- The conditions Zero-K writes beside a customparams target, each carrying the
-- same suffix the target does.
local MORPH_PARAMS = { 'morphtime', 'morphcost', 'level', 'combatmorph' }

-- One morph edge as a target key and a JSON object. Everything the game wrote
-- beside `into` rides along under its own lowercased name, because no two games
-- name these the same. A table value is dropped rather than flattened: it
-- cannot be shown next to the edge, and guessing at it would put words in the
-- game's mouth.
local function morph_entry(e)
  if type(e) ~= 'table' then return nil end
  local low = lowered(e)
  local into = low['into']
  if type(into) ~= 'string' or into == '' then return nil end
  into = string.lower(into)
  local parts = { '"into":' .. json_string(into) }
  local keys = {}
  for k in pairs(low) do
    if k ~= 'into' then keys[#keys + 1] = k end
  end
  table.sort(keys)
  for _, k in ipairs(keys) do
    local v = low[k]
    if type(v) == 'number' then
      local n = json_number(v)
      if n then parts[#parts + 1] = json_string(k) .. ':' .. n end
    elseif type(v) == 'string' and v ~= '' then
      parts[#parts + 1] = json_string(k) .. ':' .. json_string(v)
    elseif type(v) == 'boolean' then
      parts[#parts + 1] = json_string(k) .. ':' .. tostring(v)
    end
  end
  return into, '{' .. table.concat(parts, ',') .. '}'
end

-- A config's value for one unit, as a list of entries. Spring 1944 writes one
-- table per unit and Metal Factions writes a list of them, so a value with a
-- table at [1] is a list and anything else is a single entry.
local function morph_list(v)
  if type(v) ~= 'table' then return {} end
  if type(v[1]) == 'table' then return v end
  return { v }
end

-- The game's morph config, keyed by lowercased source unit. The paths are tried
-- in order and the first that yields anything wins. Each `VFS.Include` is
-- pcall'd because it raises on a file the archive does not have, which is most
-- games: a game with no morph config is a game with no morphs, not a dataset
-- with no units.
local morphs = {}
for _, path in ipairs(MORPH_CONFIGS) do
  if next(morphs) == nil then
    local ok, cfg = pcall(VFS.Include, path)
    if ok and type(cfg) == 'table' then
      for k, v in pairs(cfg) do
        if type(k) == 'string' then
          local entries = {}
          for _, e in ipairs(morph_list(v)) do
            local into, json = morph_entry(e)
            if into then entries[#entries + 1] = { into = into, json = json } end
          end
          if #entries > 0 then morphs[string.lower(k)] = entries end
        end
      end
    end
  end
end

-- What a def says about morphing on its own customparams. Zero-K spells a
-- single target `morphto` and a list `morphto_1`, `morphto_2` and upwards, and
-- takes the list when both are present, which is the precedence its own config
-- applies.
local function morph_from_params(d)
  local cp = lowered(type(d) == 'table' and (d.customparams or d.customParams) or nil)
  local out = {}
  local function add(suffix)
    local into = cp['morphto' .. suffix]
    if type(into) ~= 'string' or into == '' then return false end
    local e = { into = into }
    for _, p in ipairs(MORPH_PARAMS) do
      if cp[p .. suffix] ~= nil then e[p] = cp[p .. suffix] end
    end
    local key, json = morph_entry(e)
    if key then out[#out + 1] = { into = key, json = json } end
    return true
  end
  if cp['morphto_1'] ~= nil then
    local i = 1
    while add('_' .. i) do i = i + 1 end
  else
    add('')
  end
  return out
end

-- One unit's edges, both sources merged, deduplicated by target and sorted by
-- it. A game that declares the same morph twice has said one thing, and the
-- order two sources happen to arrive in is not a fact worth a new digest.
local function morph_of(k, d)
  local seen, picked = {}, {}
  for _, source in ipairs({ morphs[string.lower(tostring(k))] or {}, morph_from_params(d) }) do
    for _, e in ipairs(source) do
      if not seen[e.into] then
        seen[e.into] = true
        picked[#picked + 1] = e
      end
    end
  end
  table.sort(picked, function(a, b) return a.into < b.into end)
  local out = {}
  for _, e in ipairs(picked) do out[#out + 1] = e.json end
  return '[' .. table.concat(out, ',') .. ']'
end
```

Then extend the line the loop writes, after the `stats_of` column:

```lua
    .. '\t' .. stats_of(d, wdefs)
    .. '\t' .. morph_of(k, d)
```

- [ ] **Step 5: Parse the column**

In `dataset.rs`, beside `parse_stats`:

```rust
/// The morph edges the line's last column carries.
///
/// An element with no `into` string names nothing and is dropped, and a column
/// that is missing, empty or not an array is no edges at all. None of it is an
/// error: a line written before the column existed still describes a real unit,
/// and one unreadable edge is not a reason to lose the unit that has it.
///
/// What sits beside `into` is deliberately not typed, for the reason
/// [`parse_stats`] does not type a stat.
fn parse_morph_targets(field: Option<&str>) -> Vec<Map<String, Value>> {
    field
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .and_then(|s| serde_json::from_str::<Value>(s).ok())
        .and_then(|value| match value {
            Value::Array(items) => Some(items),
            _ => None,
        })
        .unwrap_or_default()
        .into_iter()
        .filter_map(|item| match item {
            Value::Object(map) => Some(map),
            _ => None,
        })
        .filter(|map| map.get("into").and_then(Value::as_str).is_some_and(|s| !s.is_empty()))
        .collect()
}
```

In `parse_dataset_units`, after `let stats = parse_stats(it.next());`:

```rust
            let morph_targets = parse_morph_targets(it.next());
```

and add `morph_targets,` to the `UnitDatasetEntry` it builds.

- [ ] **Step 6: Bump the dataset cache version**

In `infocache.rs`, change `const INFO_CACHE_VERSION: u32 = 14;` to `15`. The cache is keyed on file identity and knows nothing about shim changes, so without this every game already scanned reports no morphs for ever and no rescan clears it.

- [ ] **Step 7: Run the tests**

Run: `cargo test -p coilbox-unitsync-worker`
Expected: PASS, including the tests that already called `extract`.

- [ ] **Step 8: Document what a morph entry holds**

In `shared/unitdef-stats.json`, add a sibling to `unit` and `weapon`:

```json
  "morph": {
    "note": "What a unit turns into (issue #2063), sent as morphTargets: one object per edge. Not part of a unitdef the way the stats above are. Read from two places at once: the def's own customparams (Zero-K's morphto, morphto_1 and upwards, with morphtime, morphcost, level and combatmorph carrying the same suffix) and the game's morph config, tried at luarules/configs/morph_defs.lua then gamedata/morph_defs.lua. A game may write neither, which is most of them.",
    "into": {
      "from": ["into", "customparams.morphto"],
      "unit": null,
      "note": "The target's def key, lowercased so the morph graph's edges match the build graph's node names. Always present: an entry without one names nothing and is dropped."
    },
    "conditions": {
      "from": ["every other key the game wrote beside into"],
      "unit": null,
      "note": "Passed through under their own lowercased names, because no two games agree on them: research, require and tech in SplinterFaction, morphcost, level and combatmorph in Zero-K, xp and rank in the shared gadget's documentation, facing, directional and tech in Spring 1944. Numbers, strings and booleans only. A table value is dropped rather than flattened."
    },
    "maxMorphJson": 8192
  },
```

- [ ] **Step 9: Commit**

```bash
git add crates/coilbox-unitsync-worker/src/dataset.rs crates/coilbox-unitsync-worker/src/model.rs crates/coilbox-unitsync-worker/src/infocache.rs shared/unitdef-stats.json
git commit -m "Read what a unit morphs into out of a game's config and customparams"
```

---

### Task 2: Prove the extraction against real archives

**Files:**
- No source changes. This task is a gate, and it fails loudly rather than adjusting the numbers to match.

**Interfaces:**
- Consumes: the shim from Task 1.

The four games below are installed under `~/.spring/games`. The numbers come from running the same extraction logic through the real parser on 30 August 2026, before it was written into the shim, so a mismatch means the shim differs from what was measured rather than that the measurement was optimistic.

- [ ] **Step 1: Build the sidecar**

Run: `bun run sidecar:unitsync`
Expected: the worker is rebuilt. The sidecar is a compiled binary, so without this every check below reads the old one.

- [ ] **Step 2: Read each game's dataset**

For each archive, run the worker in `--unit-dataset` mode against the installed engine and count what came back. Substitute the engine path for the one installed:

```bash
W=./src-tauri/binaries/coilbox-unitsync-worker-aarch64-apple-darwin
LIB="$HOME/.spring/engine/macos_arm64/2026.07.04-46-g04f42e2 macos_integration/libunitsync.dylib"
for a in metal_factions-v2.58.sdz spring_1944-2.31.sdz \
         expand_and_exterminate-0.46_for_spring_0.88.sdz \
         SplinterFaction.sdd balanced_annihilation-v15.9.8.sdz; do
  echo "== $a"
  "$W" --lib "$LIB" --datadir "$HOME/.spring" --unit-dataset --game "$a" \
    | jq '[.units[] | select((.morphTargets // []) | length > 0)] | length'
done
```

Expected, exactly:

| Archive | Units with at least one morph |
| --- | --- |
| `metal_factions-v2.58.sdz` | 17 |
| `spring_1944-2.31.sdz` | 186 |
| `expand_and_exterminate-0.46_for_spring_0.88.sdz` | 11 |
| `SplinterFaction.sdd` | 16 |
| `balanced_annihilation-v15.9.8.sdz` | 0 |

SplinterFaction is the one to watch. Its config sits at `gamedata/morph_defs.lua` rather than the usual path, so a count of 0 there with the others right means the second config path is not being tried.

- [ ] **Step 3: Check no edge points at a unit the game does not have**

```bash
"$W" --lib "$LIB" --datadir "$HOME/.spring" --unit-dataset --game metal_factions-v2.58.sdz \
  | jq '[.units[].name] as $known
        | [.units[] | (.morphTargets // [])[] | .into | select(. as $t | $known | index($t) | not)]
        | length'
```

Expected: `0`. The same held for Spring 1944 and Expand and Exterminate when measured. A number above zero is not automatically wrong, since a game may name a unit it stripped, but it means the lowercasing agrees on one side and not the other, so check a sample by hand before moving on.

- [ ] **Step 4: Check the widest entry against the cap**

```bash
"$W" --lib "$LIB" --datadir "$HOME/.spring" --unit-dataset --game metal_factions-v2.58.sdz \
  | jq '[.units[] | (.morphTargets // []) | tojson | length] | max'
```

Expected: 1586 or close to it, on `gear_commander`. Anything above 8192 breaks the cap the hub will enforce in Task 6 and has to be understood before the wire work starts.

- [ ] **Step 5: Record what was run**

Put the five counts in the PR description, naming the engine build. No commit: nothing changed.

---

### Task 3: The app can see and group a unit's stages

**Files:**
- Modify: `src/content/bindings.ts:1189-1200`
- Create: `src/content/morphGraph.ts`
- Create: `src/content/morphGraph.test.ts`

**Interfaces:**
- Consumes: `UnitDatasetEntry.morphTargets` from Task 1.
- Produces:
  - `morphEdgeMap(units: UnitDatasetEntry[]): Map<string, string[]>`
  - `interface MorphGroup { base: string; stages: string[] }`
  - `morphGroups(units: UnitDatasetEntry[]): MorphGroup[]`
  - `groupOf(groups: MorphGroup[]): Map<string, string>` - every stage id to its group's base id.
  - Task 5 adds `foldMorphs(units, edges)` to the same file, and Task 9 vendors the file into the hub, so nothing else may be added to it without the hub's typecheck agreeing.

- [ ] **Step 1: Add the type**

In `src/content/bindings.ts`, on `UnitDatasetEntry` after `stats`:

```ts
  /**
   * What this unit turns into: a morph, an upgrade, a tech level (issue #2063).
   * One object per edge, each with `into` (the target's lowercased def key) and
   * whatever conditions the game declared beside it, under the game's own
   * lowercased names. Untyped past `into` on purpose, because no two games
   * spell the conditions the same way.
   *
   * Absent from a dataset read by a worker too old to report it, which reads
   * the same as a unit that morphs nowhere: draw no edge either way.
   */
  morphTargets?: ({ into: string } & Record<string, unknown>)[];
```

- [ ] **Step 2: Write the failing tests**

Create `src/content/morphGraph.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { UnitDatasetEntry } from "./bindings";
import { groupOf, morphEdgeMap, morphGroups } from "./morphGraph";

function unit(
  name: string,
  morphTargets: { into: string }[] = [],
): UnitDatasetEntry {
  return { name, morphTargets };
}

describe("morphEdgeMap", () => {
  it("drops an edge to a unit the game does not have", () => {
    const edges = morphEdgeMap([unit("armcom0", [{ into: "armcom1" }])]);
    expect(edges.get("armcom0")).toEqual([]);
  });

  it("lowercases both ends", () => {
    const units = [unit("ARMCOM0", [{ into: "ArmCom1" }]), unit("armcom1")];
    expect(morphEdgeMap(units).get("armcom0")).toEqual(["armcom1"]);
  });
});

describe("morphGroups", () => {
  it("gathers a ladder under the unit nothing morphs into", () => {
    const units = [
      unit("fedcommander", [{ into: "fedcommander_up1" }]),
      unit("fedcommander_up1", [{ into: "fedcommander_up2" }]),
      unit("fedcommander_up2"),
    ];
    expect(morphGroups(units)).toEqual([
      {
        base: "fedcommander",
        stages: ["fedcommander", "fedcommander_up1", "fedcommander_up2"],
      },
    ]);
  });

  it("keeps a unit that morphs into two things as one group", () => {
    const units = [
      unit("factory", [{ into: "gunyard" }, { into: "airyard" }]),
      unit("gunyard"),
      unit("airyard"),
    ];
    expect(morphGroups(units)).toEqual([
      { base: "factory", stages: ["airyard", "factory", "gunyard"] },
    ]);
  });

  it("survives a loop back to where it started", () => {
    const units = [
      unit("siegemode", [{ into: "walkmode" }]),
      unit("walkmode", [{ into: "siegemode" }]),
    ];
    // Every unit has something morphing into it, so the base is the first by
    // name rather than an exception.
    expect(morphGroups(units)).toEqual([
      { base: "siegemode", stages: ["siegemode", "walkmode"] },
    ]);
  });

  it("leaves a unit that morphs nowhere out of the groups", () => {
    expect(morphGroups([unit("armsolar"), unit("armwin")])).toEqual([]);
  });

  it("does not group two ladders that never meet", () => {
    const units = [
      unit("a1", [{ into: "a2" }]),
      unit("a2"),
      unit("b1", [{ into: "b2" }]),
      unit("b2"),
    ];
    expect(morphGroups(units).map((g) => g.base)).toEqual(["a1", "b1"]);
  });
});

describe("groupOf", () => {
  it("points every stage at its base", () => {
    const groups = morphGroups([
      unit("armcom0", [{ into: "armcom1" }]),
      unit("armcom1"),
    ]);
    const map = groupOf(groups);
    expect(map.get("armcom1")).toBe("armcom0");
    expect(map.get("armcom0")).toBe("armcom0");
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `bunx vitest run src/content/morphGraph.test.ts`
Expected: FAIL, cannot resolve `./morphGraph`.

- [ ] **Step 4: Write the implementation**

Create `src/content/morphGraph.ts`:

```ts
import type { UnitDatasetEntry } from "./bindings";

/**
 * Grouping a unit's stages over the morph graph (issue #2063).
 *
 * A commander that upgrades through tech levels is one unit to the player and
 * five unrelated units to everything that reads `buildoptions`. These helpers
 * are how both coilbox and the hub turn the second into the first, and they are
 * vendored into the hub byte identical so the two group the same way by
 * construction rather than by agreement.
 *
 * Morph edges are a graph, not a chain. A unit morphs into either of two
 * things, a game loops back to where it started, and every walk here is cycle
 * guarded.
 */

/** One unit's stages, and which of them a reader is shown first. */
export interface MorphGroup {
  /** The stage the group is named and pictured with. */
  base: string;
  /** Every stage including the base, sorted, so the list is stable. */
  stages: string[];
}

/**
 * Lowercased adjacency map: unit internal name to what it morphs into. Edges to
 * a unit the dataset does not hold are dropped, matching `buildEdgeMap`: a
 * target naming a stripped def would otherwise invent a stage nobody can open.
 */
export function morphEdgeMap(
  units: UnitDatasetEntry[],
): Map<string, string[]> {
  const known = new Set(units.map((u) => u.name.toLowerCase()));
  const edges = new Map<string, string[]>();
  for (const u of units) {
    const targets = (u.morphTargets ?? [])
      .map((m) => m.into?.toLowerCase())
      .filter((into): into is string => !!into && known.has(into));
    edges.set(u.name.toLowerCase(), [...new Set(targets)]);
  }
  return edges;
}

/**
 * Every group of units joined by morph edges, one per connected component.
 *
 * The walk is undirected. A branch means two stages share a parent and nothing
 * morphs one into the other, and they still belong together.
 *
 * The base is the stage nothing else in the group morphs into, which is what a
 * ladder's bottom rung looks like. Two of those means a game where two units
 * morph into one, and the first by name wins. None of them means a cycle, where
 * every stage has a parent, and the first by name wins there too. A rule that
 * always answers beats an exception, because the alternative is a group with no
 * name in a game nobody has looked at yet.
 *
 * Units with no morph edge at all are not groups. A group of one is a unit, and
 * a caller that has to check `length > 1` everywhere will forget somewhere.
 */
export function morphGroups(units: UnitDatasetEntry[]): MorphGroup[] {
  const edges = morphEdgeMap(units);
  const incoming = new Map<string, number>();
  const undirected = new Map<string, Set<string>>();
  for (const [from, targets] of edges) {
    for (const to of targets) {
      incoming.set(to, (incoming.get(to) ?? 0) + 1);
      if (!undirected.has(from)) undirected.set(from, new Set());
      if (!undirected.has(to)) undirected.set(to, new Set());
      undirected.get(from)?.add(to);
      undirected.get(to)?.add(from);
    }
  }

  const seen = new Set<string>();
  const groups: MorphGroup[] = [];
  for (const start of [...undirected.keys()].sort()) {
    if (seen.has(start)) continue;
    const stages: string[] = [];
    const queue = [start];
    seen.add(start);
    while (queue.length > 0) {
      // biome-ignore lint/style/noNonNullAssertion: queue is non-empty in the loop
      const node = queue.shift()!;
      stages.push(node);
      for (const next of undirected.get(node) ?? []) {
        if (seen.has(next)) continue;
        seen.add(next);
        queue.push(next);
      }
    }
    stages.sort();
    const base = stages.find((s) => !incoming.has(s)) ?? stages[0];
    groups.push({ base, stages });
  }
  return groups;
}

/** Every stage to the base of the group holding it, for a caller with an id in
 * hand and no interest in the group's shape. */
export function groupOf(groups: MorphGroup[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const group of groups) {
    for (const stage of group.stages) map.set(stage, group.base);
  }
  return map;
}
```

- [ ] **Step 5: Run the tests**

Run: `bunx vitest run src/content/morphGraph.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 6: Commit**

```bash
git add src/content/bindings.ts src/content/morphGraph.ts src/content/morphGraph.test.ts
git commit -m "Group a unit's morph stages over the morph graph"
```

---

### Task 4: The unit picker offers one row per unit, not one per stage

**Files:**
- Modify: `src/content/techForest.ts:42-73`
- Modify: `src/content/pages/components/UnitPicker.tsx`
- Modify: `src/content/techForest.test.ts`

**Interfaces:**
- Consumes: `morphGroups`, `groupOf` from Task 3.
- Produces: `TechForest.morphBase: Map<string, string>` - every unit id to the id it is listed under, which is itself for a unit with no morphs.

- [ ] **Step 1: Write the failing test**

In `src/content/techForest.test.ts`:

```ts
  it("lists a commander's upgrades under the commander", () => {
    const units = [
      { name: "armcom", buildOptions: ["armsolar"], morphTargets: [{ into: "armcom1" }] },
      { name: "armcom1", buildOptions: ["armsolar", "armlab"] },
      { name: "armsolar" },
      { name: "armlab" },
    ];
    const forest = buildTechForest(units, ["armcom"]);
    expect(forest.morphBase.get("armcom1")).toBe("armcom");
    expect(forest.morphBase.get("armsolar")).toBe("armsolar");
  });

  it("gives an upgraded stage the faction its base has", () => {
    const units = [
      { name: "armcom", morphTargets: [{ into: "armcom1" }] },
      { name: "armcom1" },
    ];
    const forest = buildTechForest(units, ["armcom"]);
    // armcom1 is not built by anything, so without the morph edge it would be
    // ungrouped and shown under "Other units".
    expect(forest.factionOf.get("armcom1")).toBe("armcom");
    expect(forest.ungrouped).toEqual([]);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run src/content/techForest.test.ts`
Expected: FAIL, `forest.morphBase` is undefined.

- [ ] **Step 3: Fold morph edges into the forest**

In `techForest.ts`, add to the `TechForest` interface:

```ts
  /** Every unit id to the id it is listed under: a morph stage maps to its
   * group's base, everything else maps to itself. A commander's five tech
   * levels are one row in a picker rather than five (issue #2063). */
  morphBase: Map<string, string>;
```

In `buildTechForest`, after `const edges = buildEdgeMap(units);`:

```ts
  // A stage is reached by morphing, not by building, so the faction walk has to
  // cross morph edges too. Without this an upgraded commander nothing builds is
  // in no faction at all, and lands in the picker's "Other units" block next to
  // the game's leftovers.
  const morphEdges = morphEdgeMap(units);
  for (const [from, targets] of morphEdges) {
    if (targets.length === 0) continue;
    edges.set(from, [...(edges.get(from) ?? []), ...targets]);
  }
  const morphBase = groupOf(morphGroups(units));
```

Add `morphBase` to the returned object, defaulting a unit with no group to itself where it is read.

Import at the top: `import { groupOf, morphEdgeMap, morphGroups } from "./morphGraph";`

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run src/content/techForest.test.ts`
Expected: PASS.

- [ ] **Step 5: Show one row per group in the picker**

In `UnitPicker.tsx`, where the ids for `factionGroups` are assembled, keep only ids that are their own `morphBase`, and render the stages as a count on the base's row (`armcom, 4 upgrades`). Toggling the base toggles every stage, because a restriction that disabled a commander and left its tech levels buildable would be a hole rather than a restriction.

Run: `bun run tauri dev`, open a game with morphs (SplinterFaction or Metal Factions), open the unit restrictions picker, and confirm one commander row rather than five.

- [ ] **Step 6: Commit**

```bash
git add src/content/techForest.ts src/content/techForest.test.ts src/content/pages/components/UnitPicker.tsx
git commit -m "Offer a unit's morph stages as one row in the picker"
```

---

### Task 5: The build tree draws one node per unit

**Files:**
- Modify: `src/content/pages/components/BuildTreeDrawer.tsx`
- Modify: `src/content/pages/components/FactionBuildList.tsx`
- Modify: `src/content/buildTree.test.ts`

**Interfaces:**
- Consumes: `morphGroups`, `groupOf` from Task 3, `TechForest.morphBase` from Task 4.

- [ ] **Step 1: Write the failing test**

In `src/content/buildTree.test.ts`:

```ts
  it("counts a commander and its upgrades once", () => {
    const units = [
      { name: "armcom", buildOptions: ["armsolar"], morphTargets: [{ into: "armcom1" }] },
      { name: "armcom1", buildOptions: ["armsolar", "armlab"] },
      { name: "armsolar" },
      { name: "armlab" },
    ];
    const edges = foldMorphs(units, buildEdgeMap(units));
    // What the second stage builds is what the commander builds, and the stage
    // itself is not a node.
    expect(edges.get("armcom")?.sort()).toEqual(["armlab", "armsolar"]);
    expect(edges.has("armcom1")).toBe(false);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run src/content/buildTree.test.ts`
Expected: FAIL, `foldMorphs` is not exported.

- [ ] **Step 3: Write it**

In `src/content/morphGraph.ts`:

```ts
/**
 * The build edge map with each morph group collapsed onto its base: what any
 * stage builds is what the unit builds, and no stage is a node of its own.
 *
 * This is the whole of "one node in the tree". A level that unlocks a new build
 * option folds it into the same node rather than starting a second subtree, and
 * an edge that pointed at a stage is redirected to the stage's base, so nothing
 * dangles.
 */
export function foldMorphs(
  units: UnitDatasetEntry[],
  edges: Map<string, string[]>,
): Map<string, string[]> {
  const base = groupOf(morphGroups(units));
  const at = (id: string) => base.get(id) ?? id;
  const folded = new Map<string, Set<string>>();
  for (const [from, targets] of edges) {
    const parent = at(from);
    if (!folded.has(parent)) folded.set(parent, new Set());
    for (const to of targets) {
      const child = at(to);
      // A stage building its own next stage is the group building itself.
      if (child !== parent) folded.get(parent)?.add(child);
    }
  }
  return new Map([...folded].map(([k, v]) => [k, [...v].sort()]));
}
```

- [ ] **Step 4: Run the tests**

Run: `bunx vitest run src/content/buildTree.test.ts src/content/morphGraph.test.ts`
Expected: PASS.

- [ ] **Step 5: Use it in the two views**

In `BuildTreeDrawer.tsx` and `FactionBuildList.tsx`, pass `foldMorphs(units, buildEdgeMap(units))` where `buildEdgeMap(units)` is passed today, and label a folded node with the base's name plus its stage count. The Sides card counts come from `reachableCounts`, which takes the same map, so they fall out of the change rather than needing their own.

Run: `bun run tauri dev`, open the build tree for Metal Factions, confirm one commander node whose children include what the upgraded forms build.

- [ ] **Step 6: Commit**

```bash
git add src/content/morphGraph.ts src/content/buildTree.test.ts src/content/pages/components/BuildTreeDrawer.tsx src/content/pages/components/FactionBuildList.tsx
git commit -m "Draw a unit's morph stages as one node in the build tree"
```

---

### Task 6: The hub accepts morph targets on a unit entry

**Files:**
- Modify: `~/dev/coilbox-hub/lib/api/gameFacts.ts:93-99, 128, 130-143, 236-270`
- Modify: `~/dev/coilbox-hub/lib/games/submit.ts:52-61`
- Modify: `~/dev/coilbox-hub/lib/api/gameFacts.test.ts`
- Modify: `~/dev/coilbox-hub/lib/games/submit.test.ts`

**Interfaces:**
- Produces: `SubmittedUnit.morph_targets: Record<string, unknown>[]`, parsed from the wire's `morphTargets`.
- Produces: `unitDigest` covers `morphTargets`, so a game whose morphs changed writes a new revision.

This ships before Task 8. The hub refuses an unknown field rather than dropping it, so a client sending `morphTargets` today has every unit refused.

- [ ] **Step 1: Write the failing tests**

In `lib/api/gameFacts.test.ts`:

```ts
  it("accepts morph targets on a unit", () => {
    const parsed = parseGameFactsBody(
      body({
        units: [
          {
            name: "armcom",
            buildOptions: [],
            stats: {},
            morphTargets: [{ into: "armcom1", morphtime: 10 }],
          },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.submission.units[0].morph_targets).toEqual([
      { into: "armcom1", morphtime: 10 },
    ]);
  });

  it("refuses a morph target with no unit to turn into", () => {
    const parsed = parseGameFactsBody(
      body({
        units: [
          { name: "armcom", buildOptions: [], stats: {}, morphTargets: [{ morphtime: 10 }] },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    // A malformed entry is a refusal for that unit, not a 400 for the game.
    expect(parsed.submission.units).toEqual([]);
  });

  it("refuses morph targets that are not a list", () => {
    const parsed = parseGameFactsBody(
      body({
        units: [
          { name: "armcom", buildOptions: [], stats: {}, morphTargets: { into: "armcom1" } },
        ],
      }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.submission.units).toEqual([]);
  });

  it("takes a unit that sends no morph targets at all", () => {
    const parsed = parseGameFactsBody(
      body({ units: [{ name: "armcom", buildOptions: [], stats: {} }] }),
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.submission.units[0].morph_targets).toEqual([]);
  });
```

In `lib/games/submit.test.ts`:

```ts
  it("digests a unit whose morphs changed as different facts", async () => {
    const base = {
      name: "armcom",
      full_name: null,
      faction_key: null,
      build_options: [],
      stats: {},
    };
    const before = await unitDigest({ ...base, morph_targets: [] });
    const after = await unitDigest({
      ...base,
      morph_targets: [{ into: "armcom1" }],
    });
    expect(before).not.toBe(after);
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `cd ~/dev/coilbox-hub && bun test lib/api/gameFacts.test.ts lib/games/submit.test.ts`
Expected: FAIL, the first with `unknown field: morphTargets`.

- [ ] **Step 3: Parse the field**

In `lib/api/gameFacts.ts`, add `"morphTargets"` to `UNIT_FIELDS`, then beside `readStats`:

```ts
/** The largest serialised morph blob one unit may carry. The same number
 * `MAX_STATS_JSON` uses, and for the same reason. The widest morph a real game
 * has been measured to declare is 1586 bytes, on Metal Factions' commander. */
const MAX_MORPH_JSON = 8_192;

/** How many stages one unit may claim to turn into. A morph is a graph and a
 * branch is ordinary, but a unit with more targets than a game has factions is
 * an extractor that has gone wrong. */
const MAX_MORPH_TARGETS = 64;

/**
 * What a unit turns into, as the client read it.
 *
 * `into` is the only field named here. Everything beside it is the game's own
 * condition vocabulary, stored and rendered as it arrives, because four games
 * spell it four ways and a hub that named them would refuse the fifth.
 */
function readMorphTargets(
  record: Record<string, unknown>,
): Read<Record<string, unknown>[]> {
  const value = record.morphTargets;
  if (value === undefined || value === null) return { ok: true, value: [] };
  if (!Array.isArray(value)) {
    return { ok: false, error: "`morphTargets` must be an array of morph objects." };
  }
  if (value.length > MAX_MORPH_TARGETS) {
    return { ok: false, error: "`morphTargets` is implausibly long." };
  }
  const seen = new Set<string>();
  const targets: Record<string, unknown>[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) {
      return { ok: false, error: "`morphTargets` entries must be JSON objects." };
    }
    const into = entry.into;
    if (typeof into !== "string" || into.trim().length === 0) {
      return { ok: false, error: "a `morphTargets` entry must name the unit it turns into." };
    }
    if (into.trim().length > MAX_LENGTHS.unitName) {
      return { ok: false, error: "a `morphTargets` entry names a unit too long to store." };
    }
    // Two edges to one target are one edge. The client deduplicates already, so
    // this is about what a second client might send rather than about ours.
    if (seen.has(into.trim())) continue;
    seen.add(into.trim());
    targets.push({ ...entry, into: into.trim() });
  }
  if (canonicalJson(targets).length > MAX_MORPH_JSON) {
    return { ok: false, error: `\`morphTargets\` holds more than ${MAX_MORPH_JSON} bytes of JSON.` };
  }
  return { ok: true, value: targets };
}
```

In `readUnit`, after the stats read, add the call and put `morph_targets: morphTargets.value` on the returned object. Add `morph_targets: Record<string, unknown>[]` to `SubmittedUnit`.

- [ ] **Step 4: Digest it**

In `lib/games/submit.ts`, inside `unitDigest`'s `canonicalJson` call, after `buildOptions`:

```ts
    morphTargets: unit.morph_targets,
```

Order is not sorted here the way build options are, because the client sorts by target before it sends and `canonicalJson` sorts each entry's keys. Say so in the comment above the function.

- [ ] **Step 5: Run the tests**

Run: `cd ~/dev/coilbox-hub && bun test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
cd ~/dev/coilbox-hub
git add lib/api/gameFacts.ts lib/api/gameFacts.test.ts lib/games/submit.ts lib/games/submit.test.ts
git commit -m "Take what a unit turns into on a game facts submission"
```

---

### Task 7: The hub stores morph targets

**Files:**
- Create: `~/dev/coilbox-hub/supabase/migrations/20260830120000_game_unit_morph.sql`
- Modify: `~/dev/coilbox-hub/supabase/tests/game_submission.test.sql`

**Interfaces:**
- Consumes: `submit_game_facts(p_submission jsonb, p_submitted_by uuid)` as `20260822120000_game_start_units.sql` leaves it.
- Produces: `game_unit.morph_targets jsonb` and `game_unit_revision.morph_targets jsonb`, both `not null default '[]'::jsonb`.

`jsonb` rather than the `text[]` `build_options` uses, because the conditions belong to the edge. Splitting the targets from their conditions would need a second key joining two columns that nothing stops from drifting apart.

- [ ] **Step 1: Write the failing SQL test**

In `supabase/tests/game_submission.test.sql`, extend the submission the suite sends with a unit carrying morph targets, then assert:

```sql
select is(
  (select morph_targets from public.game_unit
    where game_id = v_game_id and unit_name = 'armcom'),
  '[{"into": "armcom1", "morphtime": 10}]'::jsonb,
  'a submitted morph target is stored on the unit'
);

select is(
  (select morph_targets from public.game_unit_revision
    where unit_id = v_unit_id and version = '1.0'),
  '[{"into": "armcom1", "morphtime": 10}]'::jsonb,
  'and on the revision the release wrote'
);
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/dev/coilbox-hub && supabase test db`
Expected: FAIL, `column "morph_targets" does not exist`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260830120000_game_unit_morph.sql`. Start with the columns:

```sql
-- What a unit turns into (coilbox#2063).
--
-- A commander that upgrades through tech levels is one unit at five stages of
-- its life, and the catalog held five unrelated rows. This is the second
-- relationship between units the table stores, beside build_options.
--
-- jsonb rather than text[], because the conditions belong to the edge: a level
-- to reach, a cost to pay, a time to wait, spelled differently by every game
-- that has them. Splitting the target from what it costs would need a second
-- key joining two columns nothing keeps in step.
--
-- A new migration carrying the whole function rather than an edit of the
-- applied one, per the house rule.

alter table public.game_unit
  add column if not exists morph_targets jsonb not null default '[]'::jsonb;

alter table public.game_unit_revision
  add column if not exists morph_targets jsonb not null default '[]'::jsonb;
```

Then copy the whole `create or replace function public.submit_game_facts` body from `supabase/migrations/20260822120000_game_start_units.sql` and make four changes to the copy:

1. Declare `v_morph_targets jsonb;` beside `v_build_options text[];`.
2. Beside where `v_build_options` is read from the entry, read the morph list, defaulting to an empty array so an older client that sends nothing stores nothing rather than null: `v_morph_targets := coalesce(v_entry -> 'unit' -> 'morph_targets', '[]'::jsonb);`
3. Add `morph_targets` to the `insert into public.game_unit` column list and `v_morph_targets` to its values, and to the `on conflict` update beside `build_options = v_build_options`.
4. Add `morph_targets` to both `insert into public.game_unit_revision` statements and to the `on conflict` update of the second.

- [ ] **Step 4: Run the tests**

Run: `cd ~/dev/coilbox-hub && supabase db reset && supabase test db`
Expected: PASS, including the assertions already in the file.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/coilbox-hub
git add supabase/migrations/20260830120000_game_unit_morph.sql supabase/tests/game_submission.test.sql
git commit -m "Store what a unit turns into beside what it builds"
```

---

### Task 8: Coilbox sends the morph targets

**Files:**
- Modify: `crates/tauri-plugin-coilbox-hub/src/games.rs:93-112, 300-320`
- Modify: `src/hub/games/facts.ts:19-34`
- Modify: `src/hub/games/factsSweep.ts:321-334`
- Modify: `src/hub/games/factsSweep.test.ts`

**Interfaces:**
- Consumes: `UnitDatasetEntry.morphTargets` from Task 3, the hub's acceptance from Tasks 6 and 7.
- Produces: `GameUnitFacts.morph_targets`, on the wire as `morphTargets`, always sent, the way `buildOptions` and `stats` are.

Do not start this until Task 6 and Task 7 are deployed. A submission carrying a field the live hub does not know refuses every unit of every game.

- [ ] **Step 1: Write the failing tests**

In `games.rs`, the test at `:459` asserts the exact set of keys one unit sends. Extend it:

```rust
            vec!["buildOptions", "factionKey", "fullName", "morphTargets", "name", "stats"]
```

and add:

```rust
    #[test]
    fn a_unit_sends_what_it_turns_into() {
        let mut facts = game();
        facts.units[0].morph_targets = vec![serde_json::json!({
            "into": "armcom1",
            "morphtime": 10,
        })
        .as_object()
        .unwrap()
        .clone()];
        let sent: Value = serde_json::from_str(&check_and_build(&facts).unwrap()).unwrap();
        assert_eq!(
            sent["units"][0]["morphTargets"],
            serde_json::json!([{ "into": "armcom1", "morphtime": 10 }])
        );
    }

    #[test]
    fn a_unit_that_morphs_nowhere_sends_an_empty_list() {
        let sent: Value = serde_json::from_str(&check_and_build(&game()).unwrap()).unwrap();
        assert_eq!(sent["units"][0]["morphTargets"], serde_json::json!([]));
    }
```

`game()` at `games.rs:388` builds the fixture, `unit()` at `:370` builds each of its units, and `check_and_build` returns the body as a JSON string. Add `morph_targets: Vec::new()` to `unit()` so the module still compiles.

In `src/hub/games/factsSweep.test.ts`, extend the unit helper at `:35` with a `morphTargets` argument and assert one is carried into the sent facts.

- [ ] **Step 2: Run them to verify they fail**

Run: `cargo test -p tauri-plugin-coilbox-hub morph` and `bunx vitest run src/hub/games/factsSweep.test.ts`
Expected: FAIL, no field `morph_targets`.

- [ ] **Step 3: Carry the field**

In `games.rs`, on `GameUnitFacts` after `build_options`:

```rust
    /// What this unit turns into: a morph, an upgrade, a tech level
    /// (issue #2063). Sent in target order, deduplicated by the shim that read
    /// it, so the hub's digest does not churn on the order two sources happened
    /// to arrive in. Sent even when empty, the way `build_options` is.
    #[serde(default)]
    pub morph_targets: Vec<Map<String, Value>>,
```

Add a check beside the `build_options` length check at `:306` refusing a unit whose morph list is longer than the hub's 64, so a bad read is named here rather than becoming a refusal from the far end.

In `facts.ts`, on `GameUnitFacts`:

```ts
  /** What this unit turns into (issue #2063): one object per edge, each with
   *  `into` and whatever conditions the game declared. The hub stores it as
   *  schemaless JSON and renders what arrives. Sent even when empty. */
  morphTargets: Record<string, unknown>[];
```

In `factsSweep.ts`, inside the unit map:

```ts
        morphTargets: unit.morphTargets ?? [],
```

- [ ] **Step 4: Run the tests**

Run: `cargo test -p tauri-plugin-coilbox-hub && bunx vitest run src/hub/games/`
Expected: PASS.

- [ ] **Step 5: Send one real game**

Run `bun run tauri dev`, run the game facts backfill against a hub with Tasks 6 and 7 deployed, and confirm the run reports accepted rather than refused for a game with morphs. A refusal naming `morphTargets` means the hub is older than this build.

- [ ] **Step 6: Commit**

```bash
git add crates/tauri-plugin-coilbox-hub/src/games.rs src/hub/games/facts.ts src/hub/games/factsSweep.ts src/hub/games/factsSweep.test.ts
git commit -m "Send what a unit turns into with the game's facts"
```

---

### Task 9: The hub groups a unit's stages the way coilbox does

**Files:**
- Modify: `~/dev/coilbox-hub/scripts/sync-vendor.ts:148-158`
- Modify: `~/dev/coilbox-hub/lib/content/bindings.ts`
- Create: `~/dev/coilbox-hub/lib/content/morphGraph.ts` (vendored, never hand edited)

**Interfaces:**
- Consumes: `src/content/morphGraph.ts` from Task 3, on coilbox's main branch.
- Produces: `morphGroups`, `groupOf`, `foldMorphs` and `MorphGroup` in the hub, byte identical to coilbox's.

- [ ] **Step 1: Add the file to the vendor group**

In `scripts/sync-vendor.ts`, in the `src/content` group:

```ts
    files: ["buildTree.ts", "morphGraph.ts"],
```

- [ ] **Step 2: Add the type the vendored file imports**

In `lib/content/bindings.ts`, add `morphTargets` to `UnitDatasetEntry`, copying the comment from coilbox's `src/content/bindings.ts`. This file is an external of the vendor group rather than vendored, so it is edited by hand.

- [ ] **Step 3: Pull the file**

Run: `cd ~/dev/coilbox-hub && bun run sync:vendor`
Expected: `lib/content/morphGraph.ts` appears.

- [ ] **Step 4: Check it stayed identical**

Run: `bun run check:vendor && bun run typecheck`
Expected: PASS. A typecheck failure here means the hub's `bindings.ts` and coilbox's have drifted, which is the check earning its keep.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/coilbox-hub
git add scripts/sync-vendor.ts lib/content/bindings.ts lib/content/morphGraph.ts
git commit -m "Vendor coilbox's morph grouping rather than write a second one"
```

---

### Task 10: The unit grid shows one cell per unit

**Files:**
- Modify: `~/dev/coilbox-hub/lib/games/units.ts:66-107` (`loadUnitGrid`)
- Modify: `~/dev/coilbox-hub/lib/games/units.test.ts`

**Interfaces:**
- Consumes: `morphGroups` and `groupOf` from Task 9, `game_unit.morph_targets` from Task 7.
- Produces: `UnitSummary.stages?: string[]` - the other stages of this cell's group, empty for a unit with none.

- [ ] **Step 1: Write the failing test**

In `lib/games/units.test.ts`, with three rows where `armcom` morphs into `armcom1` and `armcom1` into `armcom2`:

```ts
  it("shows a commander once, with its stages named on the cell", async () => {
    const { units } = await loadUnitGrid(supabase, "ba", filters());
    expect(units.map((u) => u.unit_name)).toEqual(["armcom", "armsolar"]);
    expect(units[0].stages).toEqual(["armcom1", "armcom2"]);
  });

  it("still finds a stage by name", async () => {
    const { units } = await loadUnitGrid(supabase, "ba", filters({ q: "armcom2" }));
    // Searching for a stage lands on the group holding it rather than on
    // nothing, because the grid no longer has a cell of its own for it.
    expect(units.map((u) => u.unit_name)).toEqual(["armcom"]);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/dev/coilbox-hub && bun test lib/games/units.test.ts`
Expected: FAIL, three cells rather than two.

- [ ] **Step 3: Fold the groups into the grid**

`loadUnitGrid` selects `morph_targets` alongside the three columns it reads today, builds `groupOf(morphGroups(rows))` over the game's rows, and drops any row that is not its own base, attaching the rest of its group as `stages`. The paging count comes from the same fold, so a page is a page of units rather than of rows.

Keep the exclusion list and the faction filter applied before the fold. A retired stage stays hidden, and a group whose base is retired is headed by the first living stage, because a cell nobody can open helps nobody.

- [ ] **Step 4: Run the tests**

Run: `bun test lib/games/units.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/coilbox-hub
git add lib/games/units.ts lib/games/units.test.ts
git commit -m "Show a unit's stages as one cell in the encyclopedia grid"
```

---

### Task 11: A unit's page shows its stages

**Files:**
- Modify: `~/dev/coilbox-hub/lib/games/units.ts:328-457` (`UnitPage`, `loadUnitPage`)
- Modify: `~/dev/coilbox-hub/app/games/[shortname]/units/[unit]/page.tsx`
- Modify: `~/dev/coilbox-hub/lib/games/units.test.ts`

**Interfaces:**
- Produces: `UnitPage.stages: { name: string; label: string; current: boolean }[]` and `UnitPage.morph_targets: Record<string, unknown>[]`.

- [ ] **Step 1: Write the failing test**

```ts
  it("lands a stage's own URL on the stage", async () => {
    const page = await loadUnitPage(supabase, "ba", "armcom2");
    expect(page?.unit_name).toBe("armcom2");
    expect(page?.stages.map((s) => s.name)).toEqual(["armcom", "armcom1", "armcom2"]);
    expect(page?.stages.find((s) => s.current)?.name).toBe("armcom2");
  });

  it("says what a stage turns into and what it costs", async () => {
    const page = await loadUnitPage(supabase, "ba", "armcom");
    expect(page?.morph_targets).toEqual([{ into: "armcom1", morphtime: 10 }]);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/dev/coilbox-hub && bun test lib/games/units.test.ts`
Expected: FAIL, `page.stages` is undefined.

- [ ] **Step 3: Write it**

`loadUnitPage` selects `morph_targets` on both the current row and the revision, loads the game's morph graph, and fills `stages` with every stage of the group in group order, marking the one asked for. A stage's own URL keeps working and lands on the stage, which is the point: old links and old replays outlive a change to how the hub groups things.

The page renders the stages as a row of links under the title, and each morph target as its target's display name plus the conditions the game declared, rendered as they arrive.

- [ ] **Step 4: Run the tests**

Run: `bun test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/coilbox-hub
git add lib/games/units.ts lib/games/units.test.ts "app/games/[shortname]/units/[unit]/page.tsx"
git commit -m "Show a unit's stages together on its page"
```

---

### Task 12: The hub's build tree draws one node per unit

**Files:**
- Modify: `~/dev/coilbox-hub/lib/games/tree.ts`
- Modify: `~/dev/coilbox-hub/lib/games/tree.test.ts`
- Modify: `~/dev/coilbox-hub/components/GameTree.tsx`

**Interfaces:**
- Consumes: `foldMorphs` from Task 9.

- [ ] **Step 1: Write the failing test**

In `lib/games/tree.test.ts`, with the same three commander rows:

```ts
  it("draws a commander and its stages as one node", () => {
    const tree = buildTree(rows);
    expect(tree.order).not.toContain("armcom1");
    // What the upgraded commander builds hangs off the commander.
    expect(tree.treeEdges.some((e) => e.parent === "armcom" && e.child === "armlab")).toBe(true);
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd ~/dev/coilbox-hub && bun test lib/games/tree.test.ts`
Expected: FAIL, `armcom1` is in the order.

- [ ] **Step 3: Fold the graph**

In `lib/games/tree.ts`, wrap the edge map the tree is built from in `foldMorphs`, exactly as coilbox's `BuildTreeDrawer` does in Task 5. Label a folded node with its stage count so a reader can see the node stands for more than one def.

- [ ] **Step 4: Run the tests**

Run: `bun test && bun run lint && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd ~/dev/coilbox-hub
git add lib/games/tree.ts lib/games/tree.test.ts components/GameTree.tsx
git commit -m "Draw a unit's morph stages as one node in the game tree"
```

---

## What this plan does not cover

- Beyond All Reason's evolving commanders. BAR spells the same idea as `customparams.evolution_target` and decides it at def load from modoptions, so what a reader sees depends on options nobody set. coilbox#2152 covers finding out what the defaults produce and whether it belongs in this field.
- Zero-K's modular commanders. `unit_commander_upgrade.lua` fits modules to a commander rather than turning one def into another, so it is not a morph edge and nothing here would read it. The `morphto` customparams this plan reads are Zero-K's non-modular ladder.
- Zero-K itself is unverified. No Zero-K archive is installed on the machine this was planned on, so the customparams path is written from reading `LuaRules/Configs/morph_defs.lua` in the repository rather than from a measured run. Task 2 covers four games. Add Zero-K to it if an archive is installed by then.
