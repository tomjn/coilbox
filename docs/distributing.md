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
                                    .coilbox/          (hidden; profile.json inside)
                                    game/              (optional bundled content)

SplinterFaction-linux.zip     ->  SplinterFaction/
                                    coilbox.AppImage
                                    .coilbox/
                                    game/

SplinterFaction-mac.zip       ->  SplinterFaction/
                                    Coilbox.app
                                    .coilbox/          (BESIDE the .app, not inside)
                                    game/
```

The player unzips one of these and runs the binary directly.

## Per-OS notes

| OS | Binary | Where `.coilbox` goes | Package as |
| --- | --- | --- | --- |
| Windows | `coilbox.exe` | Beside the `.exe` | `.zip` |
| Linux | `coilbox.AppImage` (`chmod +x`, then run) | Beside the `.AppImage` | `.zip` (or `.tar.gz`) |
| macOS | `Coilbox.app` | **Beside** `Coilbox.app` (Coilbox looks up out of `Coilbox.app/Contents/MacOS/` and anchors on the folder the bundle sits in) | `.zip`, **not `.dmg`** |

> **Why a `.zip` for macOS, not a `.dmg`.** A `.dmg` nudges the player to drag only `Coilbox.app` into their Applications folder — which orphans the `.coilbox` folder and the game beside it, so portable mode never turns on. A `.zip` that expands to a single `SplinterFaction/` folder keeps the three pieces together. The same "ship a folder" logic is why all three targets are zips: if the player relocates a loose binary, the hidden `.coilbox` folder won't come with it.

## The `.coilbox` folder, minimally

Inside each package's `.coilbox/`:

```
.coilbox/
  profile.json    # REQUIRED — presence is what enables portable mode ({} is valid)
  campaigns/      # optional bundled campaigns
  scenarios/      # optional bundled scenarios
  images/ ...     # optional media referenced by the profile/campaigns
```

Coilbox creates `data/` and `cache/` inside `.coilbox/` on first run — you don't ship those. See [portable-mode.md](portable-mode.md#what-lives-where) for the full breakdown, and note the game content goes in a **sibling** folder (e.g. `game/`), never inside `.coilbox/`.

> **A bundled scenario needs a game that can play it.** A file in `scenarios/` is the authored document and nothing else. It is played by [the mission runtime](mission-runtime.md), which lives in the game, so the copy you put in `game/` wants to be a loose `.sdd` with the runtime installed and the adoption guards applied. Bundle a packaged `.sd7` or `.sdz` and every scenario in the package falls back to a generated test game, which plays, but leaves your own end conditions and pre-game phases running over the top of the mission. See [what the other machine needs](scenarios.md#what-the-other-machine-needs).

## Getting the binaries

Each release build produces the per-OS binaries you drop into these packages: Windows `.exe`, Linux `.AppImage`, macOS `.app`. See [portable-mode.md](portable-mode.md#packaging-checklist) for the end-to-end packaging checklist, and [distribution-profile.md](distribution-profile.md) for everything `profile.json` can do (title, theme, hidden nav, welcome screen, links, and self-updating from GitHub releases).

## Verify before you ship

For each package, the one test that matters: **move or rename the whole folder, then launch.** If your settings, profile and bundled content are all still there, the package is genuinely portable. Coilbox's **Settings > Distribution profile** confirms the profile loaded, and **Settings > Content Folders** shows a **Portable** badge on bundled content.
