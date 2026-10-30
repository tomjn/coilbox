# Licence of the coilbox Lua beside this folder

SPDX-License-Identifier: MIT OR GPL-2.0-or-later

Coilbox wrote the Lua files named `coilbox_*`, the Lua under `luarules/mission_runtime/` and `luaui/coilbox_blueprints/`, and `missions/runtime.lua`. In a compatibility mode folder it also wrote `compat/prelude-synced.lua`, `compat/prelude-unsynced.lua`, and the `gamedata/` files `defs_post.lua`, `weapondefs.lua` and `weapondefs_post.lua`, plus the `VFS.Include("compat/prelude-...")` call that starts each game entry file it wraps. Coilbox ships them in its app and installs them into a game or a content folder. They are not a game's own files, and this notice does not cover the rest of the game or the content folder.

These files are offered under either of two licences, at your choice:

- the MIT licence, the text of which is in [LICENSE-MIT](LICENSE-MIT) beside this file
- the GNU General Public License, version 2 or any later version, the text of which is in [COPYING](COPYING) beside this file

Each gadget and widget names this in its `GetInfo` table:

```lua
license = "MIT or GNU GPL, v2 or later",
```

The Lua runs inside the Recoil engine and calls its Lua API. Recoil is licensed under the GNU General Public License, version 2 or any later version. Offering the Lua under the GPL as well as the MIT licence keeps it compatible with the engine's licence.

The last paragraph of `LICENSE-MIT` mentions `lua/LICENSE.md`. That is a file in the coilbox source repository, https://github.com/tomjn/coilbox, and this notice is the copy that travels with an install.

Coilbox writes this folder when it installs the mission runtime into a game or the blueprint widget into a content folder, and writes it again on each install. A compatibility mode folder holds it at `compat/coilbox-licence/`, beside the prelude. The coilbox app carries the same three files beside the Lua it ships. Edits to the files in this folder are replaced. This file states how the code is offered. It is not legal advice.
