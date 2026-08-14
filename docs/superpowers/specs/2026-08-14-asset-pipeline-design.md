# Coilbase Asset Pipeline — Design Handover

**Status:** design agreed, not implemented
**Audience:** implementing agent (Claude Code)
**Date:** 2026-08-14 (rev 4 — durable tier moved to GitHub Pages)

This document describes the **agreed shape** of an image/asset storage and
serving pipeline for Coilbase. It is a specification, not an implementation
plan. Produce the implementation plan from this.

Anything marked **[VERIFY]** was not confirmed during design and must be
checked against current docs before it is relied upon. Anything marked
**[OPEN]** is an unmade decision.

> **Two components were removed in earlier revisions. If an implementation
> plan references either, it is working from a stale copy of this document.**
>
> - **Cloudflare R2 and Workers (removed rev 3).** Once the promotion mechanic
>   (§4.7) made object storage a short-lived staging buffer rather than a
>   durable store, a third vendor stopped earning its place. Staging is now
>   **Vercel Blob** (§4.1). Stale signals: R2, Wrangler, `workers.dev`,
>   Workers Cache.
> - **jsDelivr (removed rev 4).** Its 50 MB per-GitHub-package limit is a hard
>   blocker against a ~215 MB corpus, and its terms name image hosting as
>   prohibited abuse. The durable tier is now **GitHub Pages** (§4.2, §4.2.1).
>   Stale signals: `cdn.jsdelivr.net`, "contact jsDelivr", any step 0 in the
>   setup sequence.

---

## 1. Context

Coilbase is a community hub for sharing RTS content — primarily base
blueprints and build orders — for games on the Recoil/Spring engine (BAR,
Splinter Faction, XTA, BA and others). It is currently **text-only**.

Current stack:

| Layer | Service | Tier |
|---|---|---|
| Hosting / app | Vercel | Hobby |
| Database / auth | Supabase | Free |
| Object staging | Vercel Blob | Hobby |
| Durable assets | GitHub repo, served via GitHub Pages | Free |
| Desktop client | Coilbox (Tauri + React) | — |

**Hard constraint: the whole system must incur zero recurring monetary
cost.** This drove most of the decisions below and should be treated as
non-negotiable unless the maintainer says otherwise.

### The problem

Blueprints are stored as structural footprints plus internal unit names.
There is nothing visual to tell a user what a structure actually is. There is
also no mechanism anywhere on the site for storing or serving uploaded
images.

Explicitly ruled out by the maintainer: base64 data URIs.

---

## 2. Asset identity — read this before anything else

Four maintainer assertions define the data model. Most of the apparent
complexity in a pipeline like this comes from getting these wrong.

1. **A unit has a single build pic within a game.**
2. **Unit names are not unique across games.** TA-derived games (BAR, XTA,
   BA) all have a `commander` and a `solar collector`. The units are similar
   or identical, but the build pics may differ. `game` is therefore never
   optional on a unit-scoped asset, and `unit_name` alone is never a key.
3. **Coilbox may render one or two angles** of a unit's 3D model for specific
   use cases. These are also scoped to a unit name within a game.
4. **`game` means the game's shortname, not a version.** A single set of build
   pics and renders per game is kept. Newer archives replace older ones; there
   is no per-release retention.

### The unit key

```
(game, unit_name, variant)      -- unique; one row, one object
variant ∈ { buildpic, render:<angle> }
```

Everything else — the archive an asset came from, who uploaded it, when — is
**provenance metadata hanging off the row, not part of the key**.

Two consequences worth stating explicitly, because they remove machinery an
implementer might otherwise reach for:

- **Update is replacement, not accumulation.** A newer archive producing a
  different hash for an existing triple replaces the row and orphans the old
  object for cleanup. Do not version rows.
- **"Do we already have one of these?" is a primary key lookup.** There is no
  need for perceptual hashing, similarity thresholds, or near-duplicate
  detection anywhere in this system. The unique key answers it. If an
  implementation plan proposes pHash, dHash, SSIM or a calibration harness,
  it has misread this section.

### Map assets are a different shape

- **Maps are game-agnostic.** The same map archive is used across BAR, XTA and
  BA. `game` is **not** part of a map's key, and no map asset is ever scoped
  to one.
- **A map has a minimap. The map is the key.** A new version of a map is a
  different map: its own minimap, its own key, its own row. This is the
  opposite of assertion #4, which holds for units only — a BAR version bump
  does not change what a solar collector looks like, but a map remake changes
  the terrain, and a blueprint built for one revision may be invalid on the
  next.

```
(map_name, variant)     -- unique; map_name is the engine's canonical map name
```

**`map_name` is the full canonical name as the engine reports it, version
string and all.** Do not split it into name and version components.

Parsing a version out of a map name is a losing game: mapper conventions are
inconsistent (`1.8`, `v1.8`, `_v2`, `Remake`, or no version at all), and a
parse failure silently either creates a duplicate or collides two genuinely
distinct maps. Since versions are separate identities anyway, there is nothing
to gain by decomposing the string.

If the UI wants to group revisions of the same map, derive a best-effort
`map_family` for display **only**. It must never participate in identity, and
being wrong about it must never be more than a cosmetic grouping error.

Minimaps are otherwise like buildpics: extracted deterministically from the
map archive, so they dedupe by hash across users and carry the same low risk
profile.

### The map key rule does not generalise to units

The rule above is **do not transform an identifier at its natural boundary**,
not "prefer single-field keys". Applied to each case it points opposite ways:

| | Arrives as | Correct action |
|---|---|---|
| Maps | one canonical engine string | **do not split** — parsing a version out is fragile |
| Units | two separate archive values (`game`, `unit_name`) | **do not join** — composing them creates a parse that did not exist |

A composite unit key like `bar:armsolar` would have to be split apart again
for every ordinary query — all units in a game, rebuild the atlas for one
game, list games with coverage. `(game, unit_name)` is already the right
shape and should stay as it is.

Do not unify the two key styles for the sake of consistency.

### Overlays: two classes, only one of which is an asset

**Extracted overlays** — metal/resource map, height map, typemap. Layers
inside the map archive. Deterministic, immutable, extractable by Coilbox.
Architecturally identical to minimaps; simply additional `variant` values on
the same map key:

```
variant ∈ { minimap, overlay:metal, overlay:height, overlay:type }
```

**Derived overlays** — heatmaps computed from Coilbase's own blueprint
corpus. **These are not assets and must not enter this pipeline.** See §4.9.

### Map geometry is required, and is easy to forget

Any overlay has to align to the minimap, and blueprint footprints are in world
coordinates while the minimap is in pixels. Store the map's dimensions in game
units alongside the minimap row so the world-to-pixel transform is derivable.

Without this, every overlay will be subtly misaligned and the cause will be
hard to isolate. Capture it at extraction time in Coilbox — the map archive
has it, and there is no other convenient source later.

---

## 3. Architecture summary

```
  ┌──────────────────────────┐        ┌──────────────────────────┐
  │ Coilbox (Tauri desktop)  │        │ Web frontend (browser)   │
  │  extract / render / encode│       │                          │
  └────────────┬─────────────┘        └────────────┬─────────────┘
               │ auth'd POST                       │ @vercel/blob/client
               │ (bytes via route, §8)             │ (client-direct)
               ▼                                   │
      ┌──────────────────┐   ┌────────────────┐    │
      │ Vercel API route │──►│ Supabase       │    │
      │  /api/assets/*   │   │ - auth (JWT)   │    │
      │  auth · quota ·  │   │ - metadata     │    │
      │  identity check  │   │ - quotas       │    │
      └────────┬─────────┘   │ - capabilities │    │
               │             └────────────────┘    │
               │  put()                            │
               ▼                                   ▼
        ┌─────────────────────────────────────────────┐
        │            Vercel Blob (staging)            │
        └──────────────────────┬──────────────────────┘
                               │ promotion job (§6.6)
                               ▼
        ┌─────────────────────────────────────────────┐
        │  assets repo via GitHub Pages (durable)     │
        └─────────────────────────────────────────────┘

  Reads:  atlas → Pages (durable) → Blob (staging) → placeholder     (§4.8)
```

Both clients hit the same route for auth, quota and identity checks. They
differ only in how bytes reach Blob: the browser uploads client-direct via the
official JS SDK; Coilbox posts through the route, because no maintained Rust
client exists (§8). Neither difference reaches the business logic.

---

## 4. Decisions and rationale

### 4.1 Vercel Blob for staging

**Blob is a staging buffer, not the permanent home.** See §4.7 — assets are
promoted out to the durable tier and deleted from Blob.

**Hobby allowances — confirmed from an actual store dashboard, 2026-08-14.**
Vercel does not publish these in its docs; the third-party figures of
5 GB/100 GB were lifted from the docs' worked *Pro* pricing example. Read from
the store page:

| Resource | Hobby allowance |
|---|---|
| Storage (average) | **1 GB** |
| Data Transfer | **10 GB/month** |
| Simple Operations | **10,000/month** |
| **Advanced Operations** | **2,000/month** |

**Advanced Operations is the tightest of these** — `put()`, `copy()` and
`list()` all count, so the ceiling is 2,000 uploads per month. On realistic
volumes for this ecosystem that is comfortable (§4.1.1), but it is the number
worth watching, and the penalty for exceeding it is a 30-day lockout with no
overage to pay.

Four rules follow. Treat them as hard — each one is a way to waste the quota
for nothing:

1. **Never call `list()`.** Enumerate from Postgres. A loop of `list()` calls
   could consume a meaningful share of the month.
2. **Never use `head()` for existence checks** — that is a Simple Operation.
   `/api/assets/have` answers from Postgres and never probes Blob.
3. **Never bulk-seed through Blob.** Seeding 2,000 minimaps is exactly one
   month's entire advanced quota. The seed goes straight to the assets repo
   (§4.7) — this is not merely simpler, it is the only viable route.
4. **Browsing the store in the Vercel dashboard costs Advanced Operations.**
   At 2,000/month this is not trivia; avoid idle poking while debugging.

Also confirmed from Vercel's docs:

- **Exceeding a limit removes Blob access for 30 days.** No overage billing;
  you cannot pay your way out.
- **Hobby included usage is shared across all Vercel services in the project.**
- **Cache HITs are free** — not Simple Operations, no Fast Origin Transfer.
- **`del()` is free.** Promotion deletes cost nothing.
- **Client Uploads incur no data transfer charge; Server Uploads incur Fast
  Data Transfer.** See §8.
- Per-minute rate limits (1,200 simple / 900 advanced) exist but are
  **irrelevant here** — the monthly cap of 2,000 would be exhausted in under
  three minutes at that rate.
- Public blobs deliver via Blob Data Transfer, ~3x more cost-efficient than
  Fast Data Transfer; private blobs additionally incur FDT. Another reason
  everything in scope is public.

### 4.1.1 Backfill strategy

The 2,000/month write cap is **comfortable in practice, not tight.** The
Recoil ecosystem produces a handful of games in total, not several per month,
so the realistic write volume is new maps and incremental units rather than
whole game rosters. The seed corpus never touches the upload path at all
(§4.7), so the common cases are covered before a single upload happens.

Two sensible defaults, neither of them load-bearing:

1. **Lazy backfill.** Upload only the units a viewed blueprint actually
   references, not the full roster. There is no reason to push 400 unit pics
   because someone opened one blueprint. Sensible hygiene rather than a
   constraint.
2. **Per-user, per-game backfill rate limits.** Cheap insurance against a
   pathological client looping.

Instrument advanced-operation consumption anyway — the failure mode is a
30-day lockout with no way to pay through it, so it is worth a dashboard
glance rather than a surprise.

**Held in reserve, do not build:** bundling N assets into one archive plus a
manifest would turn 400 advanced operations into 1, but bundled assets are not
individually readable during the staging window. Only worth revisiting if the
quota ever actually bites, which on these volumes it should not.

### 4.1.2 Dimension validation — cheap, and it cuts moderation load

Build pics have knowable invariants. Per the maintainer:

- **Square aspect ratio.** This applies to **build pics only.**
- **Unit images cap at 256px.** Build pics are typically 128×128 in the
  archives, so this costs nothing in practice; renders are generated by
  Coilbox, so the profile is set to match.

| Class | Aspect | Max dimension |
|---|---|---|
| `buildpic` | **square** (width == height) | **256px** |
| `render:<angle>` | **exactly the pinned render profile** (§4.5) | **256px** |
| `minimap` | **unconstrained** — maps are not all square | **512px longest edge** |
| extracted overlays | as source | as source, lossless (§4.5) |

**Unit images and map images have different caps** — 256px and 512px
respectively. Do not unify them. A minimap is a spatial reference the user
reads detail from; a unit image is an icon.

At 256px a render is correct for display up to 128 CSS pixels on a 2× screen.
That covers grid icons and small panels. If a unit detail view ever needs a
larger hero image, this cap is what would have to change — noted so the
constraint is visible rather than discovered.

**Do not generalise the square rule.** It is a property of build pics, not of
image assets. Minimaps legitimately come in other aspect ratios because maps
are not all square, and applying a square check to them would reject valid
uploads. Renders are not "square" either — they are whatever dimensions the
pinned render profile produces, so the check there is **equality against the
declared profile**, which is stricter and more meaningful than an aspect test.

**This is validation, not a quota measure.** An image that is not square, or
is larger than 512px, is not a build pic — regardless of what the client
labelled it. Rejecting it deterministically removes a whole class of "this is
not a game asset" upload **before a human ever sees it**, which reduces
moderation load (§7.2.1) rather than merely saving bytes.

**Validate before `put()`.** Because bytes pass through the Vercel route (§8),
the server can parse the image header — a few KB, no full decode — and reject
ahead of the write. **A rejected upload therefore costs zero advanced
operations.** Never trust dimensions declared by the client; read them from
the bytes.

**Minimaps cap at 512px on the longest edge**, aspect unconstrained. This is a
storage decision, not a bandwidth one — see §5 for the corpus arithmetic that
justifies it.

Note that map aspect is separately recorded as `map_width`/`map_height` for
overlay alignment (§2). That describes the **map**, not the minimap texture,
and the two should not be conflated in validation.

**Why this is acceptable:** promotion (§4.7) means the staging tier only ever
holds roughly seven days of long-tail uploads — games and maps the maintainer
does not have installed. Post-seed that is tens of megabytes, not gigabytes.
And if Blob does cut out, everything already promoted still serves from the
durable tier. **Blob failure degrades uploads; it does not take the site
down.** That containment property is what made dropping a dedicated object
store viable.

**Why Blob over Supabase Storage:** Supabase's egress pool is shared with the
database and auth, so a storage spike returns 402 across every service —
including logins. Blob's failure mode is "uploads break", Supabase's is
"logins break". Lower volume makes either unlikely; the difference is what
happens when the unlikely thing occurs.

**Known cost of this choice:** Blob has **no S3-compatible API**. See §8.

### 4.2 Durable tier: a separate assets repo, served via GitHub Pages

Committing binaries to git is a one-way door — history retains them
permanently even after deletion, and every Vercel build clones the whole
thing. **Keep assets in their own repo, separate from the app repo**, so the
app repo stays small and fast to clone and build, and so asset history can be
squashed or the repo re-created without touching app history.

Serve that repo via **GitHub Pages**. This keeps the durable tier entirely off
Vercel's 100 GB Fast Data Transfer meter, which is the tightest delivery
ceiling in the system.

**jsDelivr was evaluated first and rejected — see §4.2.1.**

### 4.2.1 Why GitHub Pages and not jsDelivr

Both checked against primary sources: jsDelivr's Terms of Use (effective
2026-05-30) and GitHub's Pages limits documentation.

| | jsDelivr | **GitHub Pages** |
|---|---|---|
| Size cap | **50 MB per GitHub package** | **1 GB published site** |
| Bandwidth | unlimited | 100 GB/month, *soft* |
| Build limit | n/a | 10/hour *soft*, **waived with a custom Actions workflow** |
| Deploy | n/a | times out after 10 minutes |
| Third party | yes | no |
| Prohibited use | names "image hosting website" as abuse | commercial / e-commerce / SaaS only |

**Three reasons Pages wins:**

1. **jsDelivr's 50 MB package limit is a hard blocker.** The minimap corpus
   alone is ~215 MB (§5.1) — over 4x the limit. Pages' 1 GB accommodates it
   with room for the rest of the corpus.
2. **The prohibited-use question disappears.** jsDelivr explicitly names
   "running an image hosting website and using jsDelivr CDN as storage for all
   uploaded images" as abuse, which is uncomfortably close to a description of
   this system. Its carve-out for "games with a large number of assets" is a
   decent argument, but it is an argument. GitHub Pages prohibits only
   commercial, e-commerce and SaaS use — the same posture as Vercel Hobby,
   which the project already sits within. **No prior conversation with a
   provider is required.**
3. **The build-rate limit does not apply.** GitHub waives the 10-builds-per-
   hour soft limit for sites published by a custom Actions workflow, which the
   promotion job (§6.6) already is.

**The one regression is bandwidth**: 100 GB/month soft, against jsDelivr's
unlimited. Acceptable — it is a separate allowance from Vercel's 100 GB, the
expected traffic is far below it, and it is soft. GitHub's stated response to
overage is that they may not serve the site or may email suggesting
mitigations, including fronting it with a third-party CDN. Not a cliff.

**Two things to watch:**

- **The 10-minute deploy timeout.** The minimap seed alone is ~215 MB (§5.1).
  **Splitting the seed import into batches is required, not optional.**
- **Rate limiting returns 429.** The per-game atlas (§6.7) already collapses
  most page loads into a single request, which is the main mitigation.

**1 GB is finite.** At the 512px minimap cap it is years away, but it is a
real ceiling — instrument published site size alongside the Blob quotas.

### 4.3 Keep the CDN base swappable anyway

Choosing GitHub Pages removes the third-party dependency jsDelivr
represented, but the durable tier still has a single provider and a finite
ceiling. The discipline stays:

- Resolve the CDN base from **a single configuration value**, never hardcoded
  into components, templates or stored URLs.
- Store the asset's **path** in the database, never a fully-qualified URL.
- Do not use provider-specific URL features that another host could not
  reproduce.

The assets live in a git repo the maintainer controls, so the recovery path is
re-pointing one constant: a CDN in front of Pages, Cloudflare Pages, Netlify,
or serving from Vercel as a last resort. Same discipline as the deferred
custom domain: one value, one place.

**jsDelivr is not on that list.** Its 50 MB package limit rules it out for
this corpus permanently, not situationally — it is not a fallback to reach for
if Pages disappoints (§4.2.1).

### 4.4 Two hashes: source for identity, encoded for the path

Assets are **re-encoded to web-friendly formats** before upload (§4.5). That
breaks the property everything below used to rest on, so the two roles are
split:

| Field | Hash of | Used for |
|---|---|---|
| `source_hash` | the raw bytes extracted from the game or map archive | identity, dedupe, anomaly detection |
| `hash` | the final encoded bytes | the object path in either tier |

**Why this split is necessary.** Extraction is byte-deterministic; encoding is
not. Two users on different Coilbox releases — or different libwebp builds —
produce different output hashes from the same source file. Hashing only the
output would silently break cross-user dedupe, and would trip §7.4's anomaly
flag on every encoder upgrade: same `source_archive`, different hash, read as
"modified client" when it is nothing of the kind.

`source_hash` restores determinism exactly where the design depends on it.

Properties that still hold:

- Immutable URLs → long-lived cache headers, no invalidation logic
- Cheap "do you already have this?" checks, against `source_hash`
- **Promotion does not change the path component** — only which host serves
  it. A stale reference 404s cleanly and re-resolves from the metadata row,
  rather than silently returning the wrong image.

Renders have no meaningful `source_hash` — GPU driver, AA and sampling vary
before encoding even starts. **This does not matter**, because the unique key
in §2 means only one render per `(game, unit_name, angle)` is ever stored. The
second user's render is rejected at token-issue time, before any bytes move.
Renders may record the **source model file hash** instead, which is
deterministic and anchors the render to a real unit in a real archive.

### 4.5 Encoding profiles — one size does not fit all

The maintainer has approved re-encoding source assets to web-friendly formats.
Encoding happens **in Coilbox, before upload**. Three classes, three answers:

| Class | Content | Encoding |
|---|---|---|
| Buildpics | 128×128 flat-colour icons with alpha | **Lossless WebP** |
| Minimaps, renders | photographic-ish terrain and models | **Lossy WebP** (~q80) |
| Extracted overlay layers | **data encoded as an image** | **Lossless, mandatory** |

**The overlay row is the one to get right.** A metal map is not a picture —
the pixel values *are* the resource amounts. Lossy-encoding it corrupts those
values subtly enough that nothing looks obviously broken and the resulting
overlay is quietly wrong. Same for height maps and typemaps. **Never apply a
lossy codec to a data-bearing layer**, however web-friendly the instruction
sounds.

Buildpics are worth calling out too: at 128×128 with flat colours and hard
edges against transparency, lossless WebP is typically both smaller and
visibly better than lossy. Do not assume lossy is the space-saving choice.

Other requirements:

- **Preserve alpha throughout.** Buildpics and renders depend on it. Never
  flatten to a background colour.
- **Strip metadata** (EXIF, ICC, timestamps) — smaller, and it removes a
  needless variability source between encoder runs.
- **Record the profile** on the row (`encode_profile`), so a future re-encode
  pass — a quality change, or a future format — knows what it is looking at
  and can target only what needs redoing.
- Re-encoding means the hub never holds the original. That is fine: Coilbox
  can re-extract from local archives, so a corpus-wide re-encode is a
  re-ingestion, not a data-loss event. `source_hash` and `source_archive` are
  what make that traceable.

**WebP only. AVIF is ruled out** — the maintainer's call, on browser support
breadth. AVIF would be smaller at equivalent quality, but that is not a
trade worth making here: §5 shows no storage pressure to relieve, so the only
thing AVIF would buy is a narrower audience.

### 4.6 Coilbox as the primary ingestion path

**The most important decision here, and the least obvious.**

The instinct is to ship buildpics as pre-processed static assets. That works
for games known at build time, but does nothing for new games, newly added
units, or legacy content — which is most of the long tail.

Coilbox sits next to the user's actual game installs. It can extract
buildpics and minimaps, render model angles, and upload whatever the hub is
missing. **The first user to open a blueprint for an unknown game backfills
what that blueprint needs, for everyone.** Self-healing, and needs no advance
knowledge of any game or map.

**Backfill is lazy, not eager** — only the units a viewed blueprint actually
references, rather than the whole roster. Sensible default rather than a hard
constraint; see §4.1.1.

### 4.7 Two-tier storage: Blob as staging, repo as durable

Assets that are approved get promoted out of Blob into the assets repo and
deleted from Blob. This is the maintainer's stated intent for minimaps and
generalises to every asset class.

It buys two things:

1. **Bounds the staging tier.** An ever-growing blob store becomes a working
   set of roughly one week.
2. **Moves reads off Vercel's meters entirely.** GitHub Pages serves the
   durable tier, so promoted assets cost no Fast Data Transfer and no Edge
   Requests.

**Promotion criterion: everything approved, older than 7 days.** Agreed with
the maintainer. Deliberately not popularity-based — the point is for staging
to stay near-empty, so cleverness is unwarranted. Revisit only if the assets
repo grows uncomfortably.

**Seed import goes straight to the durable tier.** The maintainer has a
significant local map collection, and local installs of the games he plays.
Those files are already on disk and destined for the durable tier — do not
route them through Blob first. Bulk-commit them to the assets repo and
register the rows as `tier = 'static'`.

Seed both classes:
- **Minimaps** from the local map collection — the largest single batch, and
  the one the maintainer specifically wants to front-load.
- **Buildpics and renders** from local installs of the common games (BAR and
  similar), covering what most users are actually looking at.

Blob is then only handling the long tail: games and maps the maintainer does
not have installed, arriving from users afterwards. **A steadily growing Blob
footprint means the promotion job has stalled** — a useful health signal, not
just a quota to watch.

### 4.8 Resolution order at render time

Callers request an asset by its identity, not by tier. Tier is a storage
detail resolved from the metadata row.

```
1. Atlas lookup for that game    — buildpic only, in-bundle, no network cost
2. Durable tier (GitHub Pages)   — off Vercel's meters entirely
3. Staging tier (Blob)           — for assets not yet promoted
4. Fall back to buildpic         — if a specific render angle is missing
5. Generated placeholder         — from footprint dimensions + unit or map name
```

Step 5 must always succeed. The UI should never show a broken image.

### 4.9 Derived overlays are data, not images

Heatmaps and similar overlays derived from Coilbase's own blueprint corpus
**must not be pre-rendered and stored as image assets.** Ship the aggregate as
data; render it client-side as a canvas layer over the minimap.

**Why this is not a preference.** Every mechanism in this document assumes
assets are immutable: content-addressed keys, long-lived cache headers, and
the promote-to-durable path in §4.7. A heatmap changes every time someone
submits a blueprint. Putting mutable content through that pipeline means
invalidation logic in all three places — and a heatmap promoted into the
assets repo would go stale somewhere with no purge mechanism at all.

**Why it is also just better:**

- **Smaller.** A 64×64 grid quantised to one byte per cell is ~4 KB, less than
  the equivalent PNG, and it never touches Blob or the promotion job.
- **Recomputable.** It is an aggregate query against Postgres. No durable
  artefact to keep in sync with the data it came from.
- **Interactive.** Opacity, threshold, faction filter, skill-bracket filter —
  all client-side, no new assets per permutation.
- **Composable.** Users will want to stack layers: heatmap + resource spots +
  a build path. As data layers that is free. As baked images, every
  combination is a distinct stored object.

**Serving:** a Vercel API route returning the aggregate for a
`(map, layer, filters)` request, with a short TTL or a version counter in the
cache key. **Do not** mark these immutable.

**Precompute only if measured to be necessary.** If the aggregate query proves
too slow, cache it in a Postgres materialised view refreshed on a schedule —
still data, still in the database, still not an image asset.

**Scope of this rule — and a deferred case.** The argument rests on the
overlay deriving from the *blueprint corpus*, which changes on every
submission. It is not a blanket ban on storing overlays.

The maintainer has flagged **demo (replay) file analysis** as a future source
of heatmaps and similar overlays. That case has different properties and
should be re-evaluated on its own terms:

- Output is **immutable for a fixed input set** of demos, so the mutability
  objection largely disappears.
- Analysis is expensive and likely runs in **Coilbox**, making it an upload
  rather than a server-side computation.
- Some outputs are naturally **vector** (contours, territory boundaries, build
  paths) and would suit **SVG**.

**Out of scope for this document. Do not build it.** Noted only so §4.9 is not
misread as forbidding it.

If SVG is adopted later, treat it as a security decision and not just a MIME
allowlist entry: SVG can carry script. User-supplied SVG must be sanitised on
ingest and served with a restrictive CSP. Note that the origin separation the
earlier `workers.dev` design provided **no longer exists** — assets now serve
from GitHub Pages or from Vercel, so this needs handling deliberately.

---

## 5. Quotas and corpus size

R2's free egress is gone. The binding constraints are now:

- **GitHub Pages published site: 1 GB.** The durable tier's ceiling, and the
  one worth modelling — see below.
- **Vercel Fast Data Transfer, 100 GB/month**, shared between the site and any
  Blob-served asset. The durable tier is off this meter (§4.2).
- **Vercel Blob: 1 GB storage, 2,000 advanced operations/month** (§4.1).
  Storage is not a concern given promotion; operations are the number to
  watch.
- **GitHub Pages bandwidth: 100 GB/month, soft.** Separate from Vercel's.

### 5.1 Corpus arithmetic

The map corpus is **bounded and measured**: springfiles lists **3,575 maps**.
That is close to the whole known set, not a sample.

| Class | Count | Per asset (512px, WebP) | Total |
|---|---|---|---|
| Minimaps | ~3,575 | ~60 KB @ 512px | **~215 MB** |
| Build pics | a few thousand units | 5–10 KB @ 256px | ~20 MB |
| Renders | units × angles | ~18 KB @ 256px | ~110 MB at 3,000 units × 2 |

Total for a full corpus: **roughly 340 MB against the 1 GB ceiling.**

**Minimaps at ~215 MB are about a fifth of the 1 GB ceiling**, for the entire
corpus, growing only as new maps are released. The 512px cap is what makes
that comfortable: uncapped from 1024px sources the same corpus is ~715 MB —
70% of the ceiling for minimaps alone.

**Renders are still the only unbounded class**, since they scale with
units × angles rather than with a fixed external corpus. The 256px cap (§4.1.2)
is what keeps them tractable: at 512px the same 3,000 units × 2 angles would
be ~300 MB rather than ~110 MB. Even so, a bulk "render everything, every
angle" pass is the one thing that could move the total meaningfully. Renders
are for **specific use cases, not every unit** (§4.6).

**Instrument published site size**, broken down by asset class. It is the
number that decides how long this design holds, and the render share is the
part that can move.

**Implement:****Implement:**

- Per-object size cap, enforced at token-issue time
- Per-account cumulative storage quota, enforced at token-issue time against a
  running total in Postgres
- **Per-unit variant cap** — a hard ceiling on stored variants for any one
  `(game, unit_name)`
- **Dimension validation per §4.1.2** — square aspect for build pics only;
  **256px** ceiling for build pics and renders, **512px** for minimaps.
  Checked server-side from the image header before `put()`. A 128×128 build
  pic WebP is ~5–10 KB; a 256px render ~18 KB; a 512px minimap ~60 KB.
- Staging headroom check with alerting, calibrated to the 30-day lockout in
  §4.1 — you cannot pay your way out of that one
- Cleanup of Blob objects never claimed by a row, and orphans left behind when
  a row is replaced

The corpus is **inherently bounded** by §2 and §7.1 together: one buildpic plus
one or two renders per unit per game, one minimap per map, no version
retention, and no campaign class at all. There is no unbounded growth path in
the current design. Promotion (§4.7) then keeps the staging tier to roughly a
week of that.

**On video:** the maintainer's instinct to reject video was right, but the
original reasoning (bandwidth) was wrong under R2's free egress. Under Vercel
Blob, bandwidth *is* metered again — so video is now doubly ruled out. It
still falls out of the per-object size cap rather than needing a special case.

An explicit MIME allowlist is still worth having, for content-safety and
moderation reasons rather than cost.

---

## 6. Components

### 6.1 Vercel Blob store (staging)

Content-addressed paths reflecting origin, since origin determines trust model
and serving path:

```
unitpics/<sha256>.webp       -- buildpics, extracted from archives
renders/<sha256>.webp        -- Coilbox-generated model renders
minimaps/<sha256>.webp       -- extracted from map archives
overlays/<sha256>.webp       -- extracted map layers
```

Variant naming (`render:front`, `overlay:metal`) lives in the metadata row, so
new variants never need new paths.

All assets in scope are **public**. There is no private class, because
campaigns are out of scope (§7.1).

Noted for whenever campaigns return: Vercel Blob's `put()` takes
`access: 'private'` as well as `'public'`, so access-gating is native and does
not need building.

### 6.2 Assets repo (durable)

A separate GitHub repository. Mirrors the same content-addressed paths.

```
unitpics/<sha256>.webp
minimaps/<sha256>.webp
atlas/<game>/<build>.webp
atlas/<game>/<build>.json
```

Written only by the seed import and the promotion job (§6.6). Served via
GitHub Pages, behind the single config value required by §4.3.

If campaigns are ever added, **do not** put them in this repo. Public git
history is permanent and unpurgeable, which is the wrong property for
user-supplied binary content that might later need removing.

### 6.3 Vercel API routes

- `POST /api/assets/upload-token` — verify Supabase JWT; check MIME
  allowlist, declared size, account quota; **check whether the identity key
  already exists and reject early if so**; return a scoped upload token
- `POST /api/assets/confirm` — client reports completion; server writes or
  replaces the metadata row
- `POST /api/assets/have` — batch check. Client sends a list of identity keys
  with their `source_hash` values; server returns which are missing or
  changed. **Answer entirely from Postgres — never `head()` against Blob**,
  which is a metered Simple Operation (§4.1). **Coilbox must call this before
  uploading anything**, and before doing the work of rendering or encoding
  anything.
- `GET /api/overlays/:map/:layer` — derived overlay data (§4.9). Short TTL.

The same routes serve the web frontend and Coilbox. One API, two clients.

### 6.4 Supabase schema (sketch)

```sql
create table assets (
  id            bigserial primary key,

  -- identity: exactly one of the unit or map key is populated (§2)
  game          text,                      -- game SHORTNAME; unit assets only, never a version
  unit_name     text,                      -- internal unit name; unit assets only
  map_name      text,                      -- FULL canonical engine map name, version included. Not scoped to a game.
  map_family    text,                      -- best-effort base name, DISPLAY GROUPING ONLY, never identity (§2)
  variant       text not null,             -- 'buildpic' | 'render:front' | 'minimap' | 'overlay:metal' | 'upload'

  -- map geometry, required for overlay alignment (§2). Map assets only.
  map_width      int,                      -- world units
  map_height     int,                      -- world units

  hash          text not null,             -- sha256 of ENCODED bytes; the path component (§4.4)
  source_hash   text,                      -- sha256 of RAW archive bytes; identity/dedupe/anomaly (§4.4)
  encode_profile text not null,            -- which profile produced `hash` (§4.5)
  path          text not null,             -- tier-relative path; NEVER a fully-qualified URL (§4.3)
  origin        text not null,             -- 'unitpic' | 'render' | 'minimap' | 'overlay' | 'upload'
  tier          text not null default 'blob',  -- 'blob' | 'static'  (§4.7)
  mime          text not null,
  bytes         bigint not null,
  width         int,
  height        int,

  -- provenance only, never part of identity (assertion #4)
  source_archive text,
  seen_at        timestamptz,

  promoted_at    timestamptz,

  uploaded_by     uuid references auth.users,
  moderation      text not null default 'pending',
  approval_source text,                    -- 'trusted' | 'manual'
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

-- THE unit key. One asset per unit per variant per game. (§2)
create unique index assets_unit_identity
  on assets (game, unit_name, variant)
  where unit_name is not null;

-- THE map key. Game-agnostic; the canonical map name IS the identity. (§2)
create unique index assets_map_identity
  on assets (map_name, variant)
  where map_name is not null;

-- display grouping only; deliberately not unique
create index on assets (map_family) where map_family is not null;

create index on assets (game);
create index on assets (uploaded_by);
create index on assets (moderation) where moderation = 'pending';
create index on assets (tier, created_at) where tier = 'blob';

-- capabilities granted individually, never as one "trusted" flag (§7.4)
create table user_capabilities (
  user_id     uuid references auth.users,
  capability  text not null,   -- 'can_seed_unit_assets' | 'can_publish_unreviewed' | 'can_moderate'
  granted_by  uuid references auth.users,
  granted_at  timestamptz default now(),
  primary key (user_id, capability)
);
```

A check constraint enforcing "exactly one of `unit_name` / `map_name` is
non-null" is worth adding — the two identity indexes are partial and will not
catch a row populating both.

`path` stores the tier-relative path only. Resolving it to a URL is the
frontend's job, using the config value from §4.3.

Replacement on update: a new hash for an existing identity updates `hash`,
`path`, `source_archive`, `seen_at` and `updated_at` in place. The superseded
object becomes an orphan for cleanup.

RLS: public read for `moderation = 'approved'`; insert and update only via the
service role from the Vercel route, never directly from clients.

### 6.5 Coilbox (Tauri + React)

**Do not embed storage credentials in the binary.** The frontend bundle and
Rust constants are both extractable from a shipped desktop app. Coilbox
authenticates as a user and receives short-lived scoped upload tokens.

- **Auth:** Supabase PKCE flow via deep link (`coilbox://auth/callback`) or a
  loopback listener. Refresh token in the OS keychain, not app-local storage.
- **Upload from Rust (`reqwest`), not the webview.** Bypasses CORS entirely
  and gives progress events and retry. See §8 for the caveat this now carries.
- **Call `/api/assets/have` first.** Upload only the delta, and skip the
  render work entirely for identities the hub already has.
- Extraction, rendering and encoding all happen locally, before upload,
  following the per-class profiles in §4.5. Compute and report **both** hashes
  (§4.4).
- Coilbox extracts **minimaps** from local map archives, and where present the
  **overlay layers** (metal, height, typemap), capturing **map dimensions in
  world units** — required for overlay alignment and not conveniently
  recoverable later.

### 6.6 Promotion job (Blob → assets repo)

The only writer to the durable tier after the initial seed. A scheduled GitHub
Action against the assets repo is the natural home: it needs commit access and
does not need to be fast.

Per run:

1. Select `tier = 'blob'` rows that are `moderation = 'approved'` and older
   than 7 days.
2. Fetch each object, commit to the assets repo under its content-addressed
   path.
3. Update rows: `tier = 'static'`, `promoted_at = now()`.
4. **Only then** delete from Blob. Never delete before the row update commits
   — an interrupted run must fail toward "present in both tiers", never toward
   "present in neither".
5. Rebuild the atlas if any promoted asset is an atlas member.

Batch commits rather than one commit per asset: GitHub's API rate limit and
the readability of the repo history both argue for it.

**`del()` is free of charge**, so step 4 costs nothing against the monthly
quota. The per-minute rate limit still applies and batch deletion counts per
blob rather than per call, so pace large batches — but this is a throughput
detail, not a cost one.

**Never use `list()` to find what to promote.** Query Postgres for
`tier = 'blob'` rows. `list()` is an Advanced Operation against a 2,000/month
budget (§4.1) and would be a serious waste of it.

Because paths are content hashes, promotion never changes an asset's path
component — only which host serves it. Clients resolve the host from the
metadata row via §4.3's config value.

### 6.7 Atlas builder

Regenerates a packed atlas per game from the durable tier — **one atlas per
game** (assertion #2: a shared atlas keyed on unit name alone would collide
`commander` across BAR, XTA and BA).

Format: packed WebP plus a JSON map of `unit_name → {x, y, w, h}`. Packs the
`buildpic` variant only; renders are larger, exist for specific use cases, and
are fetched individually.

**Do not route atlas images through `next/image`.** Vercel Hobby allows only
~5,000 image transformations/month, metered on unique source images. Size at
build/upload time with `sharp` and serve with `unoptimized`.

---

## 7. Trust, moderation, and content safety

### 7.1 Current position

- **Campaigns are out of scope.** Not currently supported on the hub. Creators
  self-host campaign assets, as they do video. Special treatment for them is
  deferred, not designed here.
- **No user-supplied screenshots.** Not accepted at this stage.
- Every asset class in scope is produced by Coilbox mechanically from local
  game and map data: buildpics, minimaps, extracted overlays, model renders.
- Everything served is **public**. There is no access-gated class.

Deferring campaigns removes the large-file requirement entirely. Every asset
in scope sits comfortably under Vercel's 4.5 MB function body limit, which has
useful consequences in §8.1 and §5.

### 7.2 The moderation queue is still required

Campaigns were the context in which the CSAM risk was first raised, but they
were never the whole of it. **The vector is any channel that accepts arbitrary
user-supplied images and serves them publicly**, and Coilbox uploads from
untrusted users remain exactly that: a modified client can send any image it
likes under a buildpic or minimap label, and the hub will serve it.

A 512×512 minimap is ample resolution for the misuse. Deferring campaigns
narrows the threat surface; it does not close it.

**What changes is the cost of review, not the need for it.** Reviewing a
128×128 game icon or a 512×512 minimap is fast, cheap, and requires no
specialist tooling — far easier than reviewing panoramas and audio would have
been. The queue gets simpler, not optional.

### 7.2.1 The corpus contains no images of people, and that is useful

Per the maintainer: these assets are terrain and game structures. There are
essentially **no images of people**, and there should not be. The exception is
novelty or "troll" maps — one is reportedly built around a photo of Donald
Trump — at something like one in a thousand.

Two things follow.

**Review is bulk work, so build the UI for that.** A reviewer scanning a
contact sheet of terrain thumbnails and unit icons is pattern-matching against
"this is a game asset", not making fine judgement calls. Design the queue as a
**grid with bulk approve and click-the-anomaly reject**, not a one-at-a-time
card flow. At this base rate a one-at-a-time UI would make an easy job tedious
enough to stop getting done — which is how moderation queues actually fail.

**Human imagery is itself a review signal.** Because it is unexpected in this
corpus, anything resembling a photograph of a person stands out rather than
blending in — useful whenever a human is looking at the queue. Automating that
signal is deferred; see §7.2.2.

**The base rate does not weaken the control**, because the threat model is
adversarial rather than statistical. Someone deliberately abusing a modified
client is not drawn from the same distribution as ordinary uploads. Low
background noise makes the signal easier to see; it does not remove the need
to look.

### 7.2.2 Human-imagery detection — deferred, with a trigger condition

**Not required now. Do not build it.**

The seed corpus is a collection the maintainer downloaded by hand over many
years and knows the contents of. Detection has nothing to catch there.
Untrusted uploads go to the queue regardless (§7.4), so a detector adds
nothing on that path either. Right now there is no gap for it to close.

**The trigger condition:** the moment `can_seed_unit_assets` is granted to
anyone other than the maintainer. At that point trusted bulk imports stop
being ones the maintainer personally vouched for, and the trust bypass
develops the gap this was meant to fill:

```
trusted uploader + no flag   → live immediately
trusted uploader + flag      → queue
untrusted uploader           → queue (regardless)
```

If it is ever built, two notes carried forward:

- **Tune for recall, accept false positives.** At a one-in-a-thousand base
  rate, falsely flagging 5% of a 2,000-asset import produces 100 queue items
  instead of 2 — a single pass in the grid UI of §7.2.1. A blunt detector is
  the correct choice; do not reach for anything sophisticated.
- **Run it where compute is free** — the local import script or Coilbox, never
  a Vercel function (4 CPU-hours/month, 10-second timeout). It would be a
  safety net for good-faith bulk imports, not an adversarial control: anyone
  who would bypass a client-side detector is untrusted, and untrusted uploads
  are queued anyway.

### 7.2.3 Novelty maps are allowed

**Decided: novelty and "troll" maps are permitted.** They are part of the
community's culture. No policy work required, no gating, no special casing at
upload.

One distinction still worth keeping in the data model, for the queue rather
than for novelty maps specifically:

- **Safety rejection** is not a judgement call and must never be overridden.
- **Editorial rejection** — out of scope, wrong game, junk — is a judgement
  call.

Record which one a rejection was (§7.5). Collapsing both into an
undifferentiated reject means the audit trail cannot distinguish "we removed
illegal content" from "we removed a bad upload", which are very different
things to be able to demonstrate after the fact.

Optionally tag novelty maps so users can filter them. Nice to have, not
required.

### 7.3 Public serving is the reason the queue matters

Any approved asset is served from GitHub Pages or Blob to anyone holding the URL.
A sha256 path is unguessable, but it is still a public URL — and a URL is
exactly what gets shared. There is no "only visible inside the app" state in
the current design, and none should be assumed as a mitigation if one is added
later.

### 7.4 Trust model — deliberately simple

**Trusted uploaders — a capability, not a boolean:**

- `can_seed_unit_assets` — upload buildpics, minimaps, overlays and renders
  that go live immediately. This is the role the maintainer holds.
- `can_publish_unreviewed` — bypass the moderation queue generally. Reserved
  for a future user-supplied class. **Separate grant. Do not fold it into the
  above.**

These solve different problems. The first is about bootstrapping content; the
second is a content-safety control (§7.2). A single `is_trusted` flag
collapses them, and the first time someone is granted trust to help seed a
game roster, that grant would silently also let them publish unreviewed binary
content. Keep them apart from the start.

**Untrusted uploads go to the moderation queue.** That is buildpics, minimaps,
overlays and renders from ordinary users — the whole of the current upload
surface. There is no automated trust gate, no
multi-account consensus, and no similarity checking — the queue is the
control, and for a hub of this size a human looking at a 128×128 game icon is
both sufficient and cheap.

**Anomaly flag, not a gate.** Compare on `source_hash`, never on `hash` —
encoded output legitimately differs between Coilbox releases (§4.4), and
flagging on it would fire on every encoder upgrade.

If an existing identity is replaced by a different `source_hash` from a
*different* `source_archive`, that is a normal version rollover — accept it.
If a second user reports a different `source_hash` for the same identity from
the *same* `source_archive`, that is genuinely odd (a modified client, or a
corrupted install) and should be surfaced to the queue. A cheap signal, not a
blocking check.

### 7.5 Moderation queue requirements

Required before untrusted users can upload anything:

- Default state `pending`; nothing fetchable until `approved`
- Per-asset uploader identity, timestamp and source IP retained — needed for
  any report
- Reviewer actions: approve / reject / escalate, with an audit trail.
  **Record the reason class** — safety vs editorial (§7.2.3) — so the two are
  distinguishable after the fact. Novelty maps are allowed and are not a
  rejection reason.
- Bulk grid review with multi-select approve (§7.2.1), not a one-at-a-time
  card flow
- Reject must be a state, not a delete. **Do not destroy suspected CSEA
  material** — preservation matters if it has to be reported.
- Per-account upload rate limits
- Trusted accounts are higher-value targets: require 2FA, audit-log every
  trusted-path insert with actor and timestamp, and provide a way to enumerate
  everything a given account seeded, so a compromised or bad-faith account can
  be unwound.

### 7.6 Automated hash matching — considered and rejected

**Decision: not implemented.** No IWF hash list, no PhotoDNA, no equivalent.

These services match uploads against hashes of **known** CSAM. They exist for
platforms taking high-volume user uploads where reviewing everything by hand
is impossible. Coilbase is the inverse case:

- **Every untrusted upload is human-reviewed before it is served** (§7.4).
- Volume is low and long-tail only — the seed corpus never touches the upload
  path at all (§4.7).
- Content is mechanically derived from game and map archives, so anything
  anomalous is conspicuous rather than buried (§7.2.1).

Hash matching would only catch what a reviewer already catches. It is
redundant here, and pursuing it would mean chasing membership fees against a
zero-cost constraint for no marginal safety.

**Record the reasoning precisely, because the shorthand is wrong.** It is
*not* that arbitrary image upload is impossible — a modified client or a
direct authenticated POST can send any bytes it likes under a buildpic label,
and the server cannot verify provenance. It is that **the moderation queue
reviews all of it before anything is served publicly.**

**Trigger to revisit:** if untrusted uploads are ever auto-approved, if the
queue is bypassed for any class of user-supplied content, or if a high-volume
upload channel is added. Any of those removes the thing this decision rests
on.

### 7.7 UK regulatory context

Coilbase is UK-operated and is a user-to-user service, bringing it within
scope of the Online Safety Act 2023. Duties around illegal content — CSEA
specifically — apply to small services, including an illegal-content risk
assessment. Ofcom is the regulator.

Reporting routes: the Internet Watch Foundation and NCA-CEOP in the UK; NCMEC
is the US route and may also apply given US-based infrastructure providers.

**This is not legal advice** and was not written by a lawyer — the maintainer
should confirm the specific obligations that apply before untrusted users can
upload anything.

---

## 8. Upload path

**Client-direct upload with a server-issued scoped token.** The Vercel route
authenticates the user, applies quota and identity checks, and issues a token
constrained to the intended content type and maximum size. The client then
uploads directly to Blob. Bytes do not pass through a function.

**Web frontend:** use Vercel Blob's client-upload flow (`@vercel/blob/client`)
with the token-issuing route as its handler. Note that the upload-completed
callback does not fire against localhost, so local development needs the
`/api/assets/confirm` route as the primary path rather than relying on it.

**Coilbox uploads via an authenticated Vercel route.** Not client-direct.

The `vercel_blob` Rust crate was evaluated and **rejected**: a single release,
last updated roughly three years ago. Effectively unmaintained, and not
something to put a shipped desktop client on.

The path instead:

```
Coilbox  --(auth'd multipart POST)-->  Vercel route  --(@vercel/blob put())-->  Blob
```

**This is a better arrangement than client-direct would have been, not a
compromise:**

- **It depends only on officially supported surfaces.** Coilbox performs an
  authenticated HTTPS POST — trivial with `reqwest` — and the proprietary Blob
  API is handled by Vercel's own SDK, running on Vercel.
- **The 4.5 MB function body limit is not a constraint here.** Every asset
  class in scope is far below it (§8.1), and the maintainer has accepted the
  limit.
- **The Fast Data Transfer cost is negligible.** Server Uploads do incur FDT,
  unlike Client Uploads — but uploads are long-tail only, because the seed
  import goes straight to git and never touches Blob (§4.7). Tens of megabytes
  a month against a 100 GB allowance.
- **One fewer dependency**, and no unmaintained crate to inherit.

**Do not reverse-engineer the Blob HTTP contract** from the `@vercel/blob`
source to get a client-direct path from Rust. It would work, but it is an
unpublished interface: Vercel can change it without notice or a version bump,
and the failure would surface as a broken desktop client already in users'
hands. The route proxy costs a little bandwidth and buys a supported contract.

The **web frontend** can still use `@vercel/blob/client` for client-direct
upload, since it is a JS environment and the SDK is the supported path there.
Using different mechanisms for the two clients is fine — they share the auth,
quota and identity checks, which is where the logic that matters lives.

### 8.1 The 4.5 MB limit is acceptable, and useful

**Vercel functions have a 4.5 MB request body limit.**

With campaigns out of scope (§7.1), **every asset class in scope is far below
that ceiling**: buildpics ~5–10 KB, minimaps and renders ~40–150 KB. The
maintainer has accepted the limit rather than designing around it, which is
what makes the route-proxy path in §8 viable.

Two things follow, both good:

- **It is free per-object size enforcement.** The platform rejects anything
  over 4.5 MB before your code runs. The per-object cap in §5 still belongs in
  the request check — defence in depth, and it lets you set a much tighter
  realistic limit — but the backstop costs nothing.
- **It removes the only hard dependency on client-direct upload**, which in
  turn removes the dependency on an unmaintained Rust crate.

If large assets are ever reintroduced (campaigns, §7.1), this section and §8
both need revisiting together — the route proxy would stop working and the
client-direct problem would return.

Credential handling: any Blob read/write token lives in Vercel environment
variables (`vercel env add`), encrypted at rest, injected server-side only.
**No `NEXT_PUBLIC_` prefix** — anything so prefixed is inlined into the client
bundle. Read them only in server-side route handlers.

---

## 9. Setup

1. Create a Blob store on the Vercel project. Vercel adds
   `BLOB_READ_WRITE_TOKEN` automatically; it is the token required to generate
   client upload tokens (§8). Record the **actual** Hobby allowances from the
   usage dashboard — they are not published in the docs (§4.1).
2. Create the assets repo on GitHub, public, separate from the app repo.
3. Enable GitHub Pages on the assets repo, published by a **custom Actions
   workflow** (this waives the 10-builds-per-hour limit, §4.2.1). Record the
   Pages base URL as the single config value required by §4.3.
4. Run the seed import **locally, committing straight to the assets repo** —
   it never touches Blob. Encode per §4.5, commit, register rows as
   `tier = 'static'`. This is a local script against local files, so there is
   no upload path, no token, and no Blob quota involved.
   **Commit in batches — this is necessary, not advisable.** The minimap seed
   alone is ~215 MB (§5.1); a single publish that size will very likely exceed
   the 10-minute Pages deploy timeout (§4.2.1).

   The seed corpus is hand-curated by the maintainer over many years; it needs
   no moderation pass (§7.2.2).
5. Add the promotion job as a scheduled GitHub Action with commit access.

No Cloudflare account, no Wrangler, no Worker deploy.

---

## 10. Non-goals

- **Cloudflare R2, Workers, or Wrangler.** Removed in rev 3. Staging is Vercel
  Blob (§4.1). If a plan references them, it is working from a stale revision.
- **jsDelivr, in any role.** Removed in rev 4 and **not a fallback either** —
  the 50 MB package limit rules it out for this corpus permanently, not
  situationally (§4.2.1). The durable tier is GitHub Pages.
- Perceptual hashing, similarity thresholds, or near-duplicate detection.
  See §2 — the unique key makes these unnecessary. Do not reintroduce them.
- Multi-account consensus or automated trust scoring. See §7.4.
- Per-version asset retention for units. One set per game shortname
  (assertion #4). Maps are the exception and are keyed per revision (§2).
- **Pre-rendered heatmaps or any other overlay derived from the blueprint
  corpus, stored as an image asset.** See §4.9. Overlays derived from demo
  analysis are a separate, deferred case — also not in scope here.
- Request-time image transformation. All sizing happens before upload.
- Video hosting of any kind. Creators self-host; the hub stores a link.
- **Campaign assets of any kind.** Not supported on the hub. Creators
  self-host, as with video. Deferred entirely — do not design storage,
  gating or large-file handling for them.
- Large-file handling generally. Everything in scope is well under 4.5 MB
  (§8.1). Do not build multipart, resumable or chunked upload.
- Private or access-gated asset classes. Everything served is public (§7.1).
- AVIF, or any format beyond WebP. Ruled out on support breadth (§4.5).
- Trusting client-declared image dimensions. Read them from the bytes (§4.1.2).
- Applying the square-aspect rule to anything but build pics. Minimaps have
  varied aspect ratios by nature (§4.1.2).
- A single shared dimension cap. Unit images are 256px, minimaps 512px
  (§4.1.2).
- `list()` or `head()` against Blob, anywhere. Both are metered operations
  against tight quotas; Postgres holds the answers (§4.1).
- Automated human-imagery detection. Deferred with a trigger condition
  (§7.2.2) — there is nothing for it to catch in the current setup.
- IWF hash list, PhotoDNA, or any automated CSAM hash matching. Considered
  and rejected as redundant against the moderation queue (§7.6) — with a
  trigger condition recorded there.
- The `vercel_blob` Rust crate. Evaluated and rejected as unmaintained (§8).
- Reverse-engineering Vercel Blob's HTTP contract for a Rust client-direct
  path. Unpublished interface; see §8.
- User-supplied screenshots. Not accepted at this stage.
- Fully-qualified asset URLs in the database. Paths only (§4.3).
- Supabase Storage, or `next/image`, for any of this.

---

## 11. Constraints reference

| Limit | Value | Notes |
|---|---|---|
| Vercel Fast Data Transfer | 100 GB/month | Shared: pages + Blob reads. Durable tier is off this meter. |
| Vercel Edge Requests | 1M/month | Also shared with Blob reads |
| Vercel function invocations | 1M/month | |
| Vercel image transformations | 5,000/month | Metered on unique source images — avoid `next/image` |
| Vercel function request body | 4.5 MB | Accepted as a free size cap, and enables the §8 upload path |
| Vercel Blob storage | 1 GB | Confirmed from store dashboard 2026-08-14 |
| Vercel Blob data transfer | 10 GB/month | Confirmed from store dashboard |
| Blob Simple Operations | 10,000/month | Cache MISS or `head()`; cache HITs are free |
| Blob Advanced Operations | 2,000/month | `put()`/`copy()`/`list()`; comfortable on realistic volumes (§4.1.1) |
| Blob `del()` | free | Promotion deletes cost nothing |
| Blob limit exceeded | **30-day loss of access** | Not billable overage — cannot be paid through |
| Supabase database | 500 MB | |
| Supabase egress | 5 GB cached + 5 GB uncached | Not used for assets in rev 3 |
| GitHub Pages site size | **1 GB** | Full corpus ~340 MB of it; see §5.1 |
| Known map corpus | 3,575 (springfiles) | Bounded; ~215 MB at the 512px cap |
| GitHub Pages bandwidth | 100 GB/month, soft | Separate from Vercel's 100 GB |
| GitHub Pages builds | 10/hour, soft | Waived for custom Actions workflows |
| GitHub Pages deploy timeout | 10 minutes | Batch the seed import |
| (rejected) jsDelivr package size | 50 MB | Why Pages was chosen — §4.2.1 |
| Assets repo size | ~1 GB practical | Git history is permanent |

Two operational notes on the same deployment:

- Free Supabase projects pause after ~1 week without API requests. A cron ping
  is required for a low-traffic hub.
- Vercel Hobby is restricted to non-commercial personal use. Relevant if
  donations or sponsor logos are ever added — and now more so, since rev 3
  puts storage on Vercel too.

---

## 12. Content licensing

Buildpics, minimaps, overlay layers and model renders all derive from game and
map archives. Recoil-ecosystem assets are usually permissively licensed, but
this varies by game, by map and by unit pack — and renders are a derivative
work, which may be treated differently from redistributing an extracted image.

Rev 3 raises the stakes here: assets now land in a **public git repository
with permanent history**, so a licensing mistake is considerably harder to
undo than deleting an object from a bucket.

Before seeding or accepting uploads for a given game or map, confirm
redistribution and derivative works are permitted, and record the licence
alongside the entity.

This is a real blocker for a public hub, not a footnote.

---

## 13. Amendments agreed 2026-08-14, after reading the coilbox side

Rev 4 above is unchanged. This section records four points where the design met
what coilbox actually has and had to move. Where this section and an earlier one
disagree, this one wins.

### 13.1 A render is capped on its longest edge, not pinned to a profile

Section 4.1.2 checks a render for equality against a pinned profile. That does
not survive the use case the renders exist for.

The reason to render a unit at all is the hub's blueprint preview: a top down
orthographic view of the real model, scaled to the building's footprint, in
place of a build pic. A build pic is a three quarter icon at a fixed size and
does not tile into a base layout.

Footprints are not square. A 3 by 2 building renders 3 by 2. An equality check
against one pinned size would reject most buildings.

So the render check becomes a maximum on each edge, 256px, the same ceiling as
before. **The square rule stays a build pic property and is not extended to
renders.** The hub cannot verify that a render's aspect matches its footprint,
because it does not hold footprints. That correctness sits in coilbox.

### 13.2 Overlay layers are not all WebP

Section 4.5 requires overlay layers to be lossless and the non-goals rule out
any format but WebP. Those two cannot both hold for a height map.

WebP's lossless mode is 8-bit ARGB. Coilbox extracts height as 16-bit
grayscale, and the linear mapping is deliberate so displacement stays
physically correct. A lossless WebP of it halves the precision, which is
exactly the quiet corruption the overlay rule is written to prevent.

`overlay:height` therefore keeps a format that carries 16 bits. The 8-bit
layers, `overlay:metal` and `overlay:type`, stay lossless WebP.

Height also has to carry its bounds. The minimum and maximum world height are
what turn samples back into elmos, nothing downstream can recover them, and
they belong on the row rather than in the image.

### 13.3 A metal map is stored as values, not as the picture coilbox draws

Restating the overlay rule in the terms the extraction side needs. Coilbox
already renders a metal overlay for display by mapping density onto a green
channel and an alpha ramp. That is the right output for drawing and the wrong
one for storage. `overlay:metal` is the raw 8-bit density as unitsync returns
it.

### 13.4 The route prefix is `/api/v1`

Left open in section 6.3 and in coilbox-hub#103. Settled by what already ships:
coilbox's hub client speaks `/api/v1` and nothing else, at `/api/v1/auth`,
`/api/v1/items` and `/api/v1/items/{id}/imported`, and reads a `format` and
`version` envelope off every response. Asset routes join it rather than
starting a second prefix a released desktop build does not know about.

---

## 14. The agreed vocabulary

The strings and numbers both repos have to spell the same way, settled in
tomjn/coilbox#1622. Section 13 wins over anything earlier that disagrees, and
this section wins over section 13, which it only extends rather than revises.

Every value here is a hard failure rather than a cosmetic drift. The hub reads
the pixel dimensions off the bytes rather than trusting what a client declares,
and it refuses a variant it does not recognise, so a name spelled differently
in the two repos shows up as a rejected upload on somebody's machine rather
than as a compile error.

### 14.1 Where the list lives

`shared/asset-vocabulary.json` in coilbox is the machine readable half, and it
is one document rather than two. `crates/coilbox-assets` embeds it with
`include_str!` and parses it with serde, and `src/hub/assets/vocabulary.ts`
imports it directly, so the encoder in the unitsync worker, the upload client
in the hub plugin and the renderer in the webview cannot disagree with each
other. Both sides embed it at build time, so the two test files are what stand
between a bad edit and a shipped build.

That solves drift inside coilbox and not across the two repos. The hub keeps
its own copy in `lib/assets/asset.ts` and `lib/assets/caps.ts`, and nothing
makes the two agree. Serving the vocabulary off the `/api/v1/auth` discovery
document would let an old client find out it is behind rather than discover it
one refusal at a time, and that is a hub change: coilbox-hub#165.

### 14.2 The variant names

| Key | Variants |
|---|---|
| `(game, unit_name, variant)` | `buildpic`, `render:<angle>` |
| `(map_name, variant)` | `minimap`, `overlay:metal`, `overlay:type`, `overlay:height` |

The map list is closed and the unit list is not, because an angle is open ended
and a map layer is not. A typo in a map variant mints an identity nothing ever
asks for, so the hub holds that list as a check constraint.

### 14.3 The angle names

`top`, and only `top`. The full variant is `render:top`.

It exists for the blueprint preview and nothing else asks for another. Renders
are the only class in the corpus that scales without a natural bound, so an
angle added on spec is a real cost rather than a spare column. A second angle
arrives with the use case that wants it.

### 14.4 The `encode_profile` names

The field's job is telling last year's output from this year's, so the name
carries the codec, the quality and the size cap and nothing else.

| Class | `encode_profile` |
|---|---|
| `buildpic` | `webp-lossless-256` |
| `render:<angle>` | `webp-q80-256` |
| `minimap` | `webp-q80-512` |
| `overlay:metal` | `webp-lossless-source` |
| `overlay:type` | `webp-lossless-source` |
| `overlay:height` | `png16-lossless-source` |

`source` in the cap position means the class has no pixel cap and keeps
whatever resolution it was extracted at.

**The mapping is class to profile, and it is not one to one.** `overlay:metal`
and `overlay:type` share a name because they share an encoding exactly, and the
row already carries the variant, so nothing is ambiguous. That is the point of
naming the settings rather than the class: a re-encode pass targets the
settings that changed, and a class whose settings did not change is not swept
up in it.

The name changes when a setting changes, so q80 becoming q85 makes
`webp-q80-512` into `webp-q85-512`. It does **not** change when libwebp
produces different bytes from the same settings. That case is already handled,
because the have check compares `source_hash` and never the encoded hash.

Quality is exactly 80 rather than about 80. The name pins it.

### 14.5 The per class dimension caps

The hub's own list, at `lib/assets/caps.ts`. Coilbox holds the same numbers so
it can encode to them rather than discover them from a 413.

| Class | Type | Max edge | Square | Lossless | Bit depth | Grayscale |
|---|---|---|---|---|---|---|
| `buildpic` | `image/webp` | 256px | yes | yes | any | no |
| `render:<angle>` | `image/webp` | 256px | no | no | any | no |
| `minimap` | `image/webp` | 512px | no | no | any | no |
| `overlay:metal` | `image/webp` | as source | no | yes | any | no |
| `overlay:type` | `image/webp` | as source | no | yes | any | no |
| `overlay:height` | `image/png` | as source | no | yes | 16 | yes |

Bytes are capped too, and the number is derived rather than picked: the
uncompressed size of the largest image the edge cap permits, four bytes a
pixel. So 262,144 bytes for a unit image and 1,048,576 for a minimap. No
encoding of a picture the class allows can reach it, and anything that does is
carrying something other than the picture, which is how a 256px build pic
arrives as two megabytes of metadata chunks.

The overlays have no edge cap to derive one from. `overlay:metal` and
`overlay:type` fall through to a 2 MB backstop. `overlay:height` gets a number
per upload out of the map's own size, two bytes for each of
`floor(elmos / 8) + 1` samples on each edge, which is coilbox-hub#142.

### 14.6 The render framing rule

**The one thing the hub cannot check, because it does not hold footprints.**
Being wrong here is caught nowhere downstream. Implemented at `renderFrame` in
`src/hub/assets/vocabulary.ts`, for tomjn/coilbox#1631.

**The footprint sets the aspect.** A 3 by 2 building renders 3 by 2 and never
square. A build pic is a three quarter icon at a fixed size and does not tile
into a base layout, which is the whole reason a render exists.

**The frame carries a bleed of one whole build square on each side.** Models
overhang their footprints, so a frame taken exactly on the footprint clips
them, and a clipped radar dish reads as broken where a centred one does not.
The bleed is a whole square rather than a fraction so the consumer can add it
back exactly: it knows the footprint, so the footprint is the central
`footprintX` by `footprintZ` squares of a `footprintX + 2` by `footprintZ + 2`
frame, inset by one square on every side.

`footprintX` and `footprintZ` are the unitdef's `footprintx` and `footprintz`
in build squares, as `--unit-dataset` reports them, and the engine floors both
at 1. A build square is 16 elmos, two of the engine's `SQUARE_SIZE`, the same
conversion `src/lego/unitDef.ts` uses.

So for a footprint of `fx` by `fz`:

```
squaresX        = fx + 2
squaresZ        = fz + 2
camera extent   = squaresX * 16 by squaresZ * 16 elmos, orthographic,
                  centred on the footprint's centre
pixelsPerSquare = max(1, floor(256 / max(squaresX, squaresZ)))
image           = squaresX * pixelsPerSquare by squaresZ * pixelsPerSquare
```

Pixels come out as a whole number per square so the encoded aspect is exactly
the framed aspect rather than a rounding of it, and the longest edge lands at
or under the 256px cap without a separate check.

**Orientation, which is easier to rediscover wrongly than to look up.** The
model's `+z` is the front and its `+x` is the unit's left. Looking down on it,
the front is the top of the image and the unit's left is the left of the image,
so the image's rightwards axis is world `-x` and its downwards axis is world
`-z`.
