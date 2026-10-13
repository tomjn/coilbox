# Licence of the Lua in this folder

SPDX-License-Identifier: MIT OR GPL-2.0-or-later

The Lua under `lua/` is offered under either of two licences, at your choice:

- the MIT licence, the text of which is in the `LICENSE` file at the root of this repository
- the GNU General Public License, version 2 or any later version, the text of which is in [COPYING](COPYING) beside this file

This covers the gadgets, widgets, modules and adapters that coilbox loads into a game. It also covers the Lua that coilbox generates into a game at run time, and the test stubs and fixtures under `lua/*/tests/`, which carry the same notice for simplicity.

## Why

This Lua runs inside the Recoil engine and calls its Lua API. Recoil is licensed under the GNU General Public License, version 2 or any later version. Offering the Lua under the GPL as well as the MIT licence keeps it compatible with the engine's licence. Offering both lets you use it under whichever suits you.

## Files that take in GPL code

The choice of licences applies to code that coilbox wrote itself. A file that takes in GPL code from somewhere else can only be offered under the GPL, so it must say "GPL only" in its own header. No file under `lua/` does so today.

## The `license` field

Each gadget and widget names its licence in its `GetInfo` table. The text is the same in every file:

```lua
license = "MIT or GNU GPL, v2 or later",
```

A test in `src/luaLicence.test.ts` fails if a Lua file under `lua/` declares anything else.

## What is not covered

The Rust and TypeScript code of the coilbox app, outside `lua/`, is MIT only. See the `LICENSE` file at the root of the repository.

This file states how the code is offered. It is not legal advice.
