# Missions inside a game's own archive: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a game ship missions inside its own archive, packaged or loose, so a scenario can be distributed with the game rather than only as a code, a link or a bundled file.

**Architecture:** A new archive reader in the `coilbox-scenario` plugin lists and reads mission files out of a `.sdd` folder, a `.sdz` zip or a `.sd7` 7-zip. The frontend merges what it finds into the scenario list as a third source, `game`. The launch route stops requiring a writable game when the mission is already in the archive, so a packaged game reaches the adopted route for the first time. A mission in a loose `.sdd` stays editable in place, with the compiled file recompiled from the document before launch.

**Tech Stack:** Rust (Tauri plugin, `zip` 8.6.0, `sevenz-rust2` 0.21.1, `coilbox-springlua`), TypeScript, React, vitest.

**Spec:** `docs/superpowers/specs/2026-08-31-missions-in-game-archives-design.md`

## Global Constraints

- A mission folder counts as a mission when it holds `mission.lua`. `scenario.json` beside it makes it editable and nameable.
- The folder name and the document id are different strings. The folder is what `coilbox_mission` carries. The document keeps its UUID.
- Writes into a game are loose `.sdd` only, under `missions/<folder>/` only, and the folder must be the one the document was read from. No game file is ever deleted by this work.
- The compiled `mission.lua` is always what the engine plays. A loose game recompiles from the document, a packaged one plays what it ships.
- Media is read from the archive, never copied to disk, and held in memory for the session only.
- A new plugin command needs three things or it fails at runtime: the `#[tauri::command]`, an entry in `crates/tauri-plugin-coilbox-scenario/build.rs` COMMANDS, and an `allow-` line in `crates/tauri-plugin-coilbox-scenario/permissions/default.toml`.
- Player-facing wording never names an archive format, a runtime version or the mutator. `src/scenario/wording.test.ts` enforces this.
- Run before pushing: `cargo fmt --all --check`, `cargo clippy --all-targets --all-features -- -D warnings`, `bunx biome ci .`, `bun run typecheck`.

---

### Task 1: Archive reader

Reads mission files out of any of the three game archive kinds. No Tauri, no unitsync, so it is testable on its own.

**Files:**
- Create: `crates/tauri-plugin-coilbox-scenario/src/archive.rs`
- Modify: `crates/tauri-plugin-coilbox-scenario/src/lib.rs` (add `mod archive;` beside `mod mutator;` at line 39)
- Modify: `crates/tauri-plugin-coilbox-scenario/Cargo.toml` (add `zip` and `sevenz-rust2`)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `pub struct GameMissionEntry { pub folder: String, pub has_document: bool, pub has_compiled: bool }`
  - `pub fn list_missions(root: &Path) -> Result<Vec<GameMissionEntry>, String>`
  - `pub fn read_file(root: &Path, folder: &str, file: &str) -> Result<Vec<u8>, String>`

- [ ] **Step 1: Add the dependencies**

In `crates/tauri-plugin-coilbox-scenario/Cargo.toml`, under `[dependencies]`:

```toml
# Reading a game's own missions out of the archive it ships them in. `.sdz` is a
# zip and `.sd7` is 7-zip, the same two readers content and mapconv already use.
zip = { version = "8.6.0", default-features = false, features = ["deflate"] }
sevenz-rust2 = "0.21.1"
```

- [ ] **Step 2: Write the failing tests**

Create `crates/tauri-plugin-coilbox-scenario/src/archive.rs` with only the tests at first:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    /// A loose `.sdd`: one mission with both files, one with only the compiled
    /// file, and a stray file that is not a mission at all.
    fn loose_game() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let missions = dir.path().join("missions");
        std::fs::create_dir_all(missions.join("first-contact")).unwrap();
        std::fs::write(
            missions.join("first-contact/mission.lua"),
            "return { name = \"First contact\" }",
        )
        .unwrap();
        std::fs::write(missions.join("first-contact/scenario.json"), "{}").unwrap();
        std::fs::create_dir_all(missions.join("compiled-only")).unwrap();
        std::fs::write(missions.join("compiled-only/mission.lua"), "return {}").unwrap();
        std::fs::write(missions.join("runtime.lua"), "return { version = 3 }").unwrap();
        dir
    }

    /// The same tree as a `.sdz`.
    fn zipped_game(dir: &Path) -> PathBuf {
        let path = dir.join("game.sdz");
        let file = std::fs::File::create(&path).unwrap();
        let mut zip = zip::ZipWriter::new(file);
        let opts: zip::write::FileOptions<()> = zip::write::FileOptions::default();
        for (name, body) in [
            ("missions/first-contact/mission.lua", "return {}"),
            ("missions/first-contact/scenario.json", "{}"),
            ("missions/compiled-only/mission.lua", "return {}"),
            ("missions/runtime.lua", "return { version = 3 }"),
        ] {
            zip.start_file(name, opts).unwrap();
            zip.write_all(body.as_bytes()).unwrap();
        }
        zip.finish().unwrap();
        path
    }

    /// The same tree as a `.sd7`.
    fn sevenzipped_game(dir: &Path) -> PathBuf {
        let path = dir.join("game.sd7");
        let mut writer = sevenz_rust2::ArchiveWriter::create(&path).unwrap();
        for (name, body) in [
            ("missions/first-contact/mission.lua", "return {}"),
            ("missions/first-contact/scenario.json", "{}"),
            ("missions/compiled-only/mission.lua", "return {}"),
        ] {
            writer
                .push_archive_entry(
                    sevenz_rust2::ArchiveEntry::new_file(name),
                    Some(std::io::Cursor::new(body.as_bytes().to_vec())),
                )
                .unwrap();
        }
        writer.finish().unwrap();
        path
    }

    #[test]
    fn lists_a_loose_games_missions() {
        let game = loose_game();

        let found = list_missions(game.path()).unwrap();

        assert_eq!(found.len(), 2);
        assert_eq!(found[0].folder, "compiled-only");
        assert!(!found[0].has_document);
        assert_eq!(found[1].folder, "first-contact");
        assert!(found[1].has_document);
    }

    #[test]
    fn a_file_beside_the_missions_is_not_a_mission() {
        let game = loose_game();

        let found = list_missions(game.path()).unwrap();

        assert!(found.iter().all(|m| m.folder != "runtime.lua"));
    }

    #[test]
    fn lists_a_packaged_games_missions() {
        let dir = tempfile::tempdir().unwrap();

        for archive in [zipped_game(dir.path()), sevenzipped_game(dir.path())] {
            let found = list_missions(&archive).unwrap();

            assert_eq!(found.len(), 2, "in {}", archive.display());
            assert_eq!(found[1].folder, "first-contact");
            assert!(found[1].has_document);
        }
    }

    #[test]
    fn reads_a_file_out_of_every_kind() {
        let loose = loose_game();
        let dir = tempfile::tempdir().unwrap();

        for root in [
            loose.path().to_path_buf(),
            zipped_game(dir.path()),
            sevenzipped_game(dir.path()),
        ] {
            let bytes = read_file(&root, "first-contact", "scenario.json").unwrap();

            assert_eq!(bytes, b"{}", "in {}", root.display());
        }
    }

    #[test]
    fn refuses_a_path_that_climbs_out() {
        let game = loose_game();

        assert!(read_file(game.path(), "../..", "modinfo.lua").is_err());
        assert!(read_file(game.path(), "first-contact", "../modinfo.lua").is_err());
    }

    #[test]
    fn a_game_with_no_missions_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();

        assert_eq!(list_missions(dir.path()).unwrap(), Vec::new());
    }
}
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cargo test -p tauri-plugin-coilbox-scenario archive`
Expected: FAIL, `cannot find function list_missions in this scope`.

- [ ] **Step 4: Write the reader**

Above the test module in `archive.rs`:

```rust
//! Reading the missions a game ships inside its own archive (issue #2160).
//!
//! A game may carry finished missions of its own, and it may be packaged. The
//! three kinds a game arrives as are a `.sdd` folder, a `.sdz` zip and a `.sd7`
//! 7-zip, so one shape covers all three: list the mission folders, read one file
//! out of one. Nothing here writes, and nothing here needs an engine, so a
//! mission list costs no unitsync scan.

use coilbox_portable::is_safe_rel;
use serde::Serialize;
use std::io::Read;
use std::path::{Path, PathBuf};

/// One mission folder a game ships.
///
/// `has_document` is what decides whether the editor can open it: a mission with
/// only the compiled Lua is playable and never editable, because reconstructing a
/// document out of compiled Lua would be a guess dressed as a source.
#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameMissionEntry {
    pub folder: String,
    pub has_document: bool,
    pub has_compiled: bool,
}

/// The compiled mission every mission folder has to hold to count as one.
const COMPILED: &str = "mission.lua";
/// The document a mission folder holds when it is editable.
const DOCUMENT: &str = "scenario.json";

/// Refuse a folder or file name that could climb out of `missions/`.
fn safe_part(part: &str) -> Result<(), String> {
    if part.is_empty() || !is_safe_rel(Path::new(part)) || part.contains('/') || part.contains('\\')
    {
        return Err(format!("unsafe mission path: {part}"));
    }
    Ok(())
}

/// Every mission folder in the game at `root`, sorted, whether `root` is a loose
/// folder or a packaged archive. A game with no `missions/` has none, which is
/// not an error.
pub fn list_missions(root: &Path) -> Result<Vec<GameMissionEntry>, String> {
    let mut found = if root.is_dir() {
        list_loose(root)
    } else {
        list_packaged(root)?
    };
    found.sort_by(|a, b| a.folder.cmp(&b.folder));
    Ok(found)
}

fn list_loose(root: &Path) -> Vec<GameMissionEntry> {
    let Ok(entries) = std::fs::read_dir(root.join("missions")) else {
        return Vec::new();
    };
    entries
        .flatten()
        .filter(|e| e.path().is_dir())
        .filter_map(|e| e.file_name().to_str().map(str::to_string))
        .filter(|folder| !folder.starts_with('.'))
        .filter(|folder| root.join("missions").join(folder).join(COMPILED).is_file())
        .map(|folder| {
            let has_document = root
                .join("missions")
                .join(&folder)
                .join(DOCUMENT)
                .is_file();
            GameMissionEntry {
                folder,
                has_document,
                has_compiled: true,
            }
        })
        .collect()
}

/// Fold a packaged archive's member names into mission entries. Both archive
/// readers hand back a flat list of paths, so the folding is shared.
fn fold_members(names: impl Iterator<Item = String>) -> Vec<GameMissionEntry> {
    let mut entries: Vec<GameMissionEntry> = Vec::new();
    for name in names {
        let rest = match name.strip_prefix("missions/") {
            Some(rest) => rest,
            None => continue,
        };
        let Some((folder, file)) = rest.split_once('/') else {
            continue;
        };
        if file != COMPILED && file != DOCUMENT {
            continue;
        }
        let at = entries.iter().position(|e| e.folder == folder);
        let entry = match at {
            Some(i) => &mut entries[i],
            None => {
                entries.push(GameMissionEntry {
                    folder: folder.to_string(),
                    has_document: false,
                    has_compiled: false,
                });
                entries.last_mut().expect("just pushed")
            }
        };
        if file == COMPILED {
            entry.has_compiled = true;
        } else {
            entry.has_document = true;
        }
    }
    entries.retain(|e| e.has_compiled);
    entries
}

fn list_packaged(root: &Path) -> Result<Vec<GameMissionEntry>, String> {
    match kind(root) {
        Kind::Zip => {
            let file = std::fs::File::open(root).map_err(|e| format!("{e}"))?;
            let mut zip = zip::ZipArchive::new(file).map_err(|e| format!("{e}"))?;
            let names: Vec<String> = (0..zip.len())
                .filter_map(|i| zip.by_index(i).ok().map(|f| f.name().to_string()))
                .collect();
            Ok(fold_members(names.into_iter()))
        }
        Kind::SevenZip => {
            let archive =
                sevenz_rust2::ArchiveReader::open(root, "".into()).map_err(|e| format!("{e}"))?;
            let names: Vec<String> = archive
                .archive()
                .files
                .iter()
                .map(|f| f.name().replace('\\', "/"))
                .collect();
            Ok(fold_members(names.into_iter()))
        }
        Kind::Unknown => Err(format!("not a game archive: {}", root.display())),
    }
}

enum Kind {
    Zip,
    SevenZip,
    Unknown,
}

/// Which reader an archive needs, by extension. `.sdz` is a zip and `.sd7` is
/// 7-zip, which is what the engine itself goes by.
fn kind(root: &Path) -> Kind {
    match root
        .extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("sdz") => Kind::Zip,
        Some("sd7") => Kind::SevenZip,
        _ => Kind::Unknown,
    }
}

/// One file out of one mission folder, whatever the game is packaged as.
pub fn read_file(root: &Path, folder: &str, file: &str) -> Result<Vec<u8>, String> {
    safe_part(folder)?;
    safe_part(file)?;
    let member = format!("missions/{folder}/{file}");
    if root.is_dir() {
        let path: PathBuf = root.join(&member);
        return std::fs::read(&path).map_err(|e| format!("could not read {member}: {e}"));
    }
    match kind(root) {
        Kind::Zip => {
            let f = std::fs::File::open(root).map_err(|e| format!("{e}"))?;
            let mut zip = zip::ZipArchive::new(f).map_err(|e| format!("{e}"))?;
            let mut entry = zip
                .by_name(&member)
                .map_err(|e| format!("could not read {member}: {e}"))?;
            let mut bytes = Vec::new();
            entry
                .read_to_end(&mut bytes)
                .map_err(|e| format!("could not read {member}: {e}"))?;
            Ok(bytes)
        }
        Kind::SevenZip => sevenz_rust2::decompress_file_to_bytes(root, &member)
            .map_err(|e| format!("could not read {member}: {e}")),
        Kind::Unknown => Err(format!("not a game archive: {}", root.display())),
    }
}
```

If `decompress_file_to_bytes` is not the name in 0.21.1, read the member through `ArchiveReader::open(root, "".into())`, which is the API the listing above already uses.

- [ ] **Step 5: Wire the module in**

In `crates/tauri-plugin-coilbox-scenario/src/lib.rs`, beside `mod mutator;` at line 39:

```rust
mod archive;
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `cargo test -p tauri-plugin-coilbox-scenario archive`
Expected: PASS, 6 tests.

- [ ] **Step 7: Commit**

```bash
git add crates/tauri-plugin-coilbox-scenario/src/archive.rs crates/tauri-plugin-coilbox-scenario/src/lib.rs crates/tauri-plugin-coilbox-scenario/Cargo.toml Cargo.lock
git commit -m "Read a game's own missions out of its archive"
```

---

### Task 2: The two commands and their bindings

**Files:**
- Modify: `crates/tauri-plugin-coilbox-scenario/src/lib.rs` (commands, and the `Builder::new` invoke handler list at the bottom)
- Modify: `crates/tauri-plugin-coilbox-scenario/build.rs:5-24`
- Modify: `crates/tauri-plugin-coilbox-scenario/permissions/default.toml:5-24`
- Modify: `src/scenario/bindings.ts`

**Interfaces:**
- Consumes: `archive::list_missions`, `archive::read_file`, `archive::GameMissionEntry` from Task 1.
- Produces:
  - `scenarioGameMissions({ root }) -> { missions: { folder, hasDocument, hasCompiled }[] }`
  - `scenarioGameMissionFile({ root, folder, file }) -> { base64: string }`

- [ ] **Step 1: Write the commands**

In `lib.rs`, beside the other mission commands:

```rust
/// `scenario_game_missions`, the missions a game ships inside its own archive.
///
/// Unlike [`scenario_list_missions`], which lists what coilbox wrote into a loose
/// game while testing, this reads the game's own content and works on a packaged
/// `.sd7`/`.sdz` too. That is the point: a game can distribute finished missions.
#[tauri::command]
async fn scenario_game_missions(root: String) -> CliResult {
    match archive::list_missions(Path::new(&root)) {
        Ok(missions) => CliResult::ok(json!({ "missions": missions })),
        Err(e) => CliResult::err(e),
    }
}

/// `scenario_game_mission_file`, one file out of one of a game's own missions.
///
/// Base64 because a portrait and a voice clip are binary and this crosses the
/// IPC boundary as JSON. Nothing is written to disk: the caller holds what it
/// needs for the session, which is what keeps a game's media in its archive.
#[tauri::command]
async fn scenario_game_mission_file(root: String, folder: String, file: String) -> CliResult {
    match archive::read_file(Path::new(&root), &folder, &file) {
        Ok(bytes) => CliResult::ok(json!({ "base64": STANDARD.encode(bytes) })),
        Err(e) => CliResult::err(e),
    }
}
```

Add both to the `invoke_handler` list where the plugin is built.

- [ ] **Step 2: Add the ACL entries**

`build.rs`, in COMMANDS:

```rust
    "scenario_game_missions",
    "scenario_game_mission_file",
```

`permissions/default.toml`, in `permissions`:

```toml
  "allow-scenario-game-missions",
  "allow-scenario-game-mission-file",
```

- [ ] **Step 3: Verify it compiles and the ACL is generated**

Run: `cargo clippy -p tauri-plugin-coilbox-scenario --all-targets -- -D warnings`
Expected: PASS. A missing ACL entry does not fail here, so check by eye that both names are in `build.rs` and `permissions/default.toml`. Without them the command exists and the frontend is refused at runtime.

- [ ] **Step 4: Add the bindings**

In `src/scenario/bindings.ts`, following the shape of `scenarioListMissions` at line 213:

```ts
/** One mission a game ships in its own archive. */
export interface GameMissionEntry {
  /** The game's own folder name, which is what `coilbox_mission` carries. */
  folder: string;
  /** True when `scenario.json` is beside the compiled mission, so it can be edited. */
  hasDocument: boolean;
  hasCompiled: boolean;
}

/**
 * The missions a game ships inside its own archive, sorted by folder. Works on a
 * packaged `.sd7`/`.sdz` as well as a loose `.sdd`, unlike
 * {@link scenarioListMissions}, which lists what coilbox wrote while testing.
 */
export const scenarioGameMissions = defineCommand<
  { root: string },
  { missions: GameMissionEntry[] }
>("coilbox-scenario", "scenario_game_missions");

/**
 * One file out of one of a game's own missions, base64 encoded. Nothing is
 * written to disk, so a game's dialogue media stays in its archive.
 */
export const scenarioGameMissionFile = defineCommand<
  { root: string; folder: string; file: string },
  { base64: string }
>("coilbox-scenario", "scenario_game_mission_file");
```

- [ ] **Step 5: Typecheck**

Run: `bun run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/tauri-plugin-coilbox-scenario/src/lib.rs crates/tauri-plugin-coilbox-scenario/build.rs crates/tauri-plugin-coilbox-scenario/permissions/default.toml src/scenario/bindings.ts
git commit -m "Expose a game's own missions to the frontend"
```

---

### Task 3: A game's missions as scenarios

**Files:**
- Create: `src/scenario/gameScenarios.ts`
- Create: `src/scenario/gameScenarios.test.ts`

**Interfaces:**
- Consumes: `scenarioGameMissions`, `scenarioGameMissionFile` from Task 2. `GameItem` from `src/content/bindings`. `isSdd` from `src/content/format`. `parseStoredScenario`, `LoadedScenario` and `GameOrigin` from `src/scenario/storage`.
- Produces:
  - `async function gameScenarios(games: GameItem[]): Promise<LoadedScenario[]>`
  - `async function missionFileUrl(origin: GameOrigin, file: string): Promise<string>` returning a `data:` URI

`GameOrigin` is declared in `storage.ts` beside `LoadedScenario`, not here, because `storage.ts` needs it for that interface and this module needs `parseStoredScenario` from `storage.ts`. Declaring it here would make the two import each other.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("./bindings", () => ({
  scenarioGameMissions: vi.fn(),
  scenarioGameMissionFile: vi.fn(),
}));

import { scenarioGameMissionFile, scenarioGameMissions } from "./bindings";
import { gameScenarios } from "./gameScenarios";

const game = (name: string, archive: string) =>
  ({
    name,
    primaryArchive: { name: archive, path: `/games/${archive}` },
  }) as never;

const document = JSON.stringify({
  id: "6f1c9a4e-3b5d-4c7a-9f21-0e8b7d6a5c43",
  name: "First contact",
  runtimeVersion: 1,
  createdAt: "2026-08-01T00:00:00.000Z",
  updatedAt: "2026-08-01T00:00:00.000Z",
  setup: { gameName: "SplinterFaction", mapName: "AcidicQuarry", participants: [] },
  actors: [],
  groups: [],
  bases: [],
  zones: [],
  triggers: [],
  objectives: [],
  dialogue: [],
  variables: [],
});

describe("a game's own missions", () => {
  it("reads each mission that ships a document", async () => {
    vi.mocked(scenarioGameMissions).mockResolvedValue({
      missions: [
        { folder: "first-contact", hasDocument: true, hasCompiled: true },
        { folder: "compiled-only", hasDocument: false, hasCompiled: true },
      ],
    });
    vi.mocked(scenarioGameMissionFile).mockResolvedValue({
      base64: btoa(document),
    });

    const found = await gameScenarios([game("SplinterFaction", "sf.sdd")]);

    expect(found).toHaveLength(1);
    expect(found[0].source).toBe("game");
    expect(found[0].origin).toEqual({
      gameName: "SplinterFaction",
      archivePath: "/games/sf.sdd",
      folder: "first-contact",
      loose: true,
    });
  });

  it("marks a packaged game's mission as not loose", async () => {
    vi.mocked(scenarioGameMissions).mockResolvedValue({
      missions: [{ folder: "first-contact", hasDocument: true, hasCompiled: true }],
    });
    vi.mocked(scenarioGameMissionFile).mockResolvedValue({
      base64: btoa(document),
    });

    const found = await gameScenarios([game("SplinterFaction", "sf.sd7")]);

    expect(found[0].origin?.loose).toBe(false);
  });

  it("skips a game it cannot read rather than failing the whole list", async () => {
    vi.mocked(scenarioGameMissions).mockRejectedValue(new Error("no such game"));

    await expect(gameScenarios([game("Gone", "gone.sdz")])).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run src/scenario/gameScenarios.test.ts`
Expected: FAIL, cannot resolve `./gameScenarios`.

- [ ] **Step 3: Write the module**

```ts
/**
 * The missions a game ships inside its own archive, read as scenarios (issue
 * #2160).
 *
 * A game that bundles the mission runtime can also bundle finished missions, and
 * those are scenarios like any other: they appear in the same list, play through
 * the same launch, and are shared the same way. What differs is where the
 * document came from and whether it can be written back, which is what
 * {@link GameOrigin} carries.
 *
 * This lives outside the `coilbox-scenario` plugin's own storage because the
 * plugin knows nothing about installed games. `listScenarios` merges the two.
 */

import type { GameItem } from "../content/bindings";
import { isSdd } from "../content/format";
import { scenarioGameMissionFile, scenarioGameMissions } from "./bindings";
import type { GameOrigin, LoadedScenario } from "./storage";
import { parseStoredScenario } from "./storage";

/** Decode a base64 payload to text. */
function text(base64: string): string {
  const binary = atob(base64);
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

/**
 * Every mission every installed game ships, as scenarios.
 *
 * A game that cannot be read is skipped with a warning rather than failing the
 * list, for the same reason one bad stored document does not: a scenario list
 * that refuses to load is worse than one missing an entry.
 */
export async function gameScenarios(
  games: GameItem[],
): Promise<LoadedScenario[]> {
  const found: LoadedScenario[] = [];
  for (const game of games) {
    const archivePath = game.primaryArchive.path;
    if (!archivePath) continue;
    try {
      const { missions } = await scenarioGameMissions({ root: archivePath });
      for (const mission of missions) {
        if (!mission.hasDocument) continue;
        const { base64 } = await scenarioGameMissionFile({
          root: archivePath,
          folder: mission.folder,
          file: "scenario.json",
        });
        const scenario = parseStoredScenario(text(base64));
        if (!scenario) {
          console.warn("skipping invalid mission document", game.name, mission.folder);
          continue;
        }
        found.push({
          scenario,
          source: "game",
          origin: {
            gameName: game.name,
            archivePath,
            folder: mission.folder,
            loose: isSdd(game.primaryArchive),
          },
        });
      }
    } catch (e) {
      console.warn("could not read missions from", game.name, e);
    }
  }
  return found;
}

/**
 * One of a mission's dialogue files as a `data:` URI, for coilbox's own panels.
 * The engine reads the archive itself, so this exists only so the app can draw a
 * portrait. Nothing is written to disk.
 */
export async function missionFileUrl(
  origin: GameOrigin,
  file: string,
): Promise<string> {
  const { base64 } = await scenarioGameMissionFile({
    root: origin.archivePath,
    folder: origin.folder,
    file,
  });
  return `data:application/octet-stream;base64,${base64}`;
}
```

- [ ] **Step 4: Cache what is expensive, and only that**

A `.sd7` is usually solid LZMA, so pulling one member can mean decompressing a large block. Two caches at module scope in `gameScenarios.ts`, both dropped when the app closes and neither written to disk:

```ts
/**
 * A packaged game's mission list, keyed by the archive and what it was when we
 * read it. A packaged archive is one file, so its size and modified time say
 * whether its contents changed. A loose `.sdd` is deliberately absent: a folder's
 * modified time does not move when a file inside it does, and re-reading a
 * directory listing is cheap, which is what makes an edit show up at once.
 */
const packagedLists = new Map<string, { stamp: string; missions: GameMissionEntry[] }>();

/** Files already pulled out of an archive this session, keyed archive + path. */
const files = new Map<string, string>();
```

`missionFileUrl` reads `files` first and fills it on a miss, so a portrait is decompressed once rather than once per redraw.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bunx vitest run src/scenario/gameScenarios.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add src/scenario/gameScenarios.ts src/scenario/gameScenarios.test.ts
git commit -m "Read a game's missions as scenarios"
```

---

### Task 4: The third source, and one rule for editability

**Files:**
- Modify: `src/scenario/storage.ts:28-32` and `:58-72`
- Modify: `src/scenario/scenarios.ts:27` (`useScenarios`, so the list includes games)
- Modify: `src/scenario/pages/ScenarioEditPage.tsx:66` and `:170`
- Test: `src/scenario/storage.test.ts`

**Interfaces:**
- Consumes: `gameScenarios`, `GameOrigin` from Task 3.
- Produces:
  - `LoadedScenario` with `source: "local" | "bundled" | "game"` and `origin?: GameOrigin`
  - `function isEditable(loaded: LoadedScenario): boolean`

- [ ] **Step 1: Write the failing test**

Add to `src/scenario/storage.test.ts`:

```ts
import { isEditable } from "./storage";

describe("what may be edited", () => {
  const doc = { id: "x" } as never;

  it("lets a local scenario be edited", () => {
    expect(isEditable({ scenario: doc, source: "local" })).toBe(true);
  });

  it("refuses a bundled scenario", () => {
    expect(isEditable({ scenario: doc, source: "bundled" })).toBe(false);
  });

  it("lets a mission in a loose game be edited in place", () => {
    expect(
      isEditable({
        scenario: doc,
        source: "game",
        origin: {
          gameName: "SF",
          archivePath: "/games/sf.sdd",
          folder: "first-contact",
          loose: true,
        },
      }),
    ).toBe(true);
  });

  it("refuses a mission in a packaged game", () => {
    expect(
      isEditable({
        scenario: doc,
        source: "game",
        origin: {
          gameName: "SF",
          archivePath: "/games/sf.sd7",
          folder: "first-contact",
          loose: false,
        },
      }),
    ).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run src/scenario/storage.test.ts`
Expected: FAIL, `isEditable` is not exported.

- [ ] **Step 3: Widen the type and add the rule**

In `src/scenario/storage.ts`, replace the interface at line 28:

```ts
/**
 * A parsed scenario plus where it came from. A bundled one is read-only, and so
 * is a game's own mission unless that game is a loose `.sdd`.
 */
export interface LoadedScenario {
  scenario: Scenario;
  source: "local" | "bundled" | "game";
  /** Set only for `source: "game"`. See `gameScenarios.ts`. */
  origin?: GameOrigin;
}

/**
 * Where a game's mission came from, and whether it may be written back. Declared
 * here rather than in `gameScenarios.ts` because that module reads this one, and
 * the reverse would make the two import each other.
 */
export interface GameOrigin {
  gameName: string;
  /** The game folder or archive file, which is what the reader is pointed at. */
  archivePath: string;
  /** The game's own folder name for the mission, which `coilbox_mission` carries. */
  folder: string;
  /** True for a loose `.sdd`, which is the only kind coilbox may write into. */
  loose: boolean;
}

/**
 * Whether the editor may write this scenario back where it came from.
 *
 * One rule in one place, because three pages ask it. A `.sdd` is a development
 * format, so a mission inside one is edited in place. A packaged archive cannot
 * be written into at all, and a bundled scenario belongs to the distribution.
 */
export function isEditable(loaded: LoadedScenario): boolean {
  if (loaded.source === "local") return true;
  if (loaded.source === "game") return loaded.origin?.loose === true;
  return false;
}
```

- [ ] **Step 4: Merge a game's missions into the list**

In `src/scenario/scenarios.ts`, where `useScenarios` calls `listScenarios`, concatenate `await gameScenarios(games)` from the content scan's game list before sorting. `listScenarios` keeps its own sort, so sort the merged list the same way: `updatedAt` descending.

- [ ] **Step 5: Use the rule in the editor**

In `ScenarioEditPage.tsx`, line 66 becomes:

```ts
const stored = loaded && isEditable(loaded) ? loaded.scenario : undefined;
```

and line 170's `loaded?.source === "bundled"` guard becomes `loaded && !isEditable(loaded)`, with the message naming the reason. A bundled scenario says what it says today. A game's packaged mission says "This mission ships inside SplinterFaction, which is packaged, so it cannot be edited here. Share it to make a copy of your own."

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bunx vitest run src/scenario`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/scenario/storage.ts src/scenario/storage.test.ts src/scenario/scenarios.ts src/scenario/pages/ScenarioEditPage.tsx
git commit -m "Give a game's mission a source and one editability rule"
```

---

### Task 5: The launch route stops requiring a writable game

**Files:**
- Modify: `src/scenario/launch.ts:83-109` (`scenarioRoute`) and `:296-411` (`launchScenario`)
- Test: `src/scenario/launch.test.ts`

**Interfaces:**
- Consumes: `LoadedScenario.origin` from Task 4.
- Produces: `scenarioRoute` gains a `missionInGame: boolean` option. `ScenarioLaunchInput` gains `origin?: GameOrigin`.

- [ ] **Step 1: Write the failing test**

Add to `src/scenario/launch.test.ts`:

```ts
it("lets a packaged game play a mission it ships itself", () => {
  const { route } = scenarioRoute({
    game: packagedGame("SplinterFaction"),
    installed: 3,
    required: 3,
    reader: "author",
    missionInGame: true,
  });

  expect(route).toBe("adopted");
});

it("still sends a packaged game to the mutator when the mission is not in it", () => {
  const { route } = scenarioRoute({
    game: packagedGame("SplinterFaction"),
    installed: 3,
    required: 3,
    reader: "author",
    missionInGame: false,
  });

  expect(route).toBe("mutator");
});

it("sends a packaged game to the mutator when its runtime is too old", () => {
  const { route } = scenarioRoute({
    game: packagedGame("SplinterFaction"),
    installed: 1,
    required: 3,
    reader: "author",
    missionInGame: true,
  });

  expect(route).toBe("mutator");
});
```

`packagedGame` is the existing helper in that file for a `.sd7` game. If it is not there, build one the way the file's loose helper does, with `primaryArchive: { name: "sf.sd7", path: "/games/sf.sd7" }`.

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run src/scenario/launch.test.ts`
Expected: FAIL, the packaged game takes the mutator route.

- [ ] **Step 3: Change the route**

In `launch.ts`, `scenarioRoute` takes `missionInGame` and asks the runtime question first:

```ts
export function scenarioRoute(opts: {
  game: GameItem;
  installed: number | null;
  required: number;
  reader: ScenarioReader;
  /**
   * True when the game already carries this mission, which is the case a
   * packaged game can be adopted in: there is nothing to write.
   */
  missionInGame: boolean;
}): RouteChoice {
  const { game, installed, required, reader, missionInGame } = opts;
  const mutator = (reason: string): RouteChoice => ({ route: "mutator", reason });

  if (installed === null) {
    return mutator(unadoptedGameRoute(reader, game.name));
  }
  if (installed < required) {
    return mutator(olderRuntimeRoute(reader, game.name, installed, required));
  }
  // The `.sdd` test is "can coilbox write the mission?", which only matters when
  // the mission is not in the game already.
  if (!missionInGame && (!isSdd(game.primaryArchive) || !game.primaryArchive.path)) {
    return mutator(packagedGameRoute(reader, game.name));
  }
  return { route: "adopted", reason: adoptedGameRoute(reader, game.name, installed) };
}
```

Note the reordering. A packaged game with no runtime now hears "has not adopted the runtime" rather than "is a packaged archive". Both are true and the runtime one is the actionable one, since installing it is what a maintainer does.

`installedRuntime` currently only runs for a loose game (`launch.ts:320`). It has to run for a packaged one too, which means reading `missions/runtime.lua` through the archive reader rather than the folder-rooted one. `safe_part` rejects a folder of `"."`, so add one more command, `scenario_game_runtime(root)`, returning the same `RuntimeMarker` shape `scenario_runtime_status` does. It reads the file through the archive module and evaluates it with `SpringLua::eval_value`. Register it in `build.rs` and `permissions/default.toml` as Task 2 did.

- [ ] **Step 4: Skip the write when the mission is already there**

In `launchScenario`, when `route === "adopted"` and the scenario's `origin` names this game, do not call `writeIntoGame`. Read the compiled mission with `scenarioGameMissionFile({ root, folder, file: "mission.lua" })` and validate the returned text instead, so the rule that nothing launches unvalidated is kept.

The modoption is the folder, not the document id:

```ts
[MISSION_MODOPTION]: origin ? origin.folder : scenario.id,
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bunx vitest run src/scenario/launch.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scenario/launch.ts src/scenario/launch.test.ts crates/tauri-plugin-coilbox-scenario
git commit -m "Let a packaged game play a mission it ships"
```

---

### Task 6: Validate a mission that lives in an archive

**Files:**
- Modify: `crates/tauri-plugin-coilbox-scenario/src/lib.rs:341-354` (`scenario_read_mission`)
- Modify: `src/scenario/validate.ts:803-818` (`validateCompiledMission`)
- Test: `src/scenario/validate.test.ts`

**Interfaces:**
- Consumes: `archive::read_file` from Task 1.
- Produces: `validateCompiledMissionText(missionLua, map?, units?)`, which `validateCompiledMission` becomes a caller of.

- [ ] **Step 1: Write the failing test**

```ts
it("validates a mission it was handed as text", async () => {
  const issues = await validateCompiledMissionText("return { actors = {} }");

  expect(issues).toEqual([]);
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run src/scenario/validate.test.ts`
Expected: FAIL, `validateCompiledMissionText` is not exported.

- [ ] **Step 3: Add the text path**

Add a `scenario_eval_mission(source)` command that calls `SpringLua::eval_value(&source, "mission")` and returns the value, registered in `build.rs` and `permissions/default.toml`. Then in `validate.ts`, split the existing function:

```ts
/** Validate a compiled mission that has already been read, whatever read it. */
export async function validateCompiledMissionText(
  missionLua: string,
  map?: MapExtent,
  units?: { name: string }[],
): Promise<MissionIssue[]> {
  let mission: unknown;
  try {
    ({ mission } = await scenarioEvalMission({ source: missionLua }));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return [{ path: "mission.lua", message }];
  }
  return validateMission(mission, map, units);
}
```

`validateCompiledMission` keeps its signature and its `scenarioReadMission` call, so every existing caller is untouched.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bunx vitest run src/scenario/validate.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scenario/validate.ts src/scenario/validate.test.ts crates/tauri-plugin-coilbox-scenario
git commit -m "Validate a mission read out of an archive"
```

---

### Task 7: Drift, and the loose game correcting itself

**Files:**
- Create: `src/scenario/drift.ts`
- Create: `src/scenario/drift.test.ts`
- Modify: `src/scenario/launch.ts` (call it on the adopted route)

**Interfaces:**
- Consumes: `compileScenario` from `src/scenario/compile`.
- Produces: `function missionDrifted(scenario: Scenario, shipped: string): boolean`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { compileScenario } from "./compile";
import { missionDrifted } from "./drift";

describe("drift", () => {
  it("says a mission compiled from this document has not drifted", () => {
    const scenario = exampleScenario();

    expect(missionDrifted(scenario, compileScenario(scenario))).toBe(false);
  });

  it("says a changed document has drifted from what ships", () => {
    const scenario = exampleScenario();
    const shipped = compileScenario(scenario);

    expect(missionDrifted({ ...scenario, name: "Renamed" }, shipped)).toBe(true);
  });
});
```

Use whichever fixture builder `src/scenario/compile.test.ts` already uses in place of `exampleScenario`, importing it the same way that file does.

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run src/scenario/drift.test.ts`
Expected: FAIL, cannot resolve `./drift`.

- [ ] **Step 3: Write it**

```ts
/**
 * Whether what a game ships still matches the document beside it (issue #2160).
 *
 * The comparison is exact rather than a heuristic, because `compileScenario` is
 * deterministic: array order is document order and author-keyed tables are
 * emitted in sorted key order. So recompiling the document and comparing text is
 * the whole test.
 */

import { compileScenario } from "./compile";
import type { Scenario } from "./model";

export function missionDrifted(scenario: Scenario, shipped: string): boolean {
  return compileScenario(scenario) !== shipped;
}
```

- [ ] **Step 4: Use it on the adopted route**

In `launchScenario`, on the adopted route with an `origin`:

- read `mission.lua` from the archive,
- if `missionDrifted` and `origin.loose`, write the recompiled mission back with the Task 8 command and validate that,
- if `missionDrifted` and not `origin.loose`, launch the shipped text and put the drift in the returned warnings, so an author is told and a player is not.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `bunx vitest run src/scenario/drift.test.ts src/scenario/launch.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/scenario/drift.ts src/scenario/drift.test.ts src/scenario/launch.ts
git commit -m "Correct a loose game's mission when its document has moved on"
```

---

### Task 8: Putting a mission into a game, and taking it out

**Files:**
- Modify: `crates/tauri-plugin-coilbox-scenario/src/lib.rs` (new `scenario_write_game_mission` command)
- Modify: `crates/tauri-plugin-coilbox-scenario/build.rs`, `permissions/default.toml`
- Create: `src/scenario/moveIntoGame.ts`
- Create: `src/scenario/moveIntoGame.test.ts`
- Modify: the editor's Setup card component under `src/scenario/pages/components/`

**Interfaces:**
- Consumes: `saveScenario`, `deleteScenario` from `src/scenario/storage`, `compileScenario` from `src/scenario/compile`, `GameOrigin` from Task 3.
- Produces:
  - `scenarioWriteGameMission({ root, folder, document, mission }) -> { dir: string }`
  - `function missionFolderName(scenarioName: string): string`
  - `async function putMissionInGame(scenario, game): Promise<GameOrigin>`
  - `async function takeMissionOutOfGame(loaded): Promise<Scenario>`

- [ ] **Step 1: Write the failing test for the folder name**

```ts
import { describe, expect, it } from "vitest";
import { missionFolderName } from "./moveIntoGame";

describe("the folder a mission gets in a game", () => {
  it("slugs the scenario's name so it reads as the game's content", () => {
    expect(missionFolderName("Silence the Jericho")).toBe("silence-the-jericho");
  });

  it("never produces something that looks like coilbox's own test folder", () => {
    expect(missionFolderName("6f1c9a4e-3b5d-4c7a-9f21-0e8b7d6a5c43")).toBe(
      "mission-6f1c9a4e-3b5d-4c7a-9f21-0e8b7d6a5c43",
    );
  });

  it("falls back rather than returning an empty folder", () => {
    expect(missionFolderName("!!!")).toBe("mission");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run src/scenario/moveIntoGame.test.ts`
Expected: FAIL, cannot resolve `./moveIntoGame`.

- [ ] **Step 3: Write the slug**

```ts
/**
 * Moving a scenario into a game, and back out (issue #2160).
 *
 * Every scenario is created and imported locally, and nothing infers a home from
 * the game named in its setup: a player with a loose copy of a game would
 * otherwise have their own work written into somebody else's game folder. Moving
 * one in is a deliberate act, and it is a move rather than a copy, so a document
 * has one home and there is no pair to drift.
 */

import { isScenarioId } from "./missions";

/**
 * The folder a mission gets inside a game: a slug of its name.
 *
 * Never a bare UUID. `isScenarioId` reads a UUID folder as coilbox's own test
 * leftover, which Content > Games offers to delete, so a game's real content
 * must never look like one.
 */
export function missionFolderName(scenarioName: string): string {
  const slug = scenarioName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) return "mission";
  return isScenarioId(slug) ? `mission-${slug}` : slug;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bunx vitest run src/scenario/moveIntoGame.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Write the Rust write command**

```rust
/// `scenario_write_game_mission`, writing a mission the author is putting into a
/// game: the document and the compiled mission, under `missions/<folder>/`.
///
/// The fence is the same shape as the test mutator's. A loose `.sdd` only, one
/// folder only, and nothing else in the game is written or removed. A packaged
/// archive fails here, which is what makes a shipped game's missions read-only.
#[tauri::command]
async fn scenario_write_game_mission(
    root: String,
    folder: String,
    document: String,
    mission: String,
) -> CliResult {
    if !valid_id(&folder) {
        return CliResult::err(format!("invalid mission folder: {folder}"));
    }
    let dir = match writable_game_dir(&root) {
        Ok(d) => d,
        Err(e) => return CliResult::err(e),
    };
    let missions = mutator::mission_dir(&dir, &folder);
    if let Err(e) = mutator::write_file(&missions.join("mission.lua"), &mission) {
        return CliResult::err(e);
    }
    if let Err(e) = mutator::write_file(&missions.join("scenario.json"), &document) {
        return CliResult::err(e);
    }
    CliResult::ok(json!({ "dir": missions.to_string_lossy() }))
}
```

Register it in `build.rs` and `permissions/default.toml`, and add the binding beside `scenarioWriteMission` in `src/scenario/bindings.ts`.

- [ ] **Step 6: Write the move**

In `moveIntoGame.ts`:

```ts
/**
 * Put a local scenario into a game: write the document and the compiled mission
 * into `missions/<folder>/`, then delete the local copy, keeping its dialogue
 * clips because the mission still names them.
 */
export async function putMissionInGame(
  scenario: Scenario,
  game: GameItem,
): Promise<GameOrigin> {
  const archivePath = game.primaryArchive.path;
  if (!archivePath || !isSdd(game.primaryArchive)) {
    throw new Error(`${game.name} is packaged, so nothing can be written into it.`);
  }
  const folder = missionFolderName(scenario.name);
  await scenarioWriteGameMission({
    root: archivePath,
    folder,
    document: JSON.stringify(scenario),
    mission: compileScenario(scenario),
  });
  await deleteScenario(scenario.id, { keepMedia: true });
  return { gameName: game.name, archivePath, folder, loose: true };
}

/** The reverse: back to coilbox's store, and the game's folder removed. */
export async function takeMissionOutOfGame(
  loaded: LoadedScenario,
): Promise<Scenario> {
  const origin = loaded.origin;
  if (!origin?.loose) {
    throw new Error("This mission is not in a game coilbox can write to.");
  }
  const saved = await saveScenario(loaded.scenario);
  await scenarioDeleteMission({ root: origin.archivePath, scenarioId: origin.folder });
  return saved;
}
```

Check `deleteScenario`'s actual option name in `src/scenario/storage.ts` before writing this, and match it.

- [ ] **Step 7: Add the action to the editor**

In the editor's Setup card, a button reading **Put this mission in the game**, shown when advanced mode is on, the setup names an installed game, that game is a loose `.sdd`, and the scenario's source is `local`. It asks for the folder name with `missionFolderName(scenario.name)` prefilled, says which folder it will write, and on success routes to the scenario as its new game-sourced self. The reverse button, **Take it out of the game**, appears when the source is `game` and `origin.loose`.

- [ ] **Step 8: Run the suites**

Run: `bunx vitest run src/scenario` and `cargo test -p tauri-plugin-coilbox-scenario`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/scenario/moveIntoGame.ts src/scenario/moveIntoGame.test.ts src/scenario/bindings.ts src/scenario/pages/components crates/tauri-plugin-coilbox-scenario
git commit -m "Move a mission into a game, and back out"
```

---

### Task 9: The mutator stops compiling a mission it was handed

**Files:**
- Modify: `src/scenario/mutator.ts:92-110` (`writeTestMutator`)
- Test: `src/scenario/mutator.test.ts`

**Interfaces:**
- Consumes: `scenarioGameMissionFile` from Task 2.
- Produces: `writeTestMutator` gains an optional `shipped?: string`, used when the mission came out of a game.

- [ ] **Step 1: Write the failing test**

```ts
it("carries a game's own mission across as bytes rather than recompiling it", async () => {
  const shipped = "return { --[[ the game's own ]] }";

  await writeTestMutator("/data", scenario, undefined, undefined, shipped);

  expect(vi.mocked(scenarioTestMutator)).toHaveBeenCalledWith(
    expect.objectContaining({ mission: shipped }),
  );
});
```

Build `scenario` with the same fixture the other tests in that file use.

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run src/scenario/mutator.test.ts`
Expected: FAIL, the compiled document is passed instead.

- [ ] **Step 3: Add the override**

```ts
export async function writeTestMutator(
  dataDir: string,
  scenario: Scenario,
  map?: MapExtent,
  units?: { name: string }[],
  /**
   * The mission text to carry, when it came out of a game rather than from this
   * document. A packaged game may ship `mission.lua` with no document, so there
   * is nothing to compile and the bytes travel as they are.
   */
  shipped?: string,
): Promise<TestMutator> {
  const result = await scenarioTestMutator({
    dataDir,
    scenarioId: scenario.id,
    modinfo: buildMutatorModInfo(scenario.setup.gameName, scenario.name),
    mission: shipped ?? compileScenario(scenario),
  });
  ...
```

The rest of the function is unchanged.

- [ ] **Step 4: Run it to verify it passes**

Run: `bunx vitest run src/scenario/mutator.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scenario/mutator.ts src/scenario/mutator.test.ts
git commit -m "Carry a game's own mission through the mutator unchanged"
```

---

### Task 10: What each reader is told

**Files:**
- Modify: `src/scenario/wording.ts`
- Modify: `src/scenario/wording.test.ts`

**Interfaces:**
- Produces: `gameOwnMissionRoute(reader, gameName)`, `missionDriftedFromDocument(reader, gameName)`

- [ ] **Step 1: Write the failing test**

```ts
it("tells a player a mission comes with the game, and nothing else", () => {
  const said = gameOwnMissionRoute("player", "SplinterFaction");

  expect(said).toContain("comes with SplinterFaction");
  for (const pattern of AUTHOR_ONLY) {
    expect(said).not.toMatch(pattern);
  }
});

it("tells an author which mission the game is playing", () => {
  expect(gameOwnMissionRoute("author", "SplinterFaction")).toContain(
    "ships this mission",
  );
});
```

Add both new sentences to `everything()` so the existing player-wording sweep covers them.

- [ ] **Step 2: Run it to verify it fails**

Run: `bunx vitest run src/scenario/wording.test.ts`
Expected: FAIL, `gameOwnMissionRoute` is not exported.

- [ ] **Step 3: Write the sentences**

```ts
/** A game playing a mission out of its own archive, which needs no write. */
export function gameOwnMissionRoute(
  reader: ScenarioReader,
  gameName: string,
): string {
  return reader === "player"
    ? `This mission comes with ${gameName}, which plays it itself.`
    : `${gameName} ships this mission in its own archive, so it plays it as itself and coilbox writes nothing.`;
}

/**
 * A packaged game whose shipped mission no longer matches the document beside
 * it. Only an author hears this, because a player cannot rebuild somebody else's
 * game.
 */
export function missionDriftedFromDocument(
  reader: ScenarioReader,
  gameName: string,
): string {
  return reader === "player"
    ? ""
    : `The mission ${gameName} ships does not match the document beside it. The shipped mission is what played.`;
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `bunx vitest run src/scenario/wording.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/scenario/wording.ts src/scenario/wording.test.ts
git commit -m "Say what a game shipping its own mission means, to each reader"
```

---

### Task 11: Where a game's missions show

**Files:**
- Modify: `src/scenario/pages/ScenariosPage.tsx` (the badge)
- Modify: `src/scenario/pages/ScenarioBuilderPage.tsx` (Edit gating)
- Modify: `src/content/pages/components/MissionRuntimeSection.tsx` (the game's own missions)

- [ ] **Step 1: Badge a game's mission on the Scenarios page**

Where the list renders the "Bundled" badge, a `source: "game"` row gets the game's name instead: `From SplinterFaction`. Nothing else about the row changes, and Play works exactly as it does for the others.

- [ ] **Step 2: Gate Edit in the builder list**

Edit is rendered when `isEditable(loaded)`. A game's packaged mission keeps Share and loses Edit and Delete, which is what a bundled scenario already does. Delete is never offered for a game's mission, editable or not: taking it out of the game is Task 8's action and it is not a delete.

- [ ] **Step 3: List a game's missions on its Content page**

Under the Mission runtime section, list what `scenarioGameMissions` returns for that game, each by the name in its document, with the folder underneath. A mission with no document is listed by its folder alone. This is display only: no button removes one, because these are the game's content.

- [ ] **Step 4: Check it in the app**

Run: `bun tauri dev`
Then: install the runtime into a loose Splinter Faction, put a mission in it with Task 8's action, confirm it appears under Play > Scenarios badged with the game, plays, and appears on the game's Content page.

- [ ] **Step 5: Commit**

```bash
git add src/scenario/pages src/content/pages/components/MissionRuntimeSection.tsx
git commit -m "Show a game's own missions where scenarios already show"
```

---

### Task 12: The proof

**Files:**
- Create: `scripts/mission-sf-packaged.sh`

- [ ] **Step 1: Write the script**

Following `scripts/mission-sf-proof.sh`, which is the closest existing proof:

1. Copy the loose Splinter Faction checkout to a scratch folder.
2. Install the mission runtime into it and apply `scripts/sf-proof/splinterfaction-guards.patch`.
3. Copy `src/scenario/fixtures/missions/splinter/mission.lua` to `missions/first-contact/mission.lua` and the matching document to `missions/first-contact/scenario.json`.
4. Zip the folder to a `.sd7` with `7zz a`, place it in the scratch content root's `games/`, and remove the loose copy so only the packaged one is installed.
5. Launch headless with `coilbox_mission=first-contact` and assert the mission ran: the runtime's own log lines, `coilbox_mission_over=1`, and no `coilbox-mission-test.sdd` written anywhere.

The last assertion is the one that matters. It is what proves the packaged game took the adopted route rather than the mutator.

- [ ] **Step 2: Run it**

Run: `bash scripts/mission-sf-packaged.sh`
Expected: the mission plays and the script reports no mutator was written. Expected to be run by hand, as the other mission proofs are.

- [ ] **Step 3: Commit**

```bash
git add scripts/mission-sf-packaged.sh
git commit -m "Prove a packaged game plays the mission it ships"
```

---

## Before the PR

- [ ] `cargo fmt --all --check`
- [ ] `cargo clippy --all-targets --all-features -- -D warnings`
- [ ] `bunx biome ci .`
- [ ] `bun run typecheck`
- [ ] `bunx vitest run`
- [ ] Update `docs/scenarios.md`: the "Getting a game to play your scenario properly" section says a packaged game always falls to the mutator, which this work makes untrue. It becomes "a packaged game plays a mission it ships itself, and falls to the mutator for one it does not".
- [ ] Update `docs/mission-runtime.md`'s adoption contract with the mission folder layout a game ships.
- [ ] Close #2160.
