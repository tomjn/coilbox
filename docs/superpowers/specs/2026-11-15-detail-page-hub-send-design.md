# Send a game or map to the hub from its detail page

## Why

Sending game or map data to the hub is only reachable through Community > Share > "Share your maps and games", and that panel walks the whole library. Somebody looking at one map or game has no way to see whether the hub has it, or to send just that one.

## What the user sees

The map detail page and the game detail page each get a hub control in their header.

- Map page: in the action row of `src/content/pages/MapDetailPage.tsx`, after "Replays on this map".
- Game page: beside Play in `src/content/pages/components/GameHeader.tsx`, passed in as a new optional `hubAction` node so the header stays unaware of the hub.

The control has four states.

| State | Shown |
|---|---|
| Checking, or the hub cannot be reached | Nothing |
| Missing | Outline button "Send to hub", `CoilboxGlyph` on the left, lucide `ArrowUp` on the right |
| Sending | The same button, disabled, reading "Sending…" |
| On the hub | No send control. A game's Links section starts with an outline "Coilbox hub" button, and a map's action row has "Visit hub page". Both open the hub page in the browser |

The control is not shown when the hub is turned off by the profile (`isHubEnabled`), for a loose `.sdd` game, or for a game install that `gamesToSend` would not pick (a snapshot build, no shortname, no release, or another install of the same shortname wins).

### When a map counts as on the hub

The anonymous `POST /api/v1/maps/lookup` returns facts for the map name, and the anonymous `POST /api/v1/assets/pictures` returns a minimap for it. Missing either one shows the button. The hub page is `<hub>/map/<slug>`, with the slug from the lookup.

A map whose archive differs from the hub's copy under the same name still reads as on the hub. Telling those apart needs `maps/have`, which is signed in. That is a known gap, not a goal here.

### When a game counts as on the hub

`GET /api/v1/games` lists the game's shortname and the new `releases` field includes this install's modinfo version. A hub that predates `releases` is taken at its listing: a listed shortname reads as on the hub, so the button does not appear for every game the hub plainly has. The hub page is `<hub>/games/<shortname>`.

The games list is cached per hub address by `src/hub/gameIcons.ts`. A finished send calls `resetHubGames()` so the page re-checks.

## Clicking the button

1. Signed in: the send starts.
2. Not signed in: a popover anchored to the button shows `SignInButton` from `src/hub/pages/components/AccountControl.tsx`. Once the account reads as signed in, the popover closes and the send starts.

The asset uploads switch (`hub.assetUploads`) plays no part. It stays the switch for automatic sends: the sweeps and the blueprint backfill. Pressing the button is the user's agreement to that one send.

## Consent in Rust: a grant for one send

`crates/tauri-plugin-coilbox-hub/src/consent.rs` makes `AssetUploadConsent` the only way to reach a send, and builds it only from the switch on disk. A manual send needs a second way in that keeps the rest of that file's promise: one send, one subject, nothing left behind.

New command `hub_manual_send_begin(subject)`, where the subject is `{ kind: "game", shortname }` or `{ kind: "map", map_name }`.

- It refuses when the distribution profile says `hub: false` or `hubAssetUploads: false`. A distribution that turned uploads off turned all of them off. The pure `permitted` function splits so the profile half can be asked alone.
- Otherwise it stores a grant in a process-wide map under a fresh random id and returns the id.
- `hub_manual_send_end(grant)` removes it. The frontend calls it in a `finally` around the whole send, so success, failure and Stop all end it. Grants live in memory only and die with the app.

`AssetUploadConsent::check` gains an optional grant argument. With a grant id, it returns the proof only if the grant exists. The proof then carries the grant's subject, and every place that takes a proof checks each item against it.

- `have::have` and `upload::upload_all`: every asset's identity must name the subject. A `unit` or `faction` identity's `game` must equal the shortname, ignoring case, and a `map` identity's `map_name` must equal the map name.
- `maps::have_maps` and `maps::publish_maps`: every key and entry's `map_name` must equal the map name.
- `games::publish_game_facts`: the facts' `shortname` must equal the shortname, ignoring case.

A request with any item outside the subject is refused whole, before anything is sent, with "This send was started for <subject> and cannot send <other>." A switch-based proof has no subject and allows everything, as today.

The commands `hub_assets_have`, `hub_upload_assets`, `hub_maps_have`, `hub_publish_maps` and `hub_publish_game_facts` each take an optional `grant: Option<String>`. Both new commands are added to `build.rs` `COMMANDS` and to the default permission set.

The module docs in `consent.rs` are rewritten to describe both ways in.

## Threading the grant through the frontend

`HubSweepTarget` in `src/hub/sweepFrame.ts` gains `grant?: string`. The send functions take it as an optional last argument and pass it to their command: `assetsTheHubWants`, `uploadAssetsToHub` (in its options), `mapsTheHubWants`, `publishMapFacts` and `publishGameFacts`.

The sweeps pass `target.grant` to every call they make. That covers `sweepGamePictures` and the backfill it hands down to (`backfillBlueprintUnits`), `sweepMapCatalog` and `sweepMapPictures`. An automatic sweep has no grant and behaves as now.

## The two sends

A game send is `sweepGamePictures({ hubUrl, enginePath, dataDir, only: shortname, grant })`. That already sends the game's facts, then its faction logos, build pics and renders, within the hourly picture allowance.

A map send is new, `sendOneMap` in `src/hub/maps/sendOne.ts`:

1. Read the map's key with `unitsyncMapCatalog({ maps: [name], keysOnly: true })`.
2. Ask `maps/have` about it. If the hub wants it, read the full entry with `keysOnly: false` and publish it.
3. Send its minimap through `sweepMapPictures` with a new `only?: string` target field. That field limits the survey and the encode to the one map, in the way `sweepGamePictures`'s `only` limits games.

## Progress in the top bar

`src/hub/assets/runningUploads.ts` holds the picture runs that `UploadRunBadge` shows. It grows into the list of hub sends.

- `RunningUpload.game` becomes `subject`, a display name, and a `kind: "game" | "map"` is added.
- `UploadRunPhase` gains `"reading"` for the facts half, which comes before any picture is drawn.
- A manual send calls `showUploadRun` as soon as it starts, under its own op id, so the badge appears at the click rather than only once drawing begins.
- The run's op id is passed down as the backfill's op id. `backfillBlueprintUnits` mints its own today, so its target gains an optional `opId`. The fill's own `showUploadRun` then replaces the entry in place rather than adding a second row. `showUploadRun` keeps `kind` and `subject` if the entry exists.
- Stop is the existing `stopUploadRun`. The send's `finally` hides the run and ends the grant.

`UploadRunBadge` labels a row by its phase: "Reading <subject>", "Making pictures of <subject>", "Sending <subject> to the hub". The trigger reads "Sending to hub" when any run is a manual send, and keeps today's wording otherwise.

The badge already sits in `topbar.right` from the hub plugin, so it stays visible while the user navigates.

## When a send ends

- Success: a toast "Sent <subject> to the hub", then the page re-checks. The game list cache is reset, and the map lookup's `knownMaps` cache gets a `forgetKnownMap(name)`.
- Part done: the picture sweep's `stopped` sentence becomes the toast, for example the hourly allowance running out. The button stays, because the hub is still missing pictures.
- Failure: a toast with the error from Rust or the sweep's `failed[0].said`. The button comes back.

A send keeps running when the user leaves the page, because it lives in a module-level store rather than in the page. Returning to the page while it runs shows the Sending state, read from that store by subject.

## Hub change, `tomjn/coilbox-hub`

`GET /api/v1/games` gains `releases: string[]` per game, every version in `game_version` for it, newest first.

- `hub-php/app/Domain/Games/GameList.php` and the query behind it are the live hub.
- `lib/api/gameList.ts` and its route in the Next app get the same field, because the Next app is the specification the PHP port follows.
- The envelope version stays 1. Adding a field is allowed by the client contract.

`HubGame` in `src/hub/api.ts` gains `releases?: string[]`, absent from a hub that predates it.

## Testing

- Rust: a grant allows its own subject. It refuses another subject for each of the five send paths. An ended grant is refused, and an unknown grant id is refused. The profile refusal beats a grant.
- Vitest: the control's state derivation from lookup, pictures and games list answers, including the absent `releases`. Also `sendOneMap` with stubbed tools, `only` on the map picture sweep, the grant being passed to every tool call, and `showUploadRun` replacing in place.
- Hub: a PHPUnit test that the games list carries `releases`.
- On screen, in a seeded portable instance with `multiplayer.autoConnect` off, through a second Tauri MCP server on its own socket:
  1. Open a map's detail page and see the control.
  2. Open a game's detail page and see the control.
  3. Start a send, navigate away, and see the badge's progress.

  The send is only checked against a hub on loopback or not at all. An agent does not send to `hub.coilbox.org` as the user.

## Out of scope

- Detecting a different archive under a map name the hub holds.
- Sending from list pages or in bulk. The sweeps already do that.
- Any change to what the automatic sweeps and backfill do.
