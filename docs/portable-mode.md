# Portable mode

Portable mode is the way to run Coilbox **self-contained**: all of its settings,
caches and downloads live in a single `.coilbox` folder next to the app, instead
of in the usual hidden per-user locations. It's the foundation everything else in
this folder builds on — a [distribution profile](distribution-profile.md) and
[bundled campaigns](campaigns.md) both live inside `.coilbox`.

There are two audiences for this, and it's worth knowing which one you are:

- **You, running Coilbox for yourself** (e.g. trying it out next to skylobby).
  Portable mode keeps Coilbox from scattering files across your system and lets
  you delete it cleanly later — just remove the folder.
- **A game author shipping Coilbox to players.** Portable mode is what makes a
  drop-in package possible: you hand players a folder they can run without an
  installer, and it can't disturb any other Spring/Recoil tool they already have.

## The one rule that turns it on

Coilbox is in portable mode **if, and only if, there is a folder named
`.coilbox` next to the executable.** Nothing else — no setting, no flag, no
command-line switch. Create that folder and Coilbox uses it; delete it and
Coilbox goes back to being a normal per-user install.

```
<a folder you control>/
  coilbox            (Linux)   coilbox.exe (Windows)   Coilbox.app (macOS)
  .coilbox/          <- create this empty folder to enable portable mode
```

On **macOS** the `.coilbox` folder sits **beside `Coilbox.app`**, not inside it.
(Coilbox looks up from the executable buried in `Coilbox.app/Contents/MacOS/` and
anchors on the folder the `.app` lives in.)

In **development** (`bun tauri dev`) the binary runs from `target/debug/`, so the
folder is `target/debug/.coilbox/`.

> The leading dot matters: the folder must be exactly `.coilbox`. On Windows,
> Explorer will let you create it if you type `.coilbox` with the trailing dot as
> well (`.coilbox.`) and it'll drop the trailing one; or create it from a terminal
> with `mkdir .coilbox`.

## What lives where

Once portable mode is on, Coilbox writes **its own** data and caches inside
`.coilbox`, and you place any distribution files (profile, campaigns, media)
directly in there too:

```
.coilbox/
  data/              # created by Coilbox: its settings, state, downloads
  cache/             # created by Coilbox: thumbnails, unitsync caches, etc.
  profile.json       # you add this (optional) — see distribution-profile.md
  campaigns/         # you add these (optional) — bundled campaigns
    my-campaign.json
  images/            # you add these (optional) — media referenced by profile/campaigns
  briefings/
  fonts/
```

- **`data/` and `cache/`** are Coilbox's business. It creates and manages them on
  first run. You never edit them by hand. Deleting `cache/` is always safe (it's
  rebuilt); deleting `data/` resets Coilbox's settings for that package.
- **Everything else** in `.coilbox/` is content *you* put there: `profile.json`,
  `campaigns/`, and any media (`images/`, `briefings/`, `fonts/`, or whatever
  folder names you reference). These are read-only from Coilbox's point of view.

**Important distinction:** this covers Coilbox's *own* files. It does **not**
automatically include the game itself — the engine, the `.sdz`/`.sd7` game
archive, and maps. Those are **content**, and where they live is a separate
choice covered in [Bundling the game content](#bundling-the-game-content) below.

## Running Coilbox alongside skylobby

This is the common starting point: you already play via skylobby and you want to
try Coilbox without disturbing anything.

1. Put the Coilbox binary in a folder of its own (anywhere — Desktop, a games
   folder, wherever).
2. Create an empty `.coilbox` folder next to it. That's portable mode on.
3. Launch Coilbox. On first run it offers to find your existing Spring/Recoil
   data. Point it at the **same data folder skylobby uses** (where your engine,
   games and maps already are) via **Settings > Content Folders > Add folder**.

Now both tools read the same games and maps, but Coilbox's own settings and
caches stay inside `.coilbox` — it can't overwrite skylobby's configuration or a
normal Coilbox install. You can run them side by side, and when you're happy you
can stop using skylobby without having migrated anything: Coilbox was reading
your real content the whole time.

> Why the isolation works: a normal Coilbox install and a portable one would
> otherwise share the same per-user storage (they're the same app, same id), and
> stomp on each other. The `.coilbox` folder gives the portable copy its own
> private storage, sidestepping that entirely.

Sharing a content folder is read-mostly and safe, but note the two tools are
independent: a download you trigger in Coilbox lands in that shared folder and
skylobby will see it too, and vice versa. That's usually what you want.

## Bundling the game content

If you're **packaging Coilbox to hand to players**, you probably want the game
itself inside the package too, so a player unzips one folder and everything is
there — no separate Spring install, no downloads on first run.

Content (engine + game archive + maps) is tracked as **content roots** —
folders Coilbox scans for game data. A content root can be stored two ways:

- **Absolute** — a fixed path like `/home/you/.spring`. Fine for your own use;
  useless in a package you ship, because the player's paths differ.
- **Portable (relative)** — stored relative to the app folder, so it keeps
  working no matter where the player unzips the package or what they rename the
  parent folder to.

To bundle content portably:

1. Put the engine and game files **inside** the app folder (the folder that
   contains the binary and `.coilbox`). For example a `game/` subfolder holding
   your engine and `.sdz`.
2. In **Settings > Content Folders**, add that folder as a root and tick
   **Portable** (the checkbox is only meaningful in portable mode). Coilbox
   stores it as a relative path and shows a **Portable** badge on the root.

```
SplinterFaction/                 <- the folder you zip and distribute
  coilbox.exe
  .coilbox/
    profile.json
    data/  cache/                (created on first run)
  game/                          <- bundled content, added as a Portable root
    engine/
    splinterfaction.sdz
    maps/
```

Rules to know:

- A **Portable root must live inside the app folder.** Coilbox refuses to store a
  portable root for a folder outside the package — there'd be nothing stable to
  make it relative to.
- In portable mode, roots you add that happen to sit inside the app folder are
  relativised automatically, so they travel with the package even if you forget
  to tick the box.
- Everything downstream (scanning, launching, pr-downloader) receives the
  resolved absolute path, so bundled content behaves exactly like a normal
  install once found.

If you'd rather players download the game on first run instead of bundling it,
skip this and let the profile's [`release`](distribution-profile.md#release-object)
field pull the game archive from a GitHub release, or leave the Downloads pages
visible so they can fetch it themselves.

## Packaging checklist

To ship a branded, self-contained Coilbox for your game:

1. **Get a Coilbox build** for each OS you're targeting (Windows `.exe`, Linux
   binary/AppImage, macOS `.app`). Put each in its own distribution folder.
2. **Add `.coilbox/`** next to the binary.
3. **Add `profile.json`** in `.coilbox/` to brand and narrow the app — title,
   theme, hidden nav, a welcome screen, links. See
   [distribution-profile.md](distribution-profile.md), and
   [routes.md](routes.md) for the exact route/nav ids those fields use.
4. **Bundle the game content** as a Portable root (above), *or* configure
   `release` to download it, *or* leave downloads on for the player to fetch.
5. **Bundle any campaigns** by dropping their exported `.json` into
   `.coilbox/campaigns/` and their media alongside — see
   [campaigns.md](campaigns.md).
6. **Test the package** by moving/renaming the whole folder and launching — a
   correctly-portable package keeps working after it's moved. Confirm
   **Settings > Distribution profile** shows your profile loaded, and that
   bundled content and campaigns appear.
7. **Zip the folder** and distribute. Players unzip and run the binary directly.

> Coilbox has no installer requirement in this mode — the folder *is* the
> install. That's the whole point: a player can keep it on a USB stick, delete it
> cleanly, or run it next to whatever else they already have.

## Verifying it's active

- **Settings > Distribution profile** tells you whether a profile is loaded and
  where from. (If you added `profile.json` but it says "No distribution profile
  loaded", the `.coilbox` folder or the file name/location is wrong.)
- **Settings > Content Folders** shows a **Portable** badge next to any root
  stored as a relative path — confirmation your bundled content will travel.
- The simplest end-to-end test: **move the whole folder somewhere else and
  relaunch.** If your settings, profile and bundled content are all still there,
  the package is genuinely portable.
