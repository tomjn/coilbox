# Install selection for the hub game catalog: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the game facts sweep publishing a rapid commit snapshot as a game's current release, by deciding from rapid's own tags which installs are public releases.

**Architecture:** A new command in the downloads plugin reads the local `versions.gz` files and answers with the md5s that named tags point at. `gamesToSend` takes that set and skips a `.sdp` install that is not in it. Everything else about the sweep is unchanged.

**Tech Stack:** Rust (Tauri plugin, `flate2`, `tempfile` for tests), TypeScript (vitest), the spec at `docs/superpowers/specs/2026-08-22-game-install-release-pick-design.md`.

## Global Constraints

- Full check suite before any PR: `bun run check` (cargo fmt, clippy, cargo test, biome ci, typecheck, vitest).
- Prefer picoframe components over native elements. This change adds no UI.
- A new plugin command needs three things or it fails at runtime: the name in `build.rs` `COMMANDS`, the function in `invoke_handler`, and `allow-<kebab-name>` in `permissions/default.toml`.
- No second parser. `parse_versions` in `crates/tauri-plugin-coilbox-downloads/src/rapid.rs` is the only thing that reads the rapid line format.
- A named tag is one that does not hold `:git:`.

## File structure

- Modify `crates/tauri-plugin-coilbox-downloads/src/rapid.rs`, for the line format and which tags are releases. Pure, no IO.
- Modify `crates/tauri-plugin-coilbox-downloads/src/lib.rs`, for the command that walks the local rapid tree.
- Modify `crates/tauri-plugin-coilbox-downloads/build.rs` and `permissions/default.toml`, for command registration.
- Modify `src/downloads/bindings.ts`, for the frontend binding.
- Modify `src/content/format.ts`, adding `isSdpName` beside the existing `isSddName`.
- Modify `src/hub/games/factsSweep.ts`, for the rule and the sweep wiring.
- Modify `src/hub/games/factsSweep.test.ts`, for tests of the rule.

---

### Task 1: The rapid parser keeps the md5 and says which tags are releases

**Files:**
- Modify: `crates/tauri-plugin-coilbox-downloads/src/rapid.rs`

**Interfaces:**
- Consumes: nothing.
- Produces: `pub struct Version { pub tag: String, pub md5: String, pub name: String }` and `pub fn release_md5s(body: &str) -> Vec<String>`.

- [ ] **Step 1: Write the failing tests**

Add to the `tests` module in `crates/tauri-plugin-coilbox-downloads/src/rapid.rs`:

```rust
    /// The md5 is the join back to an installed `<md5>.sdp`, so a parser that
    /// drops it cannot tell a release from a commit snapshot.
    #[test]
    fn versions_keep_the_md5_the_pool_names_its_archives_after() {
        let vs = parse_versions("ba:stable,1df3ea4654d1f1f381e3534bfb1cbdb3,,Balanced Annihilation V15.9.8\n");
        assert_eq!(vs[0].md5, "1df3ea4654d1f1f381e3534bfb1cbdb3");
    }

    /// `ba:test` points at the released V15.9.8 while the build *named*
    /// test-7183 is a commit snapshot, which is why this reads the tag and
    /// never the name.
    #[test]
    fn only_named_tags_name_a_release() {
        let body = "ba:git:001edc3f,cc956b0843d10d3689e2558281587c83,,Balanced Annihilation test-7183-001edc3\n\
                    ba:stable,1df3ea4654d1f1f381e3534bfb1cbdb3,,Balanced Annihilation V15.9.8\n\
                    ba:test,dd57d8bc4e04ce8edee09a9cf84bbc04,,Balanced Annihilation V15.9.8\n";
        assert_eq!(
            release_md5s(body),
            vec![
                "1df3ea4654d1f1f381e3534bfb1cbdb3".to_string(),
                "dd57d8bc4e04ce8edee09a9cf84bbc04".to_string(),
            ]
        );
    }

    #[test]
    fn a_repo_of_nothing_but_commits_names_no_release() {
        let body = "ba:git:aaa,1111,,One\nba:git:bbb,2222,,Two\n";
        assert!(release_md5s(body).is_empty());
    }

    #[test]
    fn a_line_with_no_md5_names_no_release() {
        assert!(release_md5s("ba:stable,,,Balanced Annihilation\n").is_empty());
    }
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cargo test -p tauri-plugin-coilbox-downloads rapid`
Expected: FAIL. `no field md5 on type Version` and `cannot find function release_md5s`.

- [ ] **Step 3: Add the field and the function**

In `crates/tauri-plugin-coilbox-downloads/src/rapid.rs`, add the field to `Version`:

```rust
pub struct Version {
    /// Rapid tag passed to `pr-downloader --download-game`, e.g. `bar:test`.
    pub tag: String,
    /// The package's md5, which is also what the pool names its `.sdp` after.
    pub md5: String,
    /// Human-readable long name, e.g. `Beyond all Reason test-11407-03b45b8`.
    pub name: String,
}
```

In `parse_versions`, replace `let _md5 = parts.next();` with a captured value and fill the field:

```rust
            let md5 = parts.next().map(str::trim).unwrap_or_default();
            let _depends = parts.next();
            let name = parts
                .next()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .unwrap_or(tag);
            Some(Version {
                tag: tag.to_string(),
                md5: md5.to_string(),
                name: name.to_string(),
            })
```

Add below `parse_versions`:

```rust
/// The md5s a *named* tag points at, which is what tells a public release from a
/// private build.
///
/// Rapid publishes a tag per commit as `<repo>:git:<sha>` alongside the named
/// ones like `ba:stable`. A package only a commit tag reaches is a snapshot
/// somebody happened to download, and it is not what a game is.
///
/// Deliberately reads the tag rather than the name: `ba:test` currently points
/// at the released V15.9.8 while the build named `test-7183-001edc3` is a
/// snapshot, so matching on the word would get both backwards.
pub fn release_md5s(body: &str) -> Vec<String> {
    parse_versions(body)
        .into_iter()
        .filter(|v| !v.tag.contains(":git:") && !v.md5.is_empty())
        .map(|v| v.md5)
        .collect()
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cargo test -p tauri-plugin-coilbox-downloads rapid`
Expected: PASS, including the pre-existing `parses_repos` and `version_name_falls_back_to_tag` tests.

- [ ] **Step 5: Commit**

```bash
git add crates/tauri-plugin-coilbox-downloads/src/rapid.rs
git commit -m "Keep a rapid package's md5, and say which tags name a release"
```

---

### Task 2: A command that reads the local rapid tags

**Files:**
- Modify: `crates/tauri-plugin-coilbox-downloads/src/lib.rs`
- Modify: `crates/tauri-plugin-coilbox-downloads/build.rs`
- Modify: `crates/tauri-plugin-coilbox-downloads/permissions/default.toml`

**Interfaces:**
- Consumes: `rapid::release_md5s` from Task 1.
- Produces: command `dl_rapid_release_archives`, taking `dataDir: String`, answering `{ "md5s": string[] }`. Also `fn local_release_md5s(data_dir: &Path) -> Vec<String>` for the tests to call without Tauri.

- [ ] **Step 1: Write the failing test**

Add a test module at the end of `crates/tauri-plugin-coilbox-downloads/src/lib.rs`:

```rust
#[cfg(test)]
mod local_rapid_tests {
    use super::local_release_md5s;
    use flate2::write::GzEncoder;
    use flate2::Compression;
    use std::io::Write;
    use std::path::Path;

    /// Rapid writes `<dataDir>/rapid/<host>/<repo>/versions.gz`, and the master
    /// package index sits one level shallower at
    /// `<dataDir>/rapid/<host>/versions.gz`, so both depths have to be found.
    fn write_versions(dir: &Path, body: &str) {
        std::fs::create_dir_all(dir).unwrap();
        let f = std::fs::File::create(dir.join("versions.gz")).unwrap();
        let mut gz = GzEncoder::new(f, Compression::default());
        gz.write_all(body.as_bytes()).unwrap();
        gz.finish().unwrap();
    }

    #[test]
    fn reads_named_tags_from_every_repo_at_either_depth() {
        let tmp = tempfile::tempdir().unwrap();
        let root = tmp.path();
        write_versions(
            &root.join("rapid/repos.springrts.com/ba"),
            "ba:git:001edc3f,cc956b08,,Balanced Annihilation test-7183-001edc3\n\
             ba:stable,1df3ea46,,Balanced Annihilation V15.9.8\n",
        );
        write_versions(
            &root.join("rapid/packages.springrts.com"),
            "pkg:stable,9999abcd,,Some Package\n",
        );

        let mut found = local_release_md5s(root);
        found.sort();
        assert_eq!(found, vec!["1df3ea46".to_string(), "9999abcd".to_string()]);
    }

    #[test]
    fn a_repo_of_nothing_but_commits_contributes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        write_versions(
            &tmp.path().join("rapid/repos.springrts.com/ba"),
            "ba:git:aaa,1111,,One\nba:git:bbb,2222,,Two\n",
        );
        assert!(local_release_md5s(tmp.path()).is_empty());
    }

    /// A machine with no pool is not a failure. It just has no rapid installs
    /// for the rule to judge.
    #[test]
    fn a_data_dir_with_no_rapid_folder_answers_with_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        assert!(local_release_md5s(tmp.path()).is_empty());
    }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cargo test -p tauri-plugin-coilbox-downloads local_rapid`
Expected: FAIL with `cannot find function local_release_md5s`.

- [ ] **Step 3: Write the reader and the command**

Add to `crates/tauri-plugin-coilbox-downloads/src/lib.rs`:

```rust
/// Every md5 a named rapid tag points at, across the pool this data directory
/// holds.
///
/// Walks `<dataDir>/rapid` two levels deep, because a repository's tags live at
/// `rapid/<host>/<repo>/versions.gz` and a master package index at
/// `rapid/<host>/versions.gz`. A file that will not open or will not inflate is
/// passed over rather than failing the read: one unreadable repository should
/// not decide that every other game is a snapshot.
fn local_release_md5s(data_dir: &std::path::Path) -> Vec<String> {
    fn read_one(path: &std::path::Path, into: &mut Vec<String>) {
        let Ok(bytes) = std::fs::read(path) else {
            return;
        };
        let mut body = String::new();
        let mut decoder = flate2::read::GzDecoder::new(&bytes[..]);
        if std::io::Read::read_to_string(&mut decoder, &mut body).is_err() {
            return;
        }
        into.extend(rapid::release_md5s(&body));
    }

    let mut found = Vec::new();
    let Ok(hosts) = std::fs::read_dir(data_dir.join("rapid")) else {
        return found;
    };
    for host in hosts.flatten() {
        let host = host.path();
        if !host.is_dir() {
            continue;
        }
        read_one(&host.join("versions.gz"), &mut found);
        let Ok(repos) = std::fs::read_dir(&host) else {
            continue;
        };
        for repo in repos.flatten() {
            let repo = repo.path();
            if repo.is_dir() {
                read_one(&repo.join("versions.gz"), &mut found);
            }
        }
    }
    found
}

/// `dl_rapid_release_archives` - the md5s of rapid packages a named tag points
/// at, for deciding whether an installed `<md5>.sdp` is a public release or a
/// commit snapshot. See `src/hub/games/factsSweep.ts`.
#[tauri::command]
async fn dl_rapid_release_archives(data_dir: String) -> CliResult {
    if data_dir.trim().is_empty() {
        return CliResult::err("data_dir is required");
    }
    let md5s = local_release_md5s(std::path::Path::new(&data_dir));
    CliResult::ok(json!({ "md5s": md5s }))
}
```

Add `dl_rapid_release_archives` to the `invoke_handler` list in the same file, after `dl_fetch_text`.

- [ ] **Step 4: Register the command**

In `crates/tauri-plugin-coilbox-downloads/build.rs`, add `"dl_rapid_release_archives",` to the end of `COMMANDS`.

In `crates/tauri-plugin-coilbox-downloads/permissions/default.toml`, add `"allow-dl-rapid-release-archives",` to the end of `permissions`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `cargo test -p tauri-plugin-coilbox-downloads`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add crates/tauri-plugin-coilbox-downloads/src/lib.rs crates/tauri-plugin-coilbox-downloads/build.rs crates/tauri-plugin-coilbox-downloads/permissions/
git commit -m "Read which rapid packages this machine holds as releases"
```

---

### Task 3: The sweep refuses a snapshot install

**Files:**
- Modify: `src/downloads/bindings.ts`
- Modify: `src/content/format.ts`
- Modify: `src/hub/games/factsSweep.ts`
- Test: `src/hub/games/factsSweep.test.ts`

**Interfaces:**
- Consumes: command `dl_rapid_release_archives` from Task 2.
- Produces: `isSdpName(name?: string): boolean`, `dlRapidReleaseArchives`, `gamesToSend(games, releaseMd5s: ReadonlySet<string>)`, and `GameSweepTools.releases`.

- [ ] **Step 1: Write the failing tests**

In `src/hub/games/factsSweep.test.ts`, add to the `gamesToSend` describe block:

```ts
  /// A commit snapshot is a private build. It never speaks for a game, even
  /// when it is the only install, because the catalog describes a game as its
  /// players know it.
  it("skips a rapid install no named tag points at, and sends nothing in its place", () => {
    const { sendable, skipped } = gamesToSend(
      [
        game("Beyond All Reason test-30922", "ded9b29714a05164.sdp", {
          shortname: "BYAR",
        }),
      ],
      new Set<string>(),
    );

    expect(sendable).toEqual([]);
    expect(skipped).toEqual([
      { game: "Beyond All Reason test-30922", reason: "snapshot-build" },
    ]);
  });

  /// Rapid is how most people install Beyond All Reason, so a rule that refused
  /// every pool install would keep the largest game out of the catalog.
  it("sends a rapid install a named tag points at", () => {
    const { sendable } = gamesToSend(
      [
        game("Beyond All Reason 1.2.3", "ded9b29714a05164.sdp", {
          shortname: "BYAR",
        }),
      ],
      new Set(["ded9b29714a05164"]),
    );

    expect(sendable.map((s) => s.game.name)).toEqual([
      "Beyond All Reason 1.2.3",
    ]);
  });

  /// The bug this rule exists for: a name holding `test-` beats a tagged
  /// version under a plain string comparison, because `t` sorts above `V`.
  it("prefers the packaged release over a snapshot whatever the two names sort like", () => {
    const { sendable, skipped } = gamesToSend(
      [
        game("Balanced Annihilation test-7183-001edc3", "cc956b0843d10d36.sdp"),
        game("Balanced Annihilation V15.9.8", "balanced_annihilation-v15.9.8.sdz"),
      ],
      new Set<string>(),
    );

    expect(sendable.map((s) => s.game.name)).toEqual([
      "Balanced Annihilation V15.9.8",
    ]);
    expect(skipped).toEqual([
      {
        game: "Balanced Annihilation test-7183-001edc3",
        reason: "snapshot-build",
      },
    ]);
  });
```

Update the four existing `gamesToSend(...)` calls in that file to pass a second argument of `new Set<string>()`. None of them use a `.sdp`, so the rule does not change their outcome.

In the `tools()` helper in the same file, add the new call so the sweep can run:

```ts
    releases: vi.fn(async () => ({
      md5s: [],
    })) as unknown as GameSweepTools["releases"],
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bunx vitest run src/hub/games/factsSweep.test.ts`
Expected: FAIL. TypeScript rejects the second argument and `snapshot-build` is not a `GameSkipReason`.

- [ ] **Step 3: Add `isSdpName`**

In `src/content/format.ts`, directly below `isSddName`:

```ts
/** Whether an archive name is a rapid pool package, which is named after its md5. */
export function isSdpName(name?: string): boolean {
  return !!name && name.toLowerCase().endsWith(".sdp");
}
```

- [ ] **Step 4: Add the binding**

In `src/downloads/bindings.ts`, below `dlVersions`:

```ts
/**
 * The md5s of rapid packages a named tag points at, read off this machine's
 * pool. An installed `<md5>.sdp` missing from this is a commit snapshot.
 */
export const dlRapidReleaseArchives = defineCommand<
  { dataDir: string },
  { md5s: string[] }
>("coilbox-downloads", "dl_rapid_release_archives");
```

- [ ] **Step 5: Add the rule**

In `src/hub/games/factsSweep.ts`, add to the `GameSkipReason` union, below `"development-folder"`:

```ts
  /** A rapid commit snapshot, which is a private build rather than a release. */
  | "snapshot-build"
```

Change the `@/content/format` import to `import { isSddName, isSdpName } from "@/content/format";` and import `dlRapidReleaseArchives` from `@/downloads/bindings`.

Change the signature, and add the check after the version check and before the one-install-per-shortname block:

```ts
export function gamesToSend(
  games: readonly GameItem[],
  releaseMd5s: ReadonlySet<string>,
): {
```

```ts
    // A rapid package is a release only when a named tag points at it. Rapid
    // publishes one tag per commit, and a package only a commit tag reaches is
    // somebody's snapshot rather than what the game is. Reading the tag is the
    // point: `ba:test` names the released V15.9.8 while the build called
    // `test-7183-001edc3` is the snapshot.
    const archive = game.primaryArchive?.name ?? "";
    if (
      isSdpName(archive) &&
      !releaseMd5s.has(archive.slice(0, -4).toLowerCase())
    ) {
      skipped.push({ game: game.name, reason: "snapshot-build" });
      continue;
    }
```

Add to `GameSweepTools`:

```ts
  releases: typeof dlRapidReleaseArchives;
```

Add to `liveGameSweepTools`:

```ts
  releases: dlRapidReleaseArchives,
```

In `sweepGameFacts`, replace the scan block:

```ts
  onProgress({ phase: "scanning", done: 0, total: 0 });
  const { md5s } = await tools.releases({ dataDir });
  const scanned = await tools.scan({ enginePath, dataDir });
  const { sendable, skipped } = gamesToSend(
    scanned.games,
    new Set(md5s.map((m) => m.toLowerCase())),
  );
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `bunx vitest run src/hub/games/factsSweep.test.ts`
Expected: PASS.

- [ ] **Step 7: Correct the docstring that is now wrong**

The block comment at the top of `src/hub/games/factsSweep.ts` lists what stops a game being sent. Add the snapshot rule to it.

Correct the "One install per game" section in the same comment. Its claim that the choice is made "by archive name" does not match the code and never did, which is part of how this bug survived. Say that the choice is the greatest game name, and that it only ever chooses between releases now.

- [ ] **Step 8: Commit**

```bash
git add src/content/format.ts src/downloads/bindings.ts src/hub/games/factsSweep.ts src/hub/games/factsSweep.test.ts
git commit -m "Never let a rapid commit snapshot speak for a game"
```

---

### Task 4: Verify against a real library and the full suite

**Files:** none changed unless a check fails.

- [ ] **Step 1: Run the full check suite**

Run: `bun run check`
Expected: PASS on all six. This is the gate CI applies.

- [ ] **Step 2: Rebuild so the app carries the new command**

The command lives in Rust, so a running `bun tauri dev` will not have it until the Rust half rebuilds. Confirm the dev app has restarted before the next step.

- [ ] **Step 3: Check the rule against the machine's own games**

In the running app, run the scan and the split without sending anything:

```js
window.__s = 'pending';
Promise.all([
  import('/src/content/bindings.ts'),
  import('/src/downloads/bindings.ts'),
  import('/src/hub/games/factsSweep.ts'),
]).then(([b, d, m]) =>
  Promise.all([
    b.unitsyncScan({ enginePath: '/Users/tomjn/.spring', dataDir: '/Users/tomjn/.spring' }),
    d.dlRapidReleaseArchives({ dataDir: '/Users/tomjn/.spring' }),
  ]).then(([r, rel]) => {
    const split = m.gamesToSend(r.games, new Set(rel.md5s.map((x) => x.toLowerCase())));
    window.__s = JSON.stringify({
      releases: rel.md5s.length,
      sendable: split.sendable.map((s) => ({ name: s.game.name, release: s.release })),
      skipped: split.skipped,
    });
  }),
).catch((e) => { window.__s = 'ERR: ' + (e && e.message ? e.message : String(e)); });
'started'
```

Expected, from the spec:

- Balanced Annihilation is sent as `V15.9.8`, not `test-7183-001edc3`
- XTA is sent as `9.728`, not `test-1274-006fa06`
- Beyond All Reason is skipped as `snapshot-build`
- sendable is 8 games, down from 9
- both `.sdd` folders are still skipped as `development-folder`

If any of those differs, stop and report it rather than adjusting the expectation.

- [ ] **Step 4: Open the PR**

Push the branch and open a pull request against the issue filed for this defect. Do not create the PR until the description has been approved.
