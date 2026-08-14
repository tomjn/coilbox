# A community gallery for shared coilbox content

2026-08-09. Design for a public sharing service, and for the first version of it.

Coilbox produces a lot of things worth sharing. Battle presets, warpath and conquest challenges, setup packs and scenarios are all authored by hand, and every one of them is stuck on the machine that made it. The only ways out today are a file you send somebody or a `coilbox://` link you paste into Discord. There is no place to browse what other people have made, no way to find the good ones, and nothing that survives the Discord scrollback.

This adds that place. A public web gallery where people publish what they have made, browse what others have made, and pull an item straight back into coilbox.

## The constraint that shapes everything

The service must not become a standing financial obligation on one person, and it must not require anybody to hold a GitHub account.

That rules out the shape this would otherwise take. Storing content in a public git repository would give free storage, a free CDN and a full history, but a public repository cannot hold anything private, a private one forces every read through a proxy, and either way direct interaction would mean asking players to sign in to GitHub. It is the wrong tool once you follow it through.

What is left is a small service holding small JSON documents, chosen so that the realistic worst case is a bounded monthly figure rather than an open-ended one.

## Decisions

Publishing is what puts anything on the service. Nothing is uploaded as a side effect of using coilbox.

Your own content is the local content. The library on your disk is the private tier, and the service never sees it.

Cloud sync of a private library is a separate future feature, "coilbox sync", and may well be delegated to a user provided Google Drive or Dropbox rather than run here. Designing for it now would drag accounts, quotas and per-user storage into a service that otherwise needs none of them.

Reads are anonymous. Browsing, searching and importing require no account at all.

Publishing requires a Discord login. This is for attribution, so an author can be credited, for management, so an author can update or withdraw their own work, and for control, so not just anybody can add entries. Discord is the right identity provider because the community already lives there.

## What v1 carries

Coilbox already has a versioned publish format. `src/container/container.ts` defines an envelope of `{format, container, kind, kindVersion, payload}` across five kinds, each independently versioned so an older build reports "this came from a newer coilbox" rather than misreading it.

Four of those five kinds ship in v1: `preset`, `challenge`, `setup-pack` and `scenario`.

Three of them already produce a pasteable code through `encodeContainerCode`, at `src/play/pages/SkirmishPage.tsx:607`, `src/challenge/code.ts:51` and `src/packs/envelope.ts:30`. Scenarios differ: `src/scenario/transfer.ts:135` uses `encodeContainerJson` and saves a file through a dialog. The website therefore accepts both a pasted code and an uploaded JSON file.

### Out of v1, and why

Campaigns. `src/campaign/transfer.ts:90` carries media at kind version 2, and `src/campaign/images.ts:49` inlines images as base64 data URIs, with scenario dialogue clips allowed up to 16 MB each at `src/campaign/scenarioMedia.ts:106`. The link import path caps at 512 KB (`src/deeplink/fetchImport.ts:34`) and codes cap at the same figure after inflation (`src/container/container.ts:96`). A campaign with real artwork or voice clips exceeds that by a wide margin, so campaigns would force object storage and a new large-import path on day one. They travel as files today and continue to.

Lego units. Not a container kind. `src/lego/document.ts:25` defines `LegoDocument` but nothing wires it into `CONTAINER_KINDS`. Publishing lego needs a sixth kind added to coilbox first, which is a client change that has to land before the service can carry it.

Replays. `.sdfz` files are large, and useful replay sharing would mean running spring headless against uploads to derive stats. That is infrastructure, not a gallery.

Map imagery. Texture, heightmap and metal map for a map the browser has never seen. Deferred, see below.

The result is that v1 has no binary content at all. It is a pure JSON service, which is what makes it cheap enough to be safe.

## The service

Supabase, as a single provider.

Postgres with a `jsonb` column is exactly the data model. Discord is a first-class auth provider, so login is configuration rather than code to own and maintain. Row Level Security states the whole authorisation model in two policies. PostgREST supplies the read API with no backend to write. The free tier permits commercial use, so accepting donations later does not put the project in breach of its own hosting terms.

Free tier is 500 MB of database, 5 GB of egress and 1 GB of file storage. At realistic item sizes of a few kilobytes that is on the order of 25,000 items, and egress is the limit that would be met first, which caching of list responses addresses. A free project pauses after a week with no requests, which any real traffic prevents and a scheduled ping covers. The ceiling if it outgrows free is $25 a month.

The frontend is Next.js on Vercel, server rendered. A static bundle on GitHub Pages would be more permanent and cheaper, but it gives every shared item the same generic link preview, and this community shares in Discord constantly. Per-item OpenGraph tags are a distribution feature rather than polish, so Vercel is doing real work here and is not an interchangeable file host. The cost is the Hobby plan's non-commercial clause, which only bites if donations ever appear, and Netlify is the equivalent escape hatch if it does.

The frontend still holds no data. Everything it renders comes from Supabase at request time, so a move is a redeployment rather than a migration.

Alternatives considered. Cloudflare Workers with D1 is cheaper in the worst case and has free egress, but is ruled out by preference. Vercel with Neon is two providers, and the Vercel Hobby plan forbids commercial use. Render's free Postgres expires after 30 days. Fly and Railway no longer offer a meaningful free tier. A small VPS is predictable and capped at about four euros a month, but is permanent ops work and exactly the standing personal cost this design is trying to avoid.

### Data model

One table.

```
item
  id            uuid primary key
  kind          text         -- preset | challenge | setup-pack | scenario
  kind_version  int
  title         text
  description   text
  game_name     text
  map_name      text
  tags          text[]
  container     jsonb        -- the full coilbox container, verbatim
  author_id     uuid         -- supabase user
  author_name   text         -- discord display name captured at publish time
  created_at    timestamptz
  updated_at    timestamptz
  deleted_at    timestamptz
```

`author_name` is a snapshot rather than a join, so an item still shows an author after an account is deleted and the display name is the one the author had when they published.

Row Level Security is two policies. Select is allowed to anyone where `deleted_at is null`. Insert, update and delete are allowed where `auth.uid() = author_id`.

Deletion is soft, so a withdrawn item stops being served but a moderator can still see what was there. Account deletion hard deletes the rows and is a separate, explicit path.

### The loop, and why v1 needs no coilbox release

1. In coilbox, the author copies a share code, or exports a scenario file. Both exist today.
2. On the website, they sign in with Discord, paste the code or upload the file, and add a title, description and tags.
3. The service validates and stores the container.
4. Another player browses the gallery and clicks Import, which is a `coilbox://import?url=https://<gallery>/i/<id>` link.
5. Their coilbox fetches it over https through the Rust fetcher, identifies the container, and asks them to confirm before applying. All of this already works, at `src/deeplink/fetchImport.ts:64`.

Nothing in that loop requires a change to coilbox. The service can be built, launched, and if necessary abandoned, without ever shipping a client release. A publish button inside coilbox is a v2 convenience, not a prerequisite.

The `/i/<id>` endpoint must return the raw container as `application/json` at a stable URL, because that is what the existing import path consumes.

### Validation on publish

Parse the submitted code or file through the same rules the client applies. Reject anything that is not one of the four kinds. Reject a `kindVersion` higher than the service knows. Enforce a size cap matching the client's 512 KB ceiling, so nothing can be published that coilbox would then refuse to import.

The last of these is worth checking against real data before launch: a large scenario with many triggers and zones may already exceed 512 KB as a file, in which case it can be authored but not shared by link, and the cap needs revisiting on both sides.

## Previews

Every gallery item needs something to look at. For four kinds that picture is derived from data already inside the container and drawn as SVG in the browser, so there is no image generation, no rendering service and no image storage.

Preset. The payload holds `gameName`, `mapName`, `startPosType`, `modOptionValues` and `participants` (`src/play/presets.ts:19`). The preview is start positions in team colours, a faction icon per participant, and a player count badge.

Scenario. The same treatment with more marks: placed units and trigger or objective zones drawn as overlays.

Challenge. The payload is `{mode, settings}` (`src/challenge/code.ts:40`). Warpath and conquest already render a node graph, and the run's shape is in the settings, so the preview is that graph drawn small. Node count, branching and warlord placement make one run visibly different from another.

Setup pack. No natural picture. A typographic summary instead, along the lines of "47 units restricted, 6 mod options changed". Drawing the affected unit icons would require game assets in the browser, which reintroduces a dependency the gallery does not otherwise have.

The one thing that cannot be derived is the map bitmap under a preset or a scenario. A plain rectangle at the map's correct aspect ratio still reads clearly, so this degrades rather than leaving an empty card.

### Map imagery, deferred

BAR publishes map metadata through `beyond-all-reason/maps-metadata`, generated from a Rowy instance and deployed by GitHub Actions. `https://maps-metadata.beyondallreason.dev/latest/map_list.validated.json` carries `springName`, display name, author, description, player counts, terrain, start boxes and screenshots. `live_maps.validated.json` carries download URLs and checksums. They also run an imagor image proxy at `/i/`, which serves on the fly resizes of their own sources and refuses arbitrary hosts.

Texture, heightmap and metal map are not published there. BAR extracts those from the map file through `beyond-all-reason/map-parser`, and coilbox already does the same locally through unitsync for `MapPreview3D`.

So for the desktop client there is no map image problem at all. For the web gallery, the eventual options are to resolve `springName` against BAR's published JSON and use their imagor for BAR maps, or to generate three images per map at publish time and host them. Neither is in v1. Containers already reference maps by `springName`, so the gallery can adopt either later without a data migration.

A coilbox map database is a much larger project than a gallery, is not BAR specific because coilbox is not BAR specific, and raises a permissions question about rehosting derived images of other people's maps. It belongs in its own design, not this one.

## Abuse and moderation

Publishing requires Discord, which is the main deterrent on its own. On top of that: a per-user rate limit on publishing, a report button on every item, soft delete so a moderator can withdraw something without destroying it, and a single moderator to begin with.

Because reads are anonymous and cached, an abusive read pattern costs egress rather than correctness, and the egress limit fails closed on the free tier rather than generating a bill.

## Cost and exit

The realistic steady state is the free tier indefinitely. The realistic ceiling is $25 a month.

The exit matters more than the tier. A scheduled job exports the entire public gallery as a single JSON file to a static URL. That serves as the backup, gives coilbox something to fall back on when the service is unreachable, and means that if the service is ever abandoned the community can pick the data up and rehost it. The data is small enough that this is one file.

## Out of scope

Campaigns, lego units, replays, map imagery, private library sync, and a publish button inside coilbox. Each has a reason above, and none of them blocks the rest.

## Milestone shape

1. Schema, RLS policies and Discord auth on Supabase.
2. Publish flow: paste a code or upload a file, validate against the container rules, capture title, description and tags.
3. Browse and search: list by kind, game, map and tag, with paging.
4. Item page and the `/i/<id>` raw container endpoint that `coilbox://import?url=` consumes.
5. Previews per kind as SVG.
6. Author management: edit metadata, withdraw an item, delete an account.
7. Reporting, moderation view, and the scheduled public export.
