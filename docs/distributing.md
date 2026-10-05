# Distributing Coilbox with your game

This is the short, practical guide for **game authors** shipping Coilbox to players: how to lay out and zip a self-contained package for each operating system. It assumes you've already branded and configured the app — for the *why* and the full detail, read [portable-mode.md](portable-mode.md), which this guide condenses.

The goal is one download per OS that a player unzips and runs, with no installer and nothing scattered across their system.

## The idea in one line

On every OS, Coilbox looks for a `.coilbox` folder **next to the binary**. If that folder contains a `profile.json`, Coilbox runs [portable](portable-mode.md): all its settings, caches and downloads stay inside `.coilbox`, and the whole folder is self-contained and movable. The `.exe`, the `.AppImage` and the `.app` are all treated the same way in this respect.

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

## The `.coilbox` folder, minimally

Inside each package's `.coilbox/`:

```
.coilbox/
  profile.json    # REQUIRED — presence is what enables portable mode ({} is valid)
  campaigns/      # optional bundled campaigns
  scenarios/      # optional bundled scenarios
  content/        # optional bundled engine, game and maps, see below
  images/ ...     # optional media referenced by the profile/campaigns
```

Coilbox creates `data/` and `cache/` inside `.coilbox/` on first run — you don't ship those. See [portable-mode.md](portable-mode.md#what-lives-where) for the full breakdown. The engine, the game and maps go in `content/`, described in [Bundle the engine, the game and maps](#bundle-the-engine-the-game-and-maps).

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

## Getting the binaries

Each release build produces the per-OS binaries you drop into these packages: Windows `.exe`, Linux `.AppImage`, macOS `.app`. See [portable-mode.md](portable-mode.md#packaging-checklist) for the end-to-end packaging checklist, and [distribution-profile.md](distribution-profile.md) for everything `profile.json` can do (title, theme, hidden nav, welcome screen, links, and self-updating from GitHub releases).

## Verify before you ship

For each package, the one test that matters: **move or rename the whole folder, then launch.** If your settings, profile and bundled content are all still there, the package is genuinely portable. Coilbox's **Settings > Distribution profile** confirms the profile loaded, and **Settings > Content Folders** shows a **Portable** badge on bundled content.
