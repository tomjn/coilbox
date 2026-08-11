# Keybinds: a keymap editor for uikeys.txt

Spring and Recoil read key bindings from `uikeys.txt` in the data directory. Editing it means editing a text file in a syntax nobody remembers, and the community's answer is a web page that draws a keyboard and hands back a file to download and file away yourself.

Coilbox owns that directory. It knows which engine is selected, where that engine's config lives, and which game the player plays. A keymap editor here reads the file that is already there, shows it on a keyboard, edits it, flags conflicts and writes it back, and the download and the file management stop existing.

The format is the engine's, not a game's, so this works for every game coilbox can launch. A game's own bindings come out of its archive as the baseline to compare against.

This implements issue #1317.

## What the engine actually does

Verified against `rts/Game/Game.cpp` and `rts/Game/UI/KeyBindings.cpp` in RecoilEngine, not from memory. `Game.cpp` runs three calls in order:

```
keyBindings.Init();
keyBindings.LoadDefaults();   // the hardcoded defaultBindings[] table
keyBindings.Load();           // uikeys.txt
```

`Load` reads through `CFileHandler`, whose default mode is `SPRING_VFS_RAW_FIRST`: the raw filesystem first, archives second. So a `uikeys.txt` in the data directory completely shadows the copy a game ships. The moment coilbox writes a file, the game's own bindings stop loading.

That single fact decides the design. The file coilbox writes must be complete, seeded from the game's, or a player who rebinds one key silently loses every binding their game shipped.

The file is a command script rather than a table. `KeyBindings.cpp` executes `bind`, `unbind`, `unbindall`, `unbindaction`, `unbindkeyset`, `keysym`, `fakemeta`, `keyload`, `keyreload`, `keydefaults` and `keydebug`, line by line, and `unbindall` clears everything and re-binds `enter chat` as a floor. Reading the file therefore means running it, not parsing it.

A keyset is `[modifiers]key`, from `KeySet.cpp`: `Any+` (or `*+`), `Alt+` (`a+`), `Ctrl+` (`c+`), `Meta+` (`m+`), `Shift+` (`s+`), and a deprecated `Up+`. The key is a name from the engine's own table (`esc`, `backspace`, `numpad+`), a `0x`-prefixed keycode, or `sc_`-prefixed scancode. Keysets joined by commas are a keychain, pressed in sequence: `Alt+ctrl+a,Alt+ctrl+a`.

One keyset holding several actions is normal and deliberate. `Any+tab` is both `toggleoverview` and `edit_complete`, because only one of them applies while the chat box is open. The editor shows a stack, flags it, and never refuses it.

## Where it lives

A new settings section under Engine Settings:

```
Engine Settings           20   group
  Display                 10
  Graphics                20
  Sound                   30
  Input and camera        40
  In game                 50
  Keybinds                55   new, width lg
  Saved configs           60
```

Id `engine-keybinds`, so the URL is `/settings/engine-keybinds`. It sits above Saved configs because saving is what you do after editing.

The engine and content root come from `useScanTargetSelection` and `BrowserToolbar`, the same picker every other engine settings page uses, so the reader follows the player between pages. The file path is `dirname(configPath)/uikeys.txt`, where `configPath` is the `springsettings.cfg` path unitsync already reports through `useUnitsyncEngineConfig`. An engine installed under `engine/<version>/` satisfies Recoil's portable mode test and writes its config in there, and taking the path from unitsync means that case needs no path logic of its own. When unitsync reports no config path, the section falls back to the content root and says which file it is editing.

The page also picks a game, because the baseline is per-game while the file is not. It defaults to the `gameName` on the persisted battle draft in `src/play/drafts.ts`, which is the last game the player set up, and falls back to the first game in the scan when that game is not installed.

## The model

Three layers, resolved in the engine's order:

```
engineDefaults      generated from defaultBindings[] in KeyBindings.cpp
  → gameDefaults    the selected game's uikeys.txt, read with unitsync_archive_file
    → userFile      uikeys.txt on disk, when there is one
      = effective   [{ keyset, action, source, order }]
```

`src/content/uikeys.ts` holds this and nothing else: no React, no Tauri, no I/O. It is the piece that has to be right, so it is the piece that is a pure function.

- `parseUikeys(text)` returns a line list, keeping comments and lines it does not execute.
- `applyUikeys(state, lines)` executes `bind`, `unbind`, `unbindall`, `unbindaction`, `unbindkeyset`, `keysym` and `fakemeta`, in file order.
- `serialiseUikeys(state)` writes a complete file.
- `parseKeySet` / `formatKeySet` handle the modifier grammar, keychains and the `sc_` and `0x` forms.

`keyload` and `keyreload` are not followed. A file that uses them keeps them verbatim and the section says the file includes another it cannot follow, rather than showing a keymap that is missing half of itself. `keydebug`, `keysave`, `keyprint` and anything unrecognised are also carried through untouched, in place.

Every effective binding carries where it came from: engine, game, or you. That is what makes "reset this key" mean "put back what the game said", and what lets the list show at a glance which keys a player has actually changed.

## Writing

A write produces a self-contained file: a header comment saying coilbox wrote it and that editing it by hand is fine, then `unbindall`, then `fakemeta`, `keysym` and preserved lines, then every effective binding in order.

Before the first write to a file coilbox did not author, the existing file is copied to `uikeys.txt.bak`. Insurance against the one case that matters, a player who had a hand-written file and did not expect the editor to take it over.

Conflicts do not block a write. The list marks a keyset that holds more than one action and shows the order they resolve in, because that is a thing the engine does on purpose and the player may want.

## Rust

A new `keybinds.rs` in `tauri-plugin-coilbox-content`, following `settings_backup.rs`:

- `keybinds_read { configDir }` returns the path, whether it exists, and the text.
- `keybinds_write { configDir, text }` writes it, taking the one-time backup.
- `keymaps_list { rootPath }`, `keymaps_save { rootPath, name, keymap }`, `keymaps_delete { rootPath, slug }` store saved keymaps as one JSON file each under the app data dir, keyed by a hash of the root path, exactly as config snapshots are, so they travel with a portable install.

Commands go in `build.rs` COMMANDS and `permissions/default.toml`, and bindings in `src/content/bindings.ts` next to the existing config-profile ones.

## The generated tables

`scripts/engine-keybinds.ts` reads `KeyBindings.cpp` and `KeyCodes.cpp` from RecoilEngine at the ref pinned in `scripts/recoil-keybinds-version.txt` (tag `2026.07.04`), and writes `src/content/engineKeybinds.generated.ts`: the default binding table, and the engine's key name table.

Taking the key names from `KeyCodes.cpp` rather than writing them out means the keyboard is labelled with the names the engine parses, which is the difference between a working editor and one that writes `escape` where the file needed `esc`. The script is run by hand and its output is committed, so CI runs nothing and works offline. Bumping the pin is a one line change and a regenerate.

## The editor

`KeybindsSection.tsx`, two panels.

The keyboard on top is an ANSI layout described as data (rows of key, label, width), each key mapped to an engine key name. Keys are tinted by state: unbound, bound, changed by you. Modifier layers are tabs across the top, plain, Shift, Ctrl, Alt and Any, so the whole keymap is reachable without holding anything down. Clicking a key opens what it does, where each binding came from, and controls to add, remove, or reset it to the game's answer. Binding by pressing a key is a capture field inside that editor, not a mode the whole page is in.

The list below is every binding, searchable by key or action, showing provenance and conflict flags. It is where keychains live, since a two-key sequence has nowhere sensible to sit on a keyboard graphic, and where a player finds a binding when they know the action and not the key.

A raw text view shows the file as it will be written, for anything the editor cannot express and for a player who would rather read the file.

Actions are shown by their engine name. There is no catalogue of friendly descriptions, because there is no machine-readable source for one: engine actions are registered across the game command sources and Lua widgets add their own at runtime, so a hand-written list would be wrong for every game that is not the one it was written against.

## Saved keymaps and sharing

A saved keymap is a name, the game it was built for, and the binding list, stored structured rather than as text so it can be reopened in the editor. Applying one writes the file for the selected target. This is separate from Saved configs, which snapshots `springsettings.cfg`, `LuaUI/Config` and `uikeys.txt` together: that is for moving a whole setup, this is for a keymap on its own.

Export and import go through the existing container format with a new kind, `keymap` at `kindVersion: 1`, alongside `campaign`, `preset`, `challenge`, `setup-pack` and `scenario`. Nothing new is invented for sharing, because a keymap is a file and a code like everything else.

## Testing

The interpreter is the risk, so it carries the tests, in `src/content/uikeys.test.ts`:

- parse then serialise round trips a file, preserving comments and unknown commands in place
- `unbindall` clears, and leaves `enter chat` behind as the engine does
- `unbind` of a binding that is not there is a no-op, not an error
- `unbindaction` and `unbindkeyset` remove the right things
- keychains parse, resolve and serialise unchanged
- selection strings (`AllMap+_Builder_Idle+_ClearSelection_SelectOne+`) survive as opaque action text
- modifier abbreviations (`c+a`) resolve to the same keyset as their long forms
- layering engine defaults, then a game file that starts with `unbindall`, gives the game's keymap and nothing else
- provenance is correct across the three layers

Rust tests in `keybinds.rs` cover read of a missing file, write with and without an existing file, that the backup is taken once and not on the second write, and saved keymap create, list and delete, mirroring the existing `settings_backup` tests.

## Out of scope

Switching keymap automatically when a game launches. An in-app mode to test a binding without starting a game. Friendly names for actions.
