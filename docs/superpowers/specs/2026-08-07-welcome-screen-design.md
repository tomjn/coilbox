# Welcome screen design

Coilbox takes ownership of the home page and replaces picoframe's built-in launcher with a screen that reacts to what you were last doing, shows real artwork on its tool cards, and gives profile distributions control over every part of it.

## Why

picoframe ships a launcher so an app has a usable home from day one. Coilbox has relied on that placeholder, and it now shows: the page greets a returning player with "Choose a tool to get started" and a grid of monochrome icons, saying nothing about the Warpath run they abandoned mid-sector or the campaign mission waiting for them. picoframe's launcher is domain-agnostic by design and always will be, so the fix is not to push game concepts upstream. Coilbox needs its own welcome screen.

Profile distributions already lean on the current welcome heavily. Nothing they rely on may break.

## Ownership

Coilbox forks the launcher. `src/main.tsx` sets `home` unconditionally instead of only when `profile.welcome` is present, and picoframe's `Home` is no longer used. Enhancements are not pushed upstream, because the valuable ones (resume your Warpath run, next campaign mission) are exactly the ones picoframe cannot take.

## Structure

```
src/home/
  CoilboxHome.tsx      decides: wholesale welcome vs zone layout
  layout.ts            layout registry, resolves profile config over defaults
  zones/
    Greeting.tsx  Continue.tsx  ResumeRail.tsx  ToolCards.tsx
    FeaturedMap.tsx  Onboarding.tsx  Custom.tsx
  art.ts               resolveCardArt(toolId) -> url
  continue.ts          ranks resume candidates
  background.ts        page backdrop resolution
```

`CoilboxHome` routes on the profile:

```
profile.welcome?.html present -> BrandedWelcome exactly as today,
                                 plus onboarding above/below/off
otherwise                     -> the configured layout
```

Existing distributions render byte-identically, because they have no `home` key and their `welcome.html` still takes the whole page.

Three rules hold the structure together:

1. Zones are self-contained and return null when they have nothing to show. A zone never reads another zone's state, so a future layout can rearrange them without changes.
2. One art resolver. Every zone showing card art calls `resolveCardArt`, and no zone carries its own fallback logic.
3. `home.top` and `home.bottom` slots stay rendered so picoframe plugins injecting there keep working.

State comes from what already exists: `useRuns` and `useRunMeta` for Warpath, `resumeMissionId` and `useCampaignProgress` for campaigns, `useConquestState` for conquest, the rejoin path from #979, and the recency-sorted login list from #458. No new persistence.

## Layouts as a compatibility contract

`layout.ts` holds a registry with one entry, `stacked`. The name is not decoration: it is how a future overhaul avoids breaking distributions.

```
profile.home.layout unset      -> current Coilbox default, moves with us
profile.home.layout "stacked"  -> pinned, survives a change of default
```

A total redesign later ships as a new registry entry plus a change of default. Distributions that pinned keep the screen they built against. This obliges zone components to stay layout-agnostic, since the old layout must keep rendering them.

## Zones

```
Greeting     logged in -> "Welcome back, <user>", otherwise the app title
             tagline: has-resume -> "Pick up where you left off."
                      otherwise  -> action copy, overridable by a distro
Continue     candidates: warpath run | campaign next mission | conquest
                         | rejoinable battle
                         | last skirmish setup (play/drafts, presets touchedAt)
             rank: recency, with time-critical entries pre-empting
             empty -> renders nothing
ResumeRail   the runners-up Continue did not take, capped at 3
             logged out with a saved login -> "Log in as <lastUser>" card
             empty -> renders nothing
ToolCards    nav-derived, groups preserved, art via resolveCardArt
FeaturedMap  one map, always
Onboarding   existing SetupCard and GetStartedCard, behaviour unchanged
Custom       distro markup, plus before and after slots on every zone above
```

### Continue ranking

Most recently touched wins, whatever its type. An entry whose window expires pre-empts: a battle you can still rejoin beats a Warpath run you touched an hour ago, because the rejoin window closes and the run waits indefinitely.

Two rules, each explainable in a sentence, and the ranking is a pure function over collected candidates so it can be unit tested without the UI.

### Continue on a fresh install

Continue renders nothing when there is nothing to resume. The Onboarding zone already owns first run, and a new user should see one call to action rather than two competing ones.

### Featured map

A curated list in the GitHub `catalog.json` already used for map packs, rotated deterministically by date so everyone sees the same map on the same day. When a lobby connection happens to be live, a map an open battle is using is preferred. The card installs the map.

This works offline and logged out, and keeps promotion under editorial control.

## Card art

Four sources, tried in order:

1. Distribution override for that tool
2. Content derived from the user's install: last-played map minimap, current campaign panorama, the Warpath run's galaxy, the last replay's minimap, game header art
3. A bundled illustration, where one exists for that tool
4. A procedural pattern seeded from the tool id and theme colour

Step 4 always succeeds, so no card is ever artless and the milestone is not blocked on commissioning artwork. Step 2 is cheap because #982 moved minimap and header rendering onto the `coilbox://` protocol, so card art is a URL rather than a base64 payload in the home page's first paint.

`art: false` for a tool falls back to the icon-only card, so the current card design survives as a rendering mode.

## Distribution contract

```jsonc
{
  "welcome":    { "html": "…", "css": "…" },   // unchanged, wholesale replacement
  "onboarding": "below",                        // unchanged

  "home": {
    "layout": "stacked",
    "background": "@.coilbox/art/bg.jpg",       // or false
    "zones": [
      { "zone": "greeting", "title": "…", "tagline": "…" },
      { "zone": "continue" },
      { "zone": "cards",
        "art": { "warpath": "@.coilbox/art/warpath.png", "replays": false } },
      { "html": "@.coilbox/community.html" },   // custom zone, any position
      { "zone": "featured", "before": "<p>This week's pick</p>" }
    ]
  }
}
```

- `home` omitted: the Coilbox default. Existing distributions are unaffected.
- `zones` present: that list is the page, in that order. Omitting a zone hides it, so there is no separate enabled flag. A distribution that lists zones will not pick up zones Coilbox adds later, which is the same pin-versus-track trade as `layout` and is opted into by writing the key.
- Every built-in entry accepts `before` and `after` markup. Custom `html` entries sit between zones. Together these cover a sentence at the head of a zone and a community feed at the foot of the page, without a third mechanism.
- `art` maps tool id to a file reference or `false`. It replaces step 1 of the resolution chain, and unlisted tools still walk the rest.
- Wholesale replacement via `welcome.html` remains, and remains the escape hatch.

All distribution markup reuses the existing trusted path: `@.coilbox/…` file references, `coilbox://` asset rewriting through `rewriteBrandedHtml` and `rewriteBrandedCss`, and `data-coilbox-action` click delegation. The security argument in `BrandedWelcome.tsx` is that the markup ships inside the distribution at the same trust level as the binary, and custom zones inherit that argument rather than opening a new one. No CSP change, because distribution HTML still carries no script.

## Testing

- `continue.ts` ranking: unit tests over constructed candidate sets, including an expiring rejoin beating a more recent run, and an empty set.
- `resolveCardArt`: unit tests for each step of the chain, including `art: false` and a fresh install falling through to procedural.
- Zone config resolution: unit tests for `home` omitted, `zones` listed, unknown zone names, and unknown layout names.
- Every zone: empty, loading and offline states.
- Live verification in `bun tauri dev` across vanilla and a branded profile, including an existing distribution confirming no visual change.

## Out of scope

- A branded banner behind the title. The plain heading is preferred.
- A live multiplayer strip of players online and open battles.
- A second layout. The registry exists, but only `stacked` is built.
- Per-zone wholesale markup replacement. The before and after slots plus custom zones cover the need.

## Delivery

Twenty issues in six clusters.

```
FOUNDATION (nothing visible changes)
 1  Coilbox owns "/": src/home/CoilboxHome, stacked layout, layout registry.
    main.tsx sets home unconditionally. BrandedWelcome path preserved.
    home.top/home.bottom slots still rendered. Parity with picoframe's launcher.
 2  Onboarding cards become a zone, dropping the home.top registration in
    src/content/index.ts.                                        [needs 1]
 3  Greeting zone: title, tagline, logged-in name.                [needs 1]

ART
 4  resolveCardArt chain and procedural generator.
 5  Content-derived sources per tool.                             [needs 4]
 6  Bundled illustrations for whichever tools we have art for.    [needs 4]
 7  Tool cards render art edge to edge, icon-only retained.       [needs 4]

CONTINUE
 8  continue.ts candidate collection and ranking, unit tested.
 9  Continue hero zone.                                           [needs 1, 8]
10  Resume rail zone, capped at 3, plus the log-in-as card.       [needs 8, 9]

FEATURED AND BACKGROUND
11  Featured map zone: curated list, daily rotation, install.     [needs 1]
12  Prefer a map an open battle is using when connected.          [needs 11]
13  Page background resolution and default backdrop.              [needs 1]

DISTRO CONTRACT
14  profile.home schema, validation, defaults, zone resolution.   [needs 1]
15  before/after markup and custom html zones.                    [needs 14]
16  Per-tool art override and art:false.                          [needs 14, 7]
17  Authoring docs and a worked example config.                   [needs 14, 15, 16]

POLISH
18  Empty, loading and offline states audited across every zone.
19  Accessibility and reduced-motion pass.
20  Live verification in bun tauri dev, vanilla and branded.
```

Issue 1 changes the page every user lands on and is the riskiest in the milestone, so it carries no visual change. A regression there is then unambiguous.

Issue 5 is the most likely to split, since each content source has its own missing-content case. Issue 12 is the only issue that can be cut without leaving a hole.
