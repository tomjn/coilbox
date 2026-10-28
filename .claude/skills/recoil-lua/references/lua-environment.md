# The Lua environments

## The language

Recoil embeds Lua 5.1.4 with engine patches (`rts/lib/lua/`). No Lua 5.2+ syntax works: no `goto`, no integer division `//`, no bitwise operators, no integer subtype.

`lua_Number` is `float` (`rts/lib/lua/include/luaconf.h:514`). Every number is a 32-bit float, so integers are exact only up to 2^24 (16777216). Watch for:

- frame counts multiplied into milliseconds
- ids or hashes packed into one number
- sums of many small values, which drift

Store large values as strings, or split them into two numbers.

For bit operations the engine adds `math.bit_or`, `math.bit_and`, `math.bit_xor`, `math.bit_inv` and `math.bit_bits` (`rts/Lua/LuaMathExtra.cpp:45-49`). They are exact only for values up to 24 bits, for the same float reason. There is no LuaJIT `bit` library and no shift function. Shift by multiplying or dividing by a power of 2.

## What each state can reach

| State | Runs | Standard libraries | Reads the simulation |
|---|---|---|---|
| LuaRules, LuaGaia synced (`main.lua`) | on every machine, in lockstep | `base`, `math`, `table`, `string` | everything |
| LuaRules, LuaGaia unsynced (`draw.lua`) | on each machine separately | adds `io`, `os`, `debug` | everything |
| LuaUI, LuaIntro | on each machine separately | adds `io`, `os`, `debug` | only what the player can see |
| LuaMenu | outside a match | adds `io`, `os`, `debug` | no match |

Source: `rts/Lua/LuaLibs.cpp`. Unsynced states lose `io.popen`, `os.exit`, `os.execute`, `os.tmpname` and `os.getenv`, and file access goes through the engine's sandbox. No state opens `package`, so there is no `require`. Use `VFS.Include(path, env)` to run another file and get its return value.

An unsynced gadget is the place for code that must see everything and write files without touching the simulation, such as a recorder or an exporter.

`Script.GetCallInList()` returns the call-ins available in the state it is called from. They differ between states.

## Keeping synced code in sync

Every machine runs synced code and must reach the same result. A difference is a desync, which ends a multiplayer game. The engine guards some of this:

- `math.random` in synced code is replaced by the game's synced generator. `math.randomseed` reseeds that generator for the whole game, so do not call it (`rts/Lua/LuaHandleSynced.cpp:469-472`, `:1953`).
- `pairs` and `next` in synced code log a warning when a table key is not a string, number or boolean. Tables and functions as keys iterate in memory address order, which differs per machine (`LuaHandleSynced.cpp:1961-2006`).

Not guarded, so on you:

- No wall-clock time, file reads or player-local config in synced code. Synced code has no `os` or `io` anyway, but values passed in from unsynced code count too.
- Unsynced code cannot write to the simulation directly. It sends a message: `Spring.SendLuaRulesMsg` from LuaUI to LuaRules synced, which arrives as the `RecvLuaMsg` call-in. Synced code passes data down with `SendToUnsynced` and with rules params such as `Spring.SetGameRulesParam`.

The engine's guide to passing data between widgets, gadgets and states is at https://recoilengine.org/docs/guides/wupget/.

## Drawing

Recoil is moving Lua drawing to OpenGL vertex buffers and shaders. These `gl.*` functions are deprecated and log a warning when the config var `DeprecatedGLWarnLevel` is 1 or more:

`AlphaTest`, `BeginEnd`, `Billboard`, `CallList`, `ClipPlane`, `Color`, `CreateList`, `DeleteList`, `DrawListAtUnit`, `Fog`, `Frustum`, `Light`, `Lighting`, `LineStipple`, `LineWidth`, `LoadIdentity`, `LoadMatrix`, `Material`, `MatrixMode`, `MultMatrix`, `Normal`, `Ortho`, `PointSize`, `PopMatrix`, `PushMatrix`, `PushPopMatrix`, `Rotate`, `Scale`, `Shape`, `TexCoord`, `TexEnv`, `TexGen`, `Translate`, `Vertex`, and the unit and feature `MultMatrix` variants.

New code builds geometry with `gl.GetVBO` and `gl.GetVAO` and draws it with a shader from `gl.CreateShader`. The guide is at https://recoilengine.org/docs/guides/rendering/lua-vbo-vao/. To check existing code, set `DeprecatedGLWarnLevel` to 2, which also logs the calling Lua file.

In `spring-headless` every rendering call does nothing, and `gl.GetVBO` returns nothing. Drawing code must handle a missing buffer rather than error, or a headless test will fail on a path it cannot exercise. A green headless run says nothing about whether the drawing works.

Geometry shaders are not available everywhere, and not only on one platform. Any shader that uses a geometry stage needs a fallback without one, for example expanding points into quads in the vertex shader with instancing. Do not drop the fallback because a target platform seems out of scope. Some drivers also report geometry shader support they do not have, as the macOS driver on Metal does, so a capability check or a successful compile does not prove the stage works. Prefer the fallback as the default path where it costs little.

RmlUi, an HTML and CSS style UI library, is built in as an alternative to drawing UI by hand. See https://recoilengine.org/docs/guides/getting-started/getting-started-with-rmlui/.

### Debugging a drawing bug

- Read the whole widget first. Find what marks it dirty and what rebuilds its display lists or buffers. An artefact that only appears on a rebuild will not show in a frozen scene. In one build menu widget, `widget:MouseWheel` set the flag that recompiled the panel, so comparing two still frames measured two identical clean images.
- Recolour before you measure. Give every drawn element its own saturated colour and set every alpha to 1. "The backdrop drew white, the colour the icon pass set before it" names both the broken draw and the state it inherited. A translucent dark UI hides this. Revert the widget afterwards.
