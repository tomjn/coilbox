# Campaigns

A **campaign** is an authored, linear sequence of skirmish missions. Each mission is a full skirmish setup (map, game, players/AI, mod options, unit restrictions) plus a Markdown briefing, objectives, and optional media — a panorama backdrop, side graphic, briefing voiceover and intro cutscene. Playing a mission launches it like any other skirmish; on exit Coilbox works out whether you won or lost and advances your progress.

A mission can also carry a [scenario](scenarios.md), which is what puts spawns, triggers, objectives and dialogue inside the game rather than only in the briefing. See [Missions that play a scenario](#missions-that-play-a-scenario).

![A mission briefing screen: title, subtitle, briefing text and objectives over the mission's panorama, with a Start Mission button.](/screenshots/mission-briefing.png)

Everything below is about authoring and shipping those missions — the mission is the unit of work in a campaign, so most of the detail (setup snapshot, briefing media, unit restrictions, win/loss) is per-mission.

## Authoring a campaign

The **Campaign Builder** is an advanced-mode tool: turn on Advanced mode (Settings > General) to see **Campaign Builder** in the sidebar. From there you can create a campaign, add missions, and edit each mission's briefing, objectives, panorama and skirmish setup.

### Step by step

1. **Turn on Advanced mode** — Settings > General. **Campaign Builder** now appears in the sidebar (it lives in its own group, not under Play).
2. **Set up a skirmish preset first.** A mission reuses a Singleplayer preset as its starting point, so go to **Play > Singleplayer**, configure the map, game, AI opponents, teams and mod options you want, and save it as a preset (the presets drawer, button next to Spectate).
3. **Create a campaign** — Campaign Builder > New. Give it a title; optionally add a campaign icon and background image.
4. **Add a mission** and open its editor. Attach the preset from step 2 — this **snapshots** its whole setup into the mission (see the note below). Then write the mission's briefing, objectives, and add any media.
5. **Repeat** for each mission. Missions play in the order you list them.
6. **Play-test** from the Campaigns list (visible once the campaign exists). Each mission launches like a normal skirmish; on exit Coilbox works out win/loss.
7. **Export** the campaign to a single `.json` to share it, or bundle it into a distribution (both below).

A mission's skirmish setup is a **snapshot**: when you attach a preset to a mission, its full configuration (map, game, participants, start positions, mod options) is copied in at that point. Editing the source preset later does not change missions that already used it — a campaign always plays the setup it was authored with.

### Mission media

Missions carry more than a still panorama:

- **Briefing** — authored as **Markdown**. Embed media inline by relative path with the image syntax: `![](images/intro.jpg)` shows an image, and a source ending in an audio or video extension renders an `<audio>` / `<video>` player instead (`![](briefings/vo.mp3)`, `![](briefings/intro.mp4)`). A link to `https:`, `mailto:` or `tel:` opens in the reader's browser, mail client or dialler. Any other link is refused, because Coilbox has no back button to return from a page drawn over it, so link a bundled file with the image syntax above rather than as a link.
- **Panorama** and **side graphic**: each can be a still image, a looping muted video, the mission's map as a live 3D preview, or one of the mission's game's units as a spinning 3D model. Pick the source in the mission editor. If the player's install can't draw the chosen unit, the briefing shows that slot's image instead.
- **Voiceover** (audio) and **cutscene** (video) — optional players shown on the briefing screen.

How the files are stored depends on where the campaign comes from:

- **Local (Campaign Builder)** campaigns import media into app-data: images are decoded and re-encoded, while audio/video are copied verbatim (they're streamed to the app, never re-encoded or inlined as data URIs).
- **Bundled / distribution** campaigns reference files by relative path from the `.coilbox/` folder (a `"local"` media reference) — the same mechanism a [distribution profile](distribution-profile.md) uses for welcome-screen media. This is how a campaign ships audio/video, which are too large to inline (see *Export / import* below).

### Unit restrictions

Each mission can disable specific units via **Restricted Units** in the mission editor. These are engine-level `[RESTRICT] Limit=0` entries, so:

- They apply to **every team**, including enemy AI — there's no way to restrict units for the player only.
- Unknown unit internal names are silently ignored by the engine.

Use this for scripted difficulty (e.g. no artillery in mission 1) rather than as a player-only handicap.

A [scenario](scenarios.md#restrictions) has restrictions of its own, which are a different mechanism. Those are enforced by the mission runtime, bind only the teams the scenario declares, and can be lifted mid-mission. **Restricted Units** here stays what it always was.

## Missions that play a scenario

A mission wraps a scenario and adds presentation. The scenario is everything in the game (spawns, zones, triggers, objectives, dialogue), and the mission is everything the player sees before the engine starts (briefing, panorama, side graphic, voiceover, cutscene). A mission with no scenario is the kind campaigns have always had, and still plays as an ordinary skirmish. Nothing needed migrating.

Author the scenario first, in the [Scenario Builder](scenarios.md), then attach it. Two ways:

- **From scenario** beside the Missions header builds a whole new mission around a scenario, titled after it.
- The **Scenario** field in a mission's editor attaches one to a mission you already have, with **Attach scenario** or **Change scenario**.

Attaching **copies the whole scenario document into the mission** and sets the mission's game and map from it, the same way attaching a preset snapshots its setup. Editing the source scenario afterwards does not reach a mission that already attached it. The mission editor says so: it shows **Matches the stored scenario**, or the date the attached copy was taken and the date the stored one was last edited, with an **Update to latest** button. **Detach** takes it off and leaves the mission a plain skirmish.

A scenario's dialogue clips stay in coilbox's own store rather than inside the mission, so deleting a scenario a campaign mission uses keeps its clips behind for that mission. The builder says which of the two it is doing when you press delete.

An export carries every attached scenario and its dialogue clips, and import writes the clips back. See [Export / import](#export--import). **Bundling is the gap**: a bundled campaign carries its scenarios but not their portraits and voice clips, so its radio messages play silent ([issue #877](https://github.com/tomjn/coilbox/issues/877)).

Which game can play a scenario mission, and what a game has to do to play one itself, is [the mission runtime's](mission-runtime.md) business rather than the campaign's.

## Export / import

A campaign can be exported to a single `.json` file (Campaign Builder > a campaign > Export) for sharing. The export format:

```json
{
  "format": "coilbox-campaign",
  "formatVersion": 1,
  "campaign": { "...": "the full Campaign document" }
}
```

Any campaign **images** are inlined as base64 `data:` URIs, so the file is self-contained — no separate images to send along. Import (Campaign Builder > Import) reads the same file back and validates it before adding it as an editable local campaign; a malformed or unrecognised file is rejected with an inline error rather than crashing anything.

**Audio and video are not inlined** (they'd be far too large, and can't be streamed from a data URI). A single-file export of a campaign that uses imported audio/video therefore keeps references that only resolve on the machine that authored it. To distribute a campaign with audio/video, bundle it (below) and ship the media files alongside it, referenced by relative path.

**A campaign carrying a scenario is written in a different shape.** Export writes a coilbox container, `"kind": "campaign"`, and a campaign whose missions have scenarios attached is written at `"kindVersion": 2`, with each scenario's dialogue clips inlined beside the document rather than inside it. Clips are named by bare file name because that is how the engine loads them, so inlining one into the document would change what the compile step emits.

The version is bumped only for a campaign that has a scenario. That is exactly the file an older coilbox would misread: it would parse the document, drop the scenario field it has never heard of, and offer a mission that plays as a bare skirmish with none of the triggers the author wrote. A campaign with no scenarios has no such problem, so it stays at the version older builds can open. The pre-container wrapper shown above is still read on import, and is no longer what export writes.

## Bundling a campaign in a distribution

A [distribution profile](distribution-profile.md) can ship one or more campaigns as **read-only** content, so players get them out of the box without importing anything. Bundled campaigns live under the profile's [`.coilbox`](portable-mode.md) folder:

```
<YourGameFolder>/
  .coilbox/
    profile.json
    campaigns/
      my-campaign.json
    images/            # media referenced by relative "local" paths
    briefings/
```

Each file in `campaigns/` is an exported campaign, dropped in as-is: export from Campaign Builder and save the resulting `.json` as `.coilbox/campaigns/<any-name>.json`. (A bare campaign document — the inner `campaign` object without the export wrapper — is also accepted.) Images are embedded in the export, so a still-image campaign is a single self-contained file.

To ship **audio or video** (which can't be embedded), reference the files by relative path from `.coilbox/` — a `"local"` media reference such as `{ "kind": "local", "path": "briefings/intro.mp4" }` for a panorama, voiceover or cutscene, or `![](images/art.jpg)` inline in a Markdown briefing — and place the files under `.coilbox/` alongside the campaign. These paths resolve the same way as [distribution-profile](distribution-profile.md) welcome-screen media.

Bundled campaigns show up in the Campaigns list marked read-only (no edit/delete in the builder) but otherwise play exactly like local ones, and their progress is tracked the same way.

One exception: a bundled campaign whose missions carry a [scenario](scenarios.md) brings the scenario but not its dialogue portraits and voice clips, so those lines play silent. Import the campaign rather than bundling it until [issue #877](https://github.com/tomjn/coilbox/issues/877) is done.

## Win/loss detection

After a mission's game exits (and wasn't cancelled), Coilbox tries to work out the result automatically instead of asking:

1. It snapshots the replay files present before launch, then diffs against the list after exit to find the new replay this run wrote (retrying briefly if the filesystem hasn't flushed it yet).
2. It decodes that replay and looks up your player entry by name.
3. If the demo has a known winner and you're in it as a non-spectator, the result (Victory/Defeat) is applied automatically — you land straight on the result screen with a small "Result detected from the replay" note, no confirmation needed.

If any step fails — no new replay found, the winner isn't known, or you're not found in the decoded players — Coilbox falls back to asking directly with the familiar **Victory** / **Defeat** buttons. This manual path is always available; automatic detection is a convenience layered on top of it, never a requirement.

### Scenario missions use the same path

A [scenario](scenarios.md) mission ends when the mission runtime calls the engine's own game over with the winning ally teams. That lands in the replay, and the three steps above read it. There is no separate channel and nothing extra to keep in step.

What the reader asks is whether **your ally team is among the winners**, which has two consequences worth knowing:

- A scenario's `victory` action that names a participant you are not playing records a **defeat** for you. Authors should leave the participant unnamed unless they mean it. See [Win and loss](scenarios.md#win-and-loss).
- **A mission you quit out of is recorded as a defeat**, automatically and without asking, because the replay carries an empty winner list, and an empty list is indistinguishable from a mission the runtime ended with nobody winning. This is [issue #875](https://github.com/tomjn/coilbox/issues/875). Cancelling the launch from Coilbox itself is different: nothing is detected and you go back to the briefing.
