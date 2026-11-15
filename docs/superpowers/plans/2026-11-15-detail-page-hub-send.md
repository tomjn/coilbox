# Detail page hub send implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A "Send to hub" button on map and game detail pages that sends one item, with its pictures, under a one-off grant, with progress in the top bar.

**Architecture:** Rust mints an in-memory grant scoped to one subject and accepts it in place of the switch-based consent. The frontend threads the grant through the existing sweeps, which already handle one game (`only`) and gain one map. `runningUploads` becomes the list of hub sends that the top bar badge shows.

**Tech Stack:** Rust (Tauri plugin `coilbox-hub`), React + TypeScript, vitest, Laravel (hub).

**Spec:** `docs/superpowers/specs/2026-11-15-detail-page-hub-send-design.md`

## Global Constraints

- The asset uploads switch (`hub.assetUploads`) does not gate a manual send. The profile's `hub: false` or `hubAssetUploads: false` does.
- A grant covers one subject: `{ kind: "game", shortname }` compared ignoring case, or `{ kind: "map", map_name }` compared exactly.
- Every user-facing string goes through Lingui (`t`, `msg`, `Plural`).
- UI uses `@picoframe/frame` `Button` and registry components. No native form elements.
- No agent sends to `hub.coilbox.org`.
- New Tauri commands go in `build.rs` `COMMANDS` and the plugin's default permission set.

## Review Focus

- Two sends at once for different subjects: each grant admits only its own subject, and ending one leaves the other working.
- A send stopped from the badge mid draw: the grant ends, and the button comes back on the page.
- Leaving the detail page and coming back during a send: the page shows Sending, read from the store by subject.
- A hub without `releases`: the game button shows rather than claiming the game is on the hub.
- Signed out with the popover open, then sign-in fails or is cancelled: no send starts, and the popover stays open.

---

### Task 1: Rust grant

**Files:**
- Modify: `crates/tauri-plugin-coilbox-hub/src/consent.rs`
- Modify: `crates/tauri-plugin-coilbox-hub/src/{have,upload,maps,games}.rs` (call the subject check at the top of `have`, `upload_all`, `have_maps`, `publish_maps`, `publish_game_facts`)
- Modify: `crates/tauri-plugin-coilbox-hub/src/lib.rs`, `build.rs`, `permissions/default.toml`

**Interfaces:**
- Produces: commands `hub_manual_send_begin(subject: SendSubject) -> { grant: string }` and `hub_manual_send_end(grant: string) -> {}`. The five send commands take `grant: Option<String>`.
- `SendSubject` serde: `#[serde(tag = "kind", rename_all = "snake_case")] enum SendSubject { Game { shortname }, Map { map_name } }`.

- [ ] Step 1: Write the tests in `consent.rs`.
  - `profile_permits(None) == true`
  - `profile_permits(Some(r#"{"hubAssetUploads":false}"#)) == false`
  - A proof for `Game{shortname:"SF"}` admits a unit identity with `game:"sf"` and refuses `game:"ba"`.
  - A map proof admits its own `map_name` and refuses another.
  - A switch proof (`for_test()`) admits everything.
  - `begin` then `end` then `check(Some(id))` returns an error.
- [ ] Step 2: Run `cargo test -p tauri-plugin-coilbox-hub consent` and check it fails.
- [ ] Step 3: Implement the grant.
  - `AssetUploadConsent(Option<SendSubject>)`
  - `check(app, grant: Option<&str>)`
  - `fn profile_permits(profile_json) -> bool`, split out of `permitted`
  - The grant registry: `OnceLock<Mutex<HashMap<String, SendSubject>>>`, with ids from `uuid` if it is already a dependency, otherwise random hex from `rand` if present. Check `Cargo.toml` and do not add a dependency.
  - `begin_grant(app, subject) -> Result<String,String>` and `end_grant(id)`
  - The admits methods: `admits_assets(&[&AssetIdentity])`, `admits_map(&str)` and `admits_game(&str) -> Result<(), String>`, with the refusal text from the spec.
  - Rewrite the module docs.
- [ ] Step 4: Add the admits call at the top of each of the five module functions. Rename `_consent` to `consent`.
- [ ] Step 5: Add the two commands and the `grant` argument to `lib.rs`. Register them in `build.rs` and `default.toml`.
- [ ] Step 6: Run `cargo test -p tauri-plugin-coilbox-hub` and `cargo clippy -p tauri-plugin-coilbox-hub --all-targets -- -D warnings`. Both should pass.
- [ ] Step 7: Commit with the message "Let one manual send to the hub stand in for the uploads switch".

### Task 2: Grant through the frontend send path

**Files:**
- Modify: `src/hub/sweepFrame.ts` (`HubSweepTarget.grant?: string`)
- Modify: `src/hub/assets/have.ts`, `src/hub/assets/upload.ts`, `src/hub/maps/catalog.ts`, `src/hub/games/facts.ts` (an optional `grant` passed to the command)
- Modify: `src/hub/assets/pictureSweep.ts`, `src/hub/assets/blueprintBackfill.ts`, `src/hub/maps/catalogSweep.ts`, `src/hub/maps/pictureSweep.ts` (pass `target.grant` to every tool call)
- Create: `src/hub/manualSend/grant.ts`
- Test: the existing `*.test.ts` beside each sweep

**Interfaces:**
- Produces: `beginManualSend(subject: SendSubject): Promise<string>`, `endManualSend(grant: string): Promise<void>` and `type SendSubject = { kind: "game"; shortname: string } | { kind: "map"; map_name: string }`.
- `assetsTheHubWants(hubUrl, keys, grant?)`, `uploadAssetsToHub(hubUrl, assets, { ...options, grant?, })`, `mapsTheHubWants(hubUrl, keys, onProgress, grant?)`, `publishMapFacts(hubUrl, entries, onProgress, grant?)`, `publishGameFacts(hubUrl, game, grant?)`.
- The backfill target gains `grant?: string` and `opId?: string`. With `opId` set, the backfill uses it instead of minting one.

- [ ] Step 1: Write the tests.
  - `sweepGamePictures` with `grant: "g1"`: every stub `ask`, `upload`, `publishFacts` and `fill` call receives `"g1"`.
  - The same check for `sweepMapCatalog` and `sweepMapPictures`.
  - `backfillBlueprintUnits` with `opId: "op1"` calls `showUploadRun` with `opId: "op1"`.
- [ ] Step 2: Run `bun run test src/hub` and check they fail.
- [ ] Step 3: Implement the threading and `grant.ts`, using `defineCommand` as `catalog.ts` does.
- [ ] Step 4: Run `bun run test src/hub` and `bun run typecheck`. Both should pass.
- [ ] Step 5: Commit with the message "Carry a manual send's grant through the hub sweeps".

### Task 3: Hub sends in the top bar

**Files:**
- Modify: `src/hub/assets/runningUploads.ts`, `src/hub/assets/UploadRunBadge.tsx`, and every `showUploadRun` and `.game` caller (grep)
- Test: `src/hub/assets/runningUploads.test.ts`

**Interfaces:**
- `RunningUpload` changes:
  - `game` is renamed to `subject`.
  - `kind: "pictures" | "game" | "map"` is added. `"pictures"` is an automatic backfill.
  - `UploadRunPhase` is now `"reading" | "drawing" | "sending"`.
- `showUploadRun({ opId, subject, total, phase?, kind? })`: an existing entry keeps its `kind` and `subject` and takes the new phase and total.
- `runningSendFor(kind: "game" | "map", subject: string): RunningUpload | undefined`, plus a hook `useRunningSendFor(kind, subject)`.

- [ ] Step 1: Write the tests.
  - Showing `op1` as `{kind:"game", subject:"SF", phase:"reading"}` and then `showUploadRun({opId:"op1", subject:"x", total:5})` leaves one row with `kind:"game"`, `subject:"SF"`, `phase:"drawing"` and `total:5`.
  - `runningSendFor("game","SF")` finds it.
- [ ] Step 2: Run the tests and check they fail.
- [ ] Step 3: Implement the store change, then update the badge.
  - The row text is "Reading {subject}" for `reading`. For `drawing` and `sending`, keep today's sentences with `{subject}`.
  - The trigger label is "Sending to hub" when any run has a `kind` other than `pictures`. Otherwise it keeps the current labels.
- [ ] Step 4: Run `bun run test src/hub` and `bun run typecheck`. Both should pass.
- [ ] Step 5: Commit with the message "Show manual hub sends in the top bar's upload badge".

### Task 4: Send one map

**Files:**
- Modify: `src/hub/maps/pictureSweep.ts` (`MapPictureSweepTarget.only?: string`, passed as `maps: [only]` to the survey)
- Create: `src/hub/maps/sendOne.ts`, `src/hub/maps/sendOne.test.ts`

**Interfaces:**
- `sendOneMap(target: HubSweepTarget & { mapName: string }, onPhase: (phase: UploadRunPhase, done: number, total: number) => void, tools?: SendOneMapTools): Promise<{ factsSent: boolean; pictureSent: boolean; problem: string | null }>`
- `SendOneMapTools = { catalog, ask, send, pictures: typeof sweepMapPictures }`

- [ ] Step 1: Write the tests.
  - Have says `have`: the facts are not sent, and the pictures still run with `only: mapName`.
  - Have says `missing`: the full entry is read with `maps:[mapName], keysOnly:false` and sent.
  - A catalog that returns no row gives a `problem` naming the map.
  - A `refused` submit outcome becomes `problem`.
- [ ] Step 2: Run the tests and check they fail.
- [ ] Step 3: Implement `only` in `sweepMapPictures` and `sendOneMap`. Export `readMapCatalog` from `catalogSweep.ts` for reuse.
- [ ] Step 4: Run the tests. They should pass.
- [ ] Step 5: Commit with the message "Send one map's facts and minimap to the hub".

### Task 5: The manual send runner

**Files:**
- Create: `src/hub/manualSend/run.ts`, `src/hub/manualSend/run.test.ts`

**Interfaces:**
- `startManualSend(req: { hubUrl, enginePath, dataDir, subject: SendSubject, label: string }, tools?: ManualSendTools): Promise<void>`. It never throws and reports through a toast.
- `ManualSendTools = { begin, end, sweepGame: typeof sweepGamePictures, sendMap: typeof sendOneMap, toast, after: (subject) => void }`.

What it does, in order:
1. Begin the grant, then `showUploadRun({ opId, subject: label, kind, phase: "reading", total: 0 })`.
2. Run the sweep or `sendOneMap` with `grant` and `opId`.
3. Toast "Sent {label} to the hub", or the sweep's `stopped`, or the failure text.
4. In `finally`, `hideUploadRun` then `endManualSend`, and call `after`. `after` resets `resetHubGames()` or forgets the known map.

A send already running for the subject is a no-op. Use the existing toast helper: grep `toast` in `src/hub` and copy the pattern.

- [ ] Step 1: Write the tests.
  - Success ends the grant and hides the run.
  - A throwing sweep still ends the grant and toasts the error.
  - A second start for the same subject while the first runs calls `begin` once.
  - A grant refusal shows a toast and never shows a run.
- [ ] Step 2: Run the tests and check they fail.
- [ ] Step 3: Implement it. Add `forgetKnownMap(name)` to `src/hub/maps/knownMaps.ts`.
- [ ] Step 4: Run the tests. They should pass.
- [ ] Step 5: Commit with the message "Run a manual hub send in the background".

### Task 6: The control on the detail pages

**Files:**
- Modify: `src/hub/api.ts` (`HubGame.releases?: string[]`)
- Create: `src/hub/manualSend/status.ts` and its `status.test.ts`, and `src/hub/manualSend/HubSendControl.tsx`
- Modify: `src/content/pages/components/GameHeader.tsx` (a `hubAction?: ReactNode` beside Play), `src/content/pages/GameDetailPage.tsx`, `src/content/pages/MapDetailPage.tsx`

**Interfaces:**
- `type HubPresence = { state: "unknown" } | { state: "missing" } | { state: "present"; url: string }`
- `gamePresence(hubUrl, games: HubGame[] | null, shortname, release): HubPresence`
- `mapPresence(hubUrl, facts: MapFacts | null | undefined, hasMinimap: boolean | undefined): HubPresence`
- `<HubSendControl subject={SendSubject} label={string} presence={HubPresence} />` reads `useRunningSendFor`, `useHubAccount`, `useHubUrl` and the library target (copy how `GamePicturesControl` gets `enginePath` and `dataDir`).

- [ ] Step 1: Write the tests for `status.ts`.
  - Games `null` gives `unknown`.
  - Shortname absent gives `missing`.
  - `releases` absent gives `missing`.
  - `releases` holding the version, matched exactly, gives `present` with the url `<hub>/games/<shortname>`.
  - A map with facts and a minimap gives `present` with the url `<hub>/map/<slug>`.
  - Facts `null` gives `missing`.
  - Facts with no minimap gives `missing`.
  - Either one still `undefined` gives `unknown`.
- [ ] Step 2: Run the tests and check they fail.
- [ ] Step 3: Implement `status.ts` and `HubSendControl`. The control renders like this:
  - `unknown`: renders nothing.
  - `missing`: `Button variant="outline" size="sm"` holding `CoilboxGlyph size={16}`, the text "Send to hub" and `ArrowUp size={16}`.
  - Running: disabled, reading "Sending…".
  - `present`: a link "On the hub" opened with the opener plugin, as `hubAuthorMapsUrl` is opened.
  - Signed out: a `Popover` with `SignInButton`. A `useEffect` starts the send once the account reads as signed in while the popover is open.
- [ ] Step 4: Wire the control into both pages, on these conditions:
  - Map: only when `isHubEnabled()`. Presence comes from `knownMap` and `fetchHubPictures` for `minimapKey`'s identity.
  - Game: only when `isHubEnabled()` and `gamesToSend([game], releaseMd5s)` keeps it. Take `releaseMd5s` from `dlRapidReleaseArchives`, as the sweeps do. Presence comes from `useHubGames()`.
- [ ] Step 5: Run `bun run test`, `bun run typecheck` and `bunx biome ci .`. All three should pass.
- [ ] Step 6: Commit with the message "Offer to send a map or game to the hub from its detail page".

### Task 7: Releases in the hub's games list (`~/dev/coilbox-hub`)

**Files:**
- Modify: `hub-php/app/Domain/Games/GameList.php` and the query feeding it (`Query::fetchGames`). Read `game_version.version` per game, ordered by `last_seen_at` descending, in one read rather than one read per game.
- Modify: `lib/api/gameList.ts` and its loader in the Next app, with the same field.
- Test: the PHPUnit test for `GameList`.

- [ ] Step 1: Write the PHPUnit test. `GameList::body` passes `releases` through, and a game with none gives `[]`.
- [ ] Step 2: Run `php artisan test --filter GameList` and check it fails.
- [ ] Step 3: Implement it in PHP and in Next.
- [ ] Step 4: Run `php artisan test`, plus the Next typecheck and tests. All should pass.
- [ ] Step 5: Branch, commit and open a PR in `coilbox-hub`.

### Task 8: Verify

- [ ] Run `bun run check`. All eight commands should pass.
- [ ] Start a seeded portable instance on its own MCP socket, with `multiplayer.autoConnect` false. Screenshot the control on a map page and a game page. Do not press send against the live hub.
- [ ] Ask the user to test with `bun tauri dev` before filing the PR.
