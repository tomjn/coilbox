# Portable mode

Portable mode runs coilbox from one folder. All of its settings, caches and downloads live in a `.coilbox` folder next to the app, instead of in the usual hidden per-user locations. Nothing is scattered across your system, and deleting the folder removes coilbox completely.

This page is for someone running coilbox for themselves, for example trying it next to skylobby. If you make a game and want to ship coilbox to your players, portable mode is also what a package is built on. [Package coilbox with your game](../developers/distributing.md) covers that.

## Turn on portable mode

Coilbox is in portable mode **if, and only if, there is a folder named `.coilbox` next to the executable that contains a `profile.json` file.** Nothing else — no setting, no flag, no command-line switch. Add that file and Coilbox uses the folder for all its own storage; remove it and Coilbox goes back to being a normal per-user install.

```
<a folder you control>/
  coilbox            (Linux)   coilbox.exe (Windows)   Coilbox.app (macOS)
  .coilbox/
    profile.json     <- this file is what enables portable mode
```

> **Why a `profile.json`, not just the folder?** On Windows the installer now tucks Coilbox's own sidecar binaries into `.coilbox` to keep the install folder tidy, so a bare `.coilbox` folder exists for *ordinary* installs too. The `profile.json` is the specific marker that says "this is a portable/distribution package". If you only want portability (no branding), an empty `{}` in `profile.json` is enough — see [distribution-profile.md](../developers/distribution-profile.md).

On **macOS** the `.coilbox` folder sits **beside `Coilbox.app`**, not inside it. (Coilbox looks up from the executable buried in `Coilbox.app/Contents/MacOS/` and anchors on the folder the `.app` lives in.)

In **development** (`bun tauri dev`) the binary runs from `target/debug/`, so the folder is `target/debug/.coilbox/`.

> The leading dot matters: the folder must be exactly `.coilbox`. On Windows, Explorer will let you create it if you type `.coilbox` with the trailing dot as well (`.coilbox.`) and it'll drop the trailing one; or create it from a terminal with `mkdir .coilbox`.

## What is in the `.coilbox` folder

Once portable mode is on, Coilbox writes **its own** data and caches inside `.coilbox`, and you place any distribution files (profile, campaigns, media) directly in there too:

```
.coilbox/
  profile.json       # you add this — REQUIRED to enable portable mode ({} is fine)
  data/              # created by Coilbox: its settings, state, downloads
  cache/             # created by Coilbox: thumbnails, unitsync caches, etc.
  campaigns/         # you add these (optional) — bundled campaigns
    my-campaign.json
  scenarios/         # you add these (optional) — bundled scenarios
    my-mission.json
  content/           # you add this (optional): a bundled engine, game and maps, read only
  images/            # you add these (optional) — media referenced by profile/campaigns
  briefings/
  fonts/
  # On Windows the installer also places Coilbox's sidecar binaries
  # (coilbox-unitsync-worker.exe, uberstress.exe, prdownloader/, mapconv/) here,
  # and its own read-only data (the branding catalog, mission runtime and lego
  # parts pack) in resources/. Both are the installer's — leave them alone, and
  # note that resources/ is wiped and rewritten on every update.
```

- **`data/` and `cache/`** are Coilbox's business. It creates and manages them on first run. You never edit them by hand. Deleting `cache/` is always safe (it's rebuilt); deleting `data/` resets Coilbox's settings for that package.
- **Everything else** in `.coilbox/` is content *you* put there: `profile.json`, `campaigns/`, `scenarios/`, and any media (`images/`, `briefings/`, `fonts/`, or whatever folder names you reference). These are read-only from Coilbox's point of view.

**Important distinction:** this covers Coilbox's *own* files. It does **not** automatically include the game itself — the engine, the `.sdz`/`.sd7` game archive, and maps. Those are **content**, and where they live is a separate choice. A portable coilbox reads them from the app folder and from any folder you add, as the next section describes.

> **Put the game *beside* `.coilbox/`, not inside it.** `.coilbox/` is Coilbox's private data/config folder. Your engine, game archive and maps go at the **top level of the app folder** (the folder holding the binary and `.coilbox/`), in the standard Spring subfolders — `games/`, `maps/`, `engine/` — **not** inside `.coilbox/`. The app folder itself is the content root: it looks like an ordinary `~/.spring`-style data directory that happens to also contain `coilbox` and `.coilbox/`. Nesting the game under `.coilbox/` mixes your read-only content in with Coilbox's managed `data/`/`cache/`, won't be picked up as a content root, and could be lost if Coilbox's data is reset. The one exception is `.coilbox/content/`, a read-only bundle that coilbox searches after the app folder. See [Bundle the engine, the game and maps](../developers/distributing.md#bundle-the-engine-the-game-and-maps).

## Which games and maps a portable Coilbox sees

A portable Coilbox sees only the content in its own folders: the app folder, `.coilbox/content/`, and any folder added in **Settings > Content Folders**. A game or map the player has elsewhere, in `~/.spring` or `Documents\My Games\Spring` for example, does not appear.

Coilbox does this by starting the engine with `SPRING_ISOLATED` set to the engine's own folder. Without it the engine reads those per-user folders itself, whatever Coilbox asked for. The engine also writes its settings, logs and replays into its own folder instead of a per-user one.

To use content from another folder, add that folder in **Settings > Content Folders**.

## Run coilbox alongside skylobby

This is the common starting point: you already play via skylobby and you want to try Coilbox without disturbing anything.

1. Put the Coilbox binary in a folder of its own (anywhere — Desktop, a games folder, wherever).
2. Create a `.coilbox` folder next to it containing a `profile.json` file. An empty `{}` is enough if you don't want any branding — the file's presence is what turns portable mode on. That's it.
3. Launch Coilbox. On first run it offers to find your existing Spring/Recoil data. Point it at the **same data folder skylobby uses** (where your engine, games and maps already are) via **Settings > Content Folders > Add folder**.

Now both tools read the same games and maps, but Coilbox's own settings and caches stay inside `.coilbox` — it can't overwrite skylobby's configuration or a normal Coilbox install. You can run them side by side, and when you're happy you can stop using skylobby without having migrated anything: Coilbox was reading your real content the whole time.

> Why the isolation works: a normal Coilbox install and a portable one would otherwise share the same per-user storage (they're the same app, same id), and stomp on each other. The `.coilbox` folder gives the portable copy its own private storage, sidestepping that entirely.

Sharing a content folder is read-mostly and safe, but note the two tools are independent: a download you trigger in Coilbox lands in that shared folder and skylobby will see it too, and vice versa. That's usually what you want.

## Check portable mode is on

- **Settings > Distribution profile** tells you whether a profile is loaded and where from. (If you added `profile.json` but it says "No distribution profile loaded", the `.coilbox` folder or the file name/location is wrong.)
- **Settings > Content Folders** shows a **Portable** badge next to any root stored as a relative path — confirmation your bundled content will travel.
- The simplest end-to-end test: **move the whole folder somewhere else and relaunch.** If your settings, profile and bundled content are all still there, the package is genuinely portable.
