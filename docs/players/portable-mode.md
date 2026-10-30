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

> Why a `profile.json` and not just the folder? The Windows installer puts some of coilbox's own files in a `.coilbox` folder, so an ordinary install can have one too. The `profile.json` file is what marks a copy of coilbox as portable. An empty `{}` is enough.

On **macOS** the `.coilbox` folder sits **beside `Coilbox.app`**, not inside it. (Coilbox looks up from the executable buried in `Coilbox.app/Contents/MacOS/` and anchors on the folder the `.app` lives in.)

> The leading dot matters: the folder must be exactly `.coilbox`. On Windows, Explorer will let you create it if you type `.coilbox` with the trailing dot as well (`.coilbox.`) and it'll drop the trailing one; or create it from a terminal with `mkdir .coilbox`.

## Windows needs the WebView2 runtime

Coilbox on Windows needs Microsoft's WebView2 runtime. Most Windows 10 and 11 machines already have it. The installer adds it if it is missing, but the portable zip installs nothing, so on a machine without it coilbox says so and offers Microsoft's download. Run that installer, then start coilbox again.

## What is in the `.coilbox` folder

Once portable mode is on, coilbox keeps its own settings and caches in the `.coilbox` folder:

```
.coilbox/
  profile.json       you add this, and {} is enough
  data/              coilbox creates this for its settings and state
  cache/             coilbox creates this for thumbnails and unitsync caches
```

A copy of coilbox packaged with a game may hold more in here, such as bundled campaigns or the game itself. Leave those files where they are.

On Windows, a copy you installed with the installer also keeps its helper programs and a `resources` folder in here. They belong to the installer, and an update replaces them.

- Deleting `cache/` is always safe. Coilbox rebuilds it.
- Deleting `data/` resets coilbox's settings for this copy.
- Do not edit either folder by hand.

Your games, maps and engine are not in this folder. Coilbox finds them in the app folder and in any folder you add, as the next section describes.

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
- Settings > Content Folders shows a Portable badge next to a folder stored relative to the app folder. That folder moves with coilbox.
- To test it from end to end, move the whole folder somewhere else and relaunch. Your settings, profile and games should all still be there.
