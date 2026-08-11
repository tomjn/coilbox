# Settings: player-first order, and a polish pass

Settings grew one section per plugin, all top-level, sorted by `order` where a plugin bothered to set one and alphabetically where it did not. The result is a nineteen row list where a distribution profile sits beside notifications and the page a player most wants (resolution, volume, camera) is buried between Engines and Import.

This reorders the list around who is looking, folds away a section too thin to be one, splits the engine settings page along its own categories, and fixes two faults found while reading: engine enums rendered as free number boxes, and three keychain prompts on opening the hub.

## Order

picoframe composes settings from every plugin's `settings[]`, builds a tree from `parent`, and sorts siblings by `order` (default 100) then title. Groups are sections with no `Component`. The frame renders them as a card index of their children, and the sidebar shows children indented under the parent, always expanded.

```
General                   0
Appearance                10
Engine Settings             20    group, id engine-settings
  Display
  Graphics
  Sound
  Input and camera
  Game
Notifications             30
Coilbox hub               40
Multiplayer               50    group
  Lobby servers
  Chat highlights
  Ignored users
Coilbox updates           60
Game updates              70
Content                   80    group
  Content folders
  Engines
  Downloads
  Storage
  Import
Advanced                  90    group
  mapconv
  uberstress
  Distribution profile
```

Section ids do not change. An id is the URL (`/settings/<id>`), the merge key in `composeSettings`, and what a distribution profile names in `hideSettings`, so titles are free to change and ids are not. One title changes: "Updates" becomes "Coilbox updates", so the two update pages read as different things. Engine Settings keeps its name and becomes a group over its five categories.

Coilbox updates stays top-level rather than joining Advanced. It is how a player gets fixes.

## Battle downloads folds into Downloads

`battle-downloads` was a page holding one switch. Its control moves into the Downloads page and the section goes away. The setting key `AUTO_DOWNLOAD_ON_JOIN_KEY` and its `true` default are untouched, so no saved preference moves.

The component moves from `src/multiplayer/pages/` to `src/downloads/pages/`, reading the key from `src/multiplayer/battle/autoDownload.ts`, which keeps the behaviour where the behaviour is.

## Engine Settings splits by category

The worker already groups each setting under a `category`. Those categories become the subpages, so a new catalog entry lands on the right page with no frontend change.

One `EngineConfigPage` component takes a category and renders the shared chrome (engine picker, read-only warning, config path) plus that category's fields. The five sections declare it with different props.

This costs one worker call, not five. `useUnitsyncEngineConfig` reads through a module-level cache keyed `dataDir::enginePath`, and the engine choice is the persisted `content.scanTarget` setting, so it follows you between pages.

Config profiles (save and restore a whole `springsettings.cfg`) apply to all five categories, so they sit on the Engine Settings landing page beside the category cards.

## Engine settings get the right control

The catalog in `crates/coilbox-unitsync-worker/src/config.rs` types every non-bool as a number, so VSync (an enum) and the volumes (ranges) are free text boxes. Ground truth is the engine's own `spring --list-config-vars`, checked against Recoil 2026.07.01. Every default in the catalog already matched. The bounds and the meanings were simply never captured.

Two kinds are added:

- `Kind::Enum` carries `(value, label)` pairs, rendered as a select. A stored value outside the list shows as its own option rather than being silently rewritten, because the engine's range is wider than the useful choices.
- `Kind::Range` carries min and max, rendered as a slider with the number beside it.

`Kind::Int` and `Kind::Float` gain optional bounds so a number field can refuse an out-of-range value instead of the engine clamping it silently.

| Key | Was | Becomes | From the engine |
| --- | --- | --- | --- |
| VSync | number | enum | -6 to 6, negative adaptive, positive standard, 0 disabled |
| Shadows | number | enum | -1 force off, 0 off, 1 full, 2 fast |
| Water | number | enum | 0 basic, 1 reflective, 2 reflective and refractive, 3 dynamic, 4 bumpmapped |
| CamMode | number | enum | 0 FPS, 1 overhead, 2 spring, 3 rotatable overhead, 4 free, 5 overview |
| snd_vol, six keys | number | range | 0 to 200, not 0 to 100 as assumed |
| GroundDetail | number | number, 4 to 200 | min 4, max 200 |
| ShadowMapSize | number | number, min 32 | min 32 |
| MSAALevel | number | number, 0 to 32 | samples, any value in range is legal |
| TeamHighlight | number | number, 0 to 2 | undocumented in the engine, so no invented labels |

Each setting also carries the engine's own `description` where it has one, shown as a hint under the label. `EngineConfigSetting` gains `options`, `min`, `max` and `description`. Its `type` gains `"enum"` and `"range"`.

TeamHighlight keeps a number box on purpose. The engine declares no description for it, and a guessed label is worse than a number.

## Hub: one keychain prompt, not three

Opening the hub prompts for the keychain three times. Two faults stack.

`useHubAccount` runs its own effect per mount, and three components mount it: the hub header, the publish form, and the settings section. Three `hub_account` calls fire in the same tick.

`coilbox-oauth`'s `signed_in` reads the keychain on every call. `get_credential` caches, but only once a read returns, so a burst of three all miss and all reach the keychain. It also never caches a miss, so a signed-out user hits the keychain on every call too.

Both get fixed:

- Frontend: a `HubAccountProvider` holds the state, `useHubAccount` reads context. One fetch serves every consumer.
- Rust: `get_credential` takes a per-account lock across the read, so concurrent callers wait on the first rather than starting their own. This is the fix that holds for callers not yet written.

## Review pass

Every section gets walked in a running `bun tauri dev` through the Tauri MCP and screenshotted. Faults of the kind already found here get fixed in this branch: a control that misrepresents its data, work fired that is not needed, a section too thin to be a page, a dead control, a label naming an implementation rather than a task. Anything larger gets written up rather than absorbed.

The engine has no OpenGL context on this machine, so writes to `springsettings.cfg` can be verified but their in-game effect cannot.

## Testing

- `composeSettings` order and nesting: unit test over the composed tree asserting parents, children and sibling order.
- Catalog: existing worker tests cover the read and write path, with new cases for enum options and range bounds, including a stored value outside an enum's list.
- Keychain single flight: a Rust test firing concurrent `get_credential` calls for one account and asserting one underlying read.
- Hub account provider: a test asserting three consumers produce one `hub_account` call.
