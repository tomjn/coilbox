# Package coilbox with your game

This guide is for game authors shipping coilbox to players. It covers how to lay out and zip a self-contained package for each operating system, how to bundle the engine, the game and maps, and how to keep a bundled game up to date. A package is built on [portable mode](../players/portable-mode.md), which explains the `.coilbox` folder from a player's side.

The goal is one download per OS that a player unzips and runs, with no installer and nothing scattered across their system.

## How a package works

On every OS, Coilbox looks for a `.coilbox` folder **next to the binary**. If that folder contains a `profile.json`, Coilbox runs [portable](../players/portable-mode.md): all its settings, caches and downloads stay inside `.coilbox`, and the whole folder is self-contained and movable. The `.exe`, the `.AppImage` and the `.app` are all treated the same way in this respect.

> **Two things people get wrong.** (1) The folder alone does nothing — it must contain a `profile.json` (an empty `{}` works, but you'll want real branding; see [distribution-profile.md](distribution-profile.md)). (2) `.coilbox` is **hidden** on Linux and macOS (the leading dot), so a player who moves the binary out of the folder will silently leave `.coilbox` behind. Ship a **folder**, not loose files — see below.

## One package per OS

You produce three independent packages, one per target. Each is a folder containing the Coilbox binary for that OS, a `.coilbox/` folder beside it, and (optionally) the bundled game content. Name each zip so it's obvious which OS it's for, and make the zip extract to a **named folder**, not loose files.

```
SplinterFaction-windows.zip   ->  SplinterFaction/
                                    coilbox.exe
                                    .coilbox/          (hidden)
                                      profile.json
                                      content/         (optional: the engine, game and maps)

SplinterFaction-linux.zip     ->  SplinterFaction/
                                    coilbox.AppImage
                                    .coilbox/
                                      profile.json
                                      content/

SplinterFaction-mac.zip       ->  SplinterFaction/
                                    Coilbox.app
                                    .coilbox/          (BESIDE the .app, not inside)
                                      profile.json
                                      content/
```

The player unzips one of these and runs the binary directly.

## Per-OS notes

| OS | Binary | Where `.coilbox` goes | Package as |
| --- | --- | --- | --- |
| Windows | `coilbox.exe` | Beside the `.exe` | `.zip` |
| Linux | `coilbox.AppImage` (`chmod +x`, then run) | Beside the `.AppImage` | `.zip` (or `.tar.gz`) |
| macOS | `Coilbox.app` | **Beside** `Coilbox.app` (Coilbox looks up out of `Coilbox.app/Contents/MacOS/` and anchors on the folder the bundle sits in) | `.zip`, **not `.dmg`** |

> **Why a `.zip` for macOS, not a `.dmg`.** A `.dmg` nudges the player to drag only `Coilbox.app` into their Applications folder — which orphans the `.coilbox` folder and the game inside it, so portable mode never turns on. A `.zip` that expands to a single `SplinterFaction/` folder keeps the three pieces together. The same "ship a folder" logic is why all three targets are zips: if the player relocates a loose binary, the hidden `.coilbox` folder won't come with it.

## What goes in the `.coilbox` folder

Inside each package's `.coilbox/`:

```
.coilbox/
  profile.json    # REQUIRED — presence is what enables portable mode ({} is valid)
  campaigns/      # optional bundled campaigns
  scenarios/      # optional bundled scenarios
  content/        # optional bundled engine, game and maps, see below
  images/ ...     # optional media referenced by the profile/campaigns
```

Coilbox creates `data/` and `cache/` inside `.coilbox/` on first run, so you do not ship those. [Portable mode](../players/portable-mode.md#what-is-in-the-coilbox-folder) says what they hold.

Media folders such as `images/`, `briefings/` and `fonts/` can have any name the profile or a campaign refers to. Coilbox reads everything you ship in `.coilbox/` and does not edit it.

On Windows the installer also puts coilbox's helper programs, and a `resources/` folder of its own read only data, inside `.coilbox/`. They belong to the installer and an update replaces them, so do not put your own files in `resources/`.

The engine, the game and maps go in `content/`, described in [Bundle the engine, the game and maps](#bundle-the-engine-the-game-and-maps).

> **A bundled scenario needs a game that can play it.** A file in `.coilbox/scenarios/` is the authored document and nothing else. It is played by [the mission runtime](mission-runtime.md), which lives in the game, so the game you ship with it, in a `games/` folder next to the binary, has to carry the runtime and the two guards from [the adoption contract](mission-runtime.md#the-adoption-contract). It also has to be a loose `.sdd`, because coilbox writes each compiled mission into the game's own `missions/` folder as it launches and cannot write into a packaged archive. For the same reason that `.sdd` cannot go in `.coilbox/content/`, which coilbox never writes into. Ship the game as a `.sd7` or `.sdz` and every scenario in the package falls back to a generated test game. They play, but your end conditions and opening phases run over the top of the mission. See [what a player needs to play your scenario](scenarios.md#what-a-player-needs-to-play-your-scenario).

## Bundle the engine, the game and maps

Put the engine, the game and its maps in `.coilbox/content/` and a new player has nothing to download. They unzip, run and play, with or without a connection. The folder being there is all it takes. There is no profile field for it.

### Lay out the folder

`.coilbox/content/` has the same layout as a Spring data directory, so you build it by copying from a working install:

```
.coilbox/content/
  engine/
    windows64/                  the platform folder
      <version>/                the whole engine folder, as installed
  games/
    SplinterFaction_0.1.86.sdz
  maps/
    duck.sd7
    smalldivide.sd7
  packages/                     only for a rapid game, with pool/ beside it
  pool/
```

Platform folders use the names pr-downloader gives them, so you can copy `engine/` straight out of a data directory: `linux64`, `linux_arm64`, `windows64`, `windows_arm64` and `macos_arm64`. Each package carries the engine for its own operating system. A folder that carries engines for several platforms works too, and coilbox copies only the one for the machine it runs on.

An engine folder straight under `engine/`, with no platform folder around it, counts as the engine for whatever machine the package runs on. Use that layout only when each package has its own `content/` folder.

### What coilbox does with it

- It reads games, maps and rapid packages where they sit. It never writes into `.coilbox/content/`, so the folder can be read-only.
- It searches the folder after the player's own content folder. When the player has an archive with the same file name, theirs is used. A newer version of the game they download sits beside yours, as two downloaded versions would.
- It copies the engine for this machine once, on first run, into the player's download folder at `engine/<platform>/<version>/`. In a portable package the download folder is the app folder unless the player changes it.

The engine is the one thing copied because of where Recoil writes. Recoil writes its caches, logs and replays into an engine's own folder only when that folder is writable. Run from the bundle, it would write them into your bundle, or into `~/.config/spring` or `~/.spring` if the bundle is read-only. A copied engine behaves exactly like one coilbox downloaded.

The copy checks the drive has room for every byte before it writes one. It builds the engine in a `.coilbox-installing` folder and renames it into place when it is complete, so a copy that stops half way never looks like an engine, and the next launch starts it again. It does nothing when the player already has an engine of that version.

### What the player sees

On first launch the Set up Coilbox card on the home page says "Setting up engine" and the engine's version, with a progress bar. The copy also shows in the downloads indicator in the top bar. Once the engine is in place the setup card goes away, and the game and maps in the bundle are found with nothing to download. A bundle with only a few maps can still see the get-started card suggest more.

If the copy fails, the card says why and offers Try again beside the normal engine download. A drive that is too full is reported with both sizes, for example "Setting up the engine needs 142 MB of free space". A bundle with no engine for the player's platform does not show an error. The card offers the engine download as it would without a bundle.

### Sizes

Measured on one Mac with Apple silicon, to help you judge your download size:

| What | Size | Copied on first run |
| --- | --- | --- |
| The engine for `macos_arm64` | 149,066,152 bytes | Yes, in 1.5 to 2.4 seconds |
| `SplinterFaction_0.1.86.sdz` | 769 MB | No |
| A map | 787 KB (`duck.sd7`) to 180 MB (`proving_grounds_v1.0.sd7`) | No |

Only the engine takes space twice on the player's drive, once in the package and once in their download folder.

### Trust

The bundle contains an engine, which is a program coilbox runs. It reaches the player in the same download as coilbox, so it carries the same trust as coilbox itself. Ship only an engine you would put your name to. The copy refuses any link inside the engine that points outside it. It writes plain files, so macOS does not carry the quarantine flag from a downloaded zip across to the engine. That matches an engine coilbox downloads itself.

### Keep `content/` and `data/` apart

They sit side by side in `.coilbox/` and do opposite jobs.

- `.coilbox/content/` is yours. You ship it, coilbox only reads it, and it is searched after the player's own content.
- `.coilbox/data/` is coilbox's. Coilbox creates it on first run and writes the player's settings and state into it. You do not ship it.

The player's own content folder, where downloads and the copied engine go, is the app folder. Nothing coilbox writes ever lands in `content/`.

### A loose `.sdd` game cannot take scenario missions

Coilbox writes each compiled scenario mission into a loose `.sdd` game as it launches. It will not do that inside `.coilbox/content/`. If your package ships scenarios or a campaign with scenario missions, keep the `.sdd` in a `games/` folder beside the binary instead, as in the note above.

### Check the bundle

Settings > Distribution profile has a health checklist. With a bundle present it adds a row that lists what the bundle carries, or one line for each mistake:

- the folder is empty
- an archive at the top of the folder rather than in `games/` or `maps/`
- a file or folder a Spring data directory does not have
- `packages/` without `pool/`
- a folder under `engine/` that is not a platform name
- an engine at the top of the folder
- an engine that cannot be copied, with the reason
- engines only for other platforms, or no engine at all, so players download one
- a loose `.sdd` game

When the profile's [`start`](distribution-profile.md#start-object) leads to a game or map that is neither in the bundle nor on this machine, a second row names it. A new player would be asked to download it before the first lesson.

Settings > Content folders lists the bundle with a "bundled, read only" badge.

To test the package as a player gets it, unzip it on a machine with no Spring install and no connection, and launch it.

## Bundle the game in the app folder

If you're **packaging Coilbox to hand to players**, you probably want the game itself inside the package too, so a player unzips one folder and everything is there — no separate Spring install, no downloads on first run.

There are two places for it. `.coilbox/content/` is a read-only bundle coilbox never writes into, searched after the app folder, with the engine copied out on first run. [Bundle the engine, the game and maps](#bundle-the-engine-the-game-and-maps) covers it. This section covers the other, the app folder itself, which is also where downloads go.

Content (engine + game archive + maps) is tracked as **content roots** — folders Coilbox scans for game data. A content root can be stored two ways:

- **Absolute** — a fixed path like `/home/you/.spring`. Fine for your own use; useless in a package you ship, because the player's paths differ.
- **Portable (relative)** — stored relative to the app folder, so it keeps working no matter where the player unzips the package or what they rename the parent folder to.

To bundle content portably:

1. Lay the game content out **directly in the app folder** (the folder that contains the binary and `.coilbox/`), using the ordinary **Spring/Recoil data-root layout**: the `.sdz`/`.sd7` game archive under a **`games/`** subfolder, maps under **`maps/`**, and the engine under **`engine/`**. Coilbox (like every Spring/Recoil tool) only scans a game archive if it sits in `games/` — a `.sdz` dropped loose in the app folder is invisible. **Do not put any of this inside `.coilbox/`** (see [What is in the `.coilbox` folder](../players/portable-mode.md#what-is-in-the-coilbox-folder)).
2. In **Settings > Content Folders**, add the **app folder itself** as a root and tick **Portable** (the checkbox is only meaningful in portable mode). Coilbox stores it as a relative path (`.` for the app folder) and shows a **Portable** badge. In portable mode the app folder is usually seeded as a root automatically, so it may already be listed.

```
SplinterFaction/                 <- the folder you zip and distribute; THIS is the content root
  coilbox.exe
  .coilbox/                      <- Coilbox's private data (NOT your game)
    profile.json
    data/  cache/                (created on first run)
  games/                         <- bundled content, at the app-folder top level
    splinterfaction.sdz
  maps/
  engine/
```

The app folder plays the role of a `~/.spring`-style data directory: `games/`, `maps/` and `engine/` sit at its top level, right beside `coilbox.exe` and `.coilbox/`. Coilbox ignores `.coilbox/` when scanning content. A layout that buries the game anywhere else inside `.coilbox/` (e.g. `.coilbox/games/…`) is wrong — that content won't be scanned and could be lost when Coilbox's data is reset.

Rules to know:

- A **Portable root must live inside the app folder.** Coilbox refuses to store a portable root for a folder outside the package — there'd be nothing stable to make it relative to.
- In portable mode, roots you add that happen to sit inside the app folder are relativised automatically, so they travel with the package even if you forget to tick the box.
- Everything downstream (scanning, launching, pr-downloader) receives the resolved absolute path, so bundled content behaves exactly like a normal install once found.

## Update a bundled game from GitHub releases

Bundling and GitHub-release updates are **complementary, not an either/or** — the intended setup for a self-updating package is to do both. You ship the current game archive inside the package (so first run works offline), and you also set the profile's [`release`](distribution-profile.md#release-object) field so Coilbox pulls newer versions from your repo's GitHub releases.

How the update check decides whether to prompt:

- On launch, Coilbox fetches your repo's **latest** release and looks at its `.sdz`/`.sd7` assets.
- It considers you up to date if **any** of those asset filenames matches a game archive already installed in your content roots (matched by **filename**, case-insensitive).
- So a bundled archive whose filename equals the latest release's asset name reads as "installed" → no update prompt. When you publish a **new** release with a **new** archive filename, the installed one no longer matches → a **Game update** badge and settings section offer a one-click download.

An update downloads the new archive into the `games/` folder of the content folder chosen for games, rescans content so it appears without a restart, and — if the release also ships an asset named exactly `profile.json` — drops that into `.coilbox/` and offers a restart to apply the refreshed profile.

Two things to get right for this to behave:

- **Version your archive filenames.** `splinterfaction_1.3.sdz` → `splinterfaction_1.4.sdz` gives you "same version = matched, new version = update" for free. A filename that never changes (`splinterfaction.sdz`) would always look installed, so no update ever prompts.
- **Point the download folder at a portable location** (Settings > Content folders, under "New content goes to") if you want updates to land inside the package rather than in a per-user folder. Otherwise the bundled archive and any downloaded update end up in different places.

If instead you'd rather ship a thin package and have players fetch the game on first run, skip bundling and rely on `release` alone, or leave the Downloads pages visible so they can grab it themselves.

## Get the binaries

Each release build produces the per-OS binaries you drop into these packages: Windows `.exe`, Linux `.AppImage`, macOS `.app`. See the [packaging checklist](#packaging-checklist) for every step in order, and [Distribution profiles](distribution-profile.md) for everything `profile.json` can do (title, theme, hidden nav, welcome screen, links, and self-updating from GitHub releases).

## Packaging checklist

To ship a branded, self-contained Coilbox for your game:

1. **Get a Coilbox build** for each OS you're targeting (Windows `.exe`, Linux binary/AppImage, macOS `.app`). Put each in its own distribution folder.
2. **Add `.coilbox/`** next to the binary.
3. **Add `profile.json`** in `.coilbox/` to brand and narrow the app — title, theme, hidden nav, a welcome screen, links. See [distribution-profile.md](distribution-profile.md), and [routes.md](../reference/routes.md) for the exact route/nav ids those fields use.
4. **Bundle the game content**, in [`.coilbox/content/`](#bundle-the-engine-the-game-and-maps) or as a [Portable root in the app folder](#bundle-the-game-in-the-app-folder), *or* configure `release` to download it, *or* leave downloads on for the player to fetch. Bundling plus `release` together gives an offline-ready package that still self-updates.
5. **Bundle any campaigns** by dropping their exported `.json` into `.coilbox/campaigns/` and their media alongside — see [campaigns.md](campaigns.md). Standalone missions go in `.coilbox/scenarios/` the same way — see [scenarios.md](scenarios.md#ship-a-scenario-in-a-distribution).
6. **Test the package** by moving/renaming the whole folder and launching — a correctly-portable package keeps working after it's moved. Confirm **Settings > Distribution profile** shows your profile loaded, and that bundled content and campaigns appear.
7. **Zip the folder** and distribute. Players unzip and run the binary directly.

> Coilbox has no installer requirement in this mode — the folder *is* the install. That's the whole point: a player can keep it on a USB stick, delete it cleanly, or run it next to whatever else they already have.

## Test the package

For each package, the one test that matters: **move or rename the whole folder, then launch.** If your settings, profile and bundled content are all still there, the package is genuinely portable. Coilbox's **Settings > Distribution profile** confirms the profile loaded, and **Settings > Content Folders** shows a **Portable** badge on bundled content.
