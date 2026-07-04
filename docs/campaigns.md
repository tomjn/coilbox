# Campaigns

A **campaign** is an authored, linear sequence of skirmish missions. Each mission
is a full skirmish setup (map, game, players/AI, mod options, unit restrictions)
plus a briefing, objectives and an optional panorama background. Playing a
mission launches it like any other skirmish; on exit Coilbox works out whether
you won or lost and advances your progress.

## Authoring a campaign

The **Campaign Builder** is an advanced-mode tool: turn on Advanced mode
(Settings > General) to see **Campaign Builder** in the sidebar. From there you
can create a campaign, add missions, and edit each mission's briefing,
objectives, panorama and skirmish setup.

A mission's skirmish setup is a **snapshot**: when you attach a preset to a
mission, its full configuration (map, game, participants, start positions, mod
options) is copied in at that point. Editing the source preset later does not
change missions that already used it — a campaign always plays the setup it was
authored with.

### Unit restrictions

Each mission can disable specific units via **Restricted Units** in the mission
editor. These are engine-level `[RESTRICT] Limit=0` entries, so:

- They apply to **every team**, including enemy AI — there's no way to restrict
  units for the player only.
- Unknown unit internal names are silently ignored by the engine.

Use this for scripted difficulty (e.g. no artillery in mission 1) rather than as
a player-only handicap.

## Export / import

A campaign can be exported to a single `.json` file (Campaign Builder > a
campaign > Export) for sharing. The export format:

```json
{
  "format": "coilbox-campaign",
  "formatVersion": 1,
  "campaign": { "...": "the full Campaign document" }
}
```

Any panorama images are inlined as base64 `data:` URIs, so the file is fully
self-contained — no separate images to send along. Import (Campaign Builder >
Import) reads the same file back and validates it before adding it as an
editable local campaign; a malformed or unrecognised file is rejected with an
inline error rather than crashing anything.

## Bundling a campaign in a distribution

A [distribution profile](distribution-profile.md) can ship one or more
campaigns as **read-only** content, so players get them out of the box without
importing anything. Bundled campaigns live under the profile's `.coilbox`
folder:

```
<YourGameFolder>/
  .coilbox/
    profile.json
    campaigns/
      my-campaign.json
```

Each file in `campaigns/` is a **plain campaign document** — the inner
`campaign` object from an exported file, not the export wrapper. To bundle a
campaign you've built and exported in the app:

1. Export it from Campaign Builder.
2. Open the exported `.json` and take just the `campaign` object (drop the
   `format`/`formatVersion` wrapper).
3. Save that as `.coilbox/campaigns/<any-name>.json`.

Bundled campaigns show up in the Campaigns list marked read-only (no edit/delete
in the builder) but otherwise play exactly like local ones, and their progress
is tracked the same way.

## Win/loss detection

After a mission's game exits (and wasn't cancelled), Coilbox tries to work out
the result automatically instead of asking:

1. It snapshots the replay files present before launch, then diffs against the
   list after exit to find the new replay this run wrote (retrying briefly if
   the filesystem hasn't flushed it yet).
2. It decodes that replay with the engine's `demotool` and looks up your
   player entry by name.
3. If the demo has a known winner and you're in it as a non-spectator, the
   result (Victory/Defeat) is applied automatically — you land straight on the
   result screen with a small "Result detected from the replay" note, no
   confirmation needed.

If any step fails — no new replay found, the winner isn't known, or you're not
found in the decoded players — Coilbox falls back to asking directly with the
familiar **Victory** / **Defeat** buttons. This manual path is always
available; automatic detection is a convenience layered on top of it, never a
requirement.
