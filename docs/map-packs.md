# Map packs

A **map pack** is a curated, named list of maps offered for **one-click bulk
download** on the Maps download page — a tournament pool, a galactic-conquest
galaxy's maps, a "space maps" set, a starter bundle, and so on. Each pack has a
title, an optional blurb, and a list of maps; **Download all** queues every map in
the pack that isn't already present through the normal download queue.

## Two sources

Map packs come from either (or both) of two places — the same shape and mechanism,
different reach:

| Source | Reaches | Where it lives |
| --- | --- | --- |
| **Branding catalog** (`suggested.mapLists`) | **Every** Coilbox user, at runtime | `catalog.json` in the coilbox repo — see [Branding catalog](branding-catalog.md) |
| **Distribution profile** (`mapLists`) | Players running a copy **you packaged** | `.coilbox/profile.json` — see [Distribution profile](distribution-profile.md) |

When both are present, **catalog packs are listed first, then the profile's**,
deduped by `id`. So a distribution can ship a tournament pack of its own alongside
the shared catalog packs without either clobbering the other.

## Shape

A pack is `{ id, title, blurb?, maps[] }`. Each map is the same object used
everywhere else in Coilbox's curated content:

```jsonc
{
  "id": "tournament-2026",
  "title": "Tournament 2026 map set",
  "blurb": "The official pool for this season.",
  "maps": [
    {
      "id": "supreme-isthmus",
      "title": "Supreme Isthmus v2.1",
      "filename": "supreme_isthmus_v2.1.sd7",
      "download": { "kind": "map", "springName": "Supreme Isthmus v2.1" }
    }
  ]
}
```

- `id` — unique slug for the pack (used for dedup across the two sources).
- `title` / `blurb` — shown on the pack card.
- `filename` — the on-disk archive name; it enables **"already downloaded"**
  detection so present maps are skipped and the card can show progress.
- `download` — how each map is fetched (below).

### The `download` field

Each map's `download` is one of:

- `{ "kind": "map", "springName", "searchUrl"? }` — fetched by springname via the
  bundled pr-downloader (the usual case for maps in the Spring/Recoil ecosystem).
- `{ "kind": "url", "url", "filename", "subdir"? }` — a direct mirror file streamed
  to disk (`subdir` is `"maps"` for a map).

## Behaviour

- **Download all** queues every not-yet-present map in the pack through the normal
  download queue — the same queue, progress and error handling as any other
  download. Maps already installed (matched by `filename`) are skipped.
- Individual maps can still be downloaded one at a time from the pack card.
- Because packs reuse the standard queue, there's nothing special to clean up or
  configure; they're just a curated front-end over downloads Coilbox already does.

## Where to define one

- **For all users:** add a `suggested.mapLists[]` entry to the branding catalog and
  open a PR — see [Branding catalog → Suggested content](branding-catalog.md#suggested-content-and-galactic-conquest-names).
  This reaches everyone at runtime, no app release.
- **For a packaged distribution:** add a `mapLists[]` entry to your
  `.coilbox/profile.json` — see [Distribution profile → `mapLists`](distribution-profile.md#maplists-object).
  This ships with your bundle only.
