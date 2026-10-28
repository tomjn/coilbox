---
name: recoil-lua
description: Use when writing, testing or debugging Lua for a Recoil (Spring) RTS engine game, such as widgets, gadgets, LuaUI, LuaRules, unit scripts or start scripts, or when deciding how to run the engine to check a Lua change. Covers the pitfalls models hit most often, like restarting the engine to test a widget when a reload would do.
---

# Recoil engine Lua

Recoil is the engine behind Beyond All Reason, Zero-K and other games, forked from Spring. Most of what a model remembers about "Spring Lua" still applies, but a few facts it gets wrong will cost hours. Read the rules below before writing any code. Open a reference file when the task touches its topic.

Every claim here was read from the engine source at RecoilEngine commit `4282724f71` (October 2026). If something looks wrong for the engine in front of you, check the source rather than trusting this file.

## Rules

1. Do not restart the engine to test a Lua change. A running game reloads LuaUI with `/luaui reload`. The other handlers have their own reload commands, and some need cheats. See [iteration.md](references/iteration.md).
2. Settle engine behaviour from the source, not from memory. The engine is open source at https://github.com/beyond-all-reason/RecoilEngine, and the Lua bindings are in `rts/Lua/`. The binary can also list its own commands, config vars and def tags. The old Spring wiki at springrts.com is behind a bot check that agents cannot pass, so do not plan on reading it. See [ground-truth.md](references/ground-truth.md).
3. Lua numbers are 32-bit floats. Recoil runs Lua 5.1.4 with `lua_Number` defined as `float` (`rts/lib/lua/include/luaconf.h:514`). Integers above 2^24 (16777216) lose precision, so do not use large ids, timestamps or packed bit fields as numbers. Tests run under LuaJIT or stock Lua use doubles and will not catch this.
4. There is no `require`. No Lua state opens the `package` library. Load files with `VFS.Include` or `VFS.LoadFile`.
5. Synced code must be deterministic. It gets only `base`, `math`, `table` and `string`. See [lua-environment.md](references/lua-environment.md) for what is missing, what is replaced and what will desync a multiplayer game.
6. Widgets see only what their player can see. LuaUI reads are limited to the player's line of sight and radar. Unsynced gadget code in LuaRules and LuaGaia has full read access.
7. Do not draw with immediate-mode GL. `gl.BeginEnd`, `gl.Vertex`, `gl.Color`, `gl.PushMatrix`, `gl.CreateList` and similar calls still exist but are deprecated. New drawing code uses vertex buffers and shaders. See [lua-environment.md](references/lua-environment.md#drawing).
8. A headless run proves logic, not drawing. `spring-headless` runs widgets, but every rendering call does nothing.
9. Widget and gadget handlers belong to the game, not the engine. The engine ships a base handler, and many games replace it with their own. Check the game's `luaui/` and `luarules/` folders before assuming a handler method or chat command exists.
10. Always bound an engine run. Wrap it in `timeout`, have the test end the match itself, and run one engine at a time. See [iteration.md](references/iteration.md#running-the-engine-from-a-script).

## Things the engine cannot do

- Seek within a replay. `CGame::StartSkip` has its body compiled out with `#if 0 // FIXME: desyncs` (`rts/Game/Game.cpp:2030`). Rewinding means recording state and replaying the recording in a fresh game.
- Run `/luarules reload` without cheats. It also refuses before the first game frame.
- Shell out from Lua. `io.popen`, `os.execute` and `os.exit` are removed even in unsynced code.

## References

- [iteration.md](references/iteration.md) covers reload commands, toggling single widgets and gadgets, and running the engine from a script.
- [lua-environment.md](references/lua-environment.md) covers what each Lua state can do, synced determinism and drawing.
- [ground-truth.md](references/ground-truth.md) covers where to look things up, the engine's self-describing flags, and testing Lua outside the engine.
