# Convert and compile unit scripts

Coilbox has two tools for a unit's animation script. BOS → Lua turns a `.bos` script into a Lua unit script. COB tools compiles a `.bos` into a `.cob`, and opens a `.cob` to read it as source, as bytes and as instructions.

Both are under Animation in the sidebar. This page covers what is on each screen and what to check after a conversion. The script formats themselves belong to the engine's own guides. See [Unit script guides](#unit-script-guides) at the end.

## Turn on the animation tools

The Animation group is hidden until you turn on Advanced mode.

1. Open Settings, then General.
2. Under Advanced tools, turn on Advanced mode.

Animation now appears in the sidebar, with BOS → Lua and COB tools under it.

## Convert a BOS script to Lua

1. Open Animation > BOS → Lua.
2. Select Load .bos… and pick the script. You can also drag a `.bos` file onto the window, or paste a script into the BOS box.
3. Read the Lua on the right. It updates as you type in the BOS box.
4. Select Copy Lua and paste the result into a `.lua` file in your game's `scripts` folder.

Coilbox does not write any files on this page. Copy Lua is the only way out.

Lua unit scripts need the engine's unit script gadget turned on in your game. The engine's [Lua unit scripting guide](https://springrts.com/wiki/Animation-LuaScripting) says how.

### Load the script from its game folder

Load a script from its file rather than pasting it. Coilbox then finds two things the BOS alone does not have.

The first is the files it includes. Coilbox treats the folder above the nearest `scripts` folder as the root of the game. It looks for each `#include` beside the file that includes it, then at that root, then in the root's `scripts` folder. Names match whatever their case.

A pasted script cannot load its includes. If it has any, coilbox says so in red and does not convert it.

The second is the `.cob` with the same name beside the `.bos`. Coilbox reads it to tell which compiler built the script. Scriptor, which built Total Annihilation and some older Spring games, made a linear constant such as `[1]` two and a half elmos, and today's compilers make it one. Scriptor also gave `&&` and `||` the same priority, read left to right. Without a `.cob`, coilbox converts as today's compilers would.

### What the Lua does for you

The Lua runs as it is, with nothing else to add. It keeps the script's comments and pulls in what it includes.

It also does the arithmetic the COB interpreter does: whole numbers, angles in 65536ths of a turn, division that drops the remainder, and zero as false. Values are changed to radians and elmos only where they reach the engine. A call-in the engine hands radians gets them back in the BOS's own units.

### Leave out unused code

Leave out unused code is on each time you open the page. It drops what nothing uses:

- functions from an included file that are never called
- constants, variables and pieces that nothing names

A function in the script's own file always stays, because a gadget may call it by name. If a gadget calls a function from an included file, untick the box.

### Checks

When coilbox finds something, a button appears at the top of the page with a count, such as 3 checks. It says Parse error if the script does not parse. Select it to open the Checks panel.

- Problems in the BOS lists what the lint pass found, such as an unused variable, a missing piece or code that can never run.
- Conversion warnings lists places where the Lua may do something different from the BOS.

Select a problem to go to its line in the BOS. A line with an error or warning is also marked in the BOS box.

### Shared unit values

BOS scripts could share numbers between units through unit values 1024 to 8191. The engine stopped keeping these in Spring 102.0, so a COB script now reads 0.

A converted script keeps them as rules params instead. When it does, a Needs cob_vars.lua button appears. It opens a panel with the file and a Copy file button.

1. Save the file as `lualibs/cob_vars.lua` in your game.
2. Put `VFS.Include("lualibs/cob_vars.lua")` on the first line of `LuaRules/main.lua`, `LuaRules/draw.lua` and `luaui.lua` (or `LuaUI/main.lua`).

That lets gadgets and widgets reach the shared values through `Spring.SetUnitCOBValue`, `Spring.GetCOBTeamVar` and the functions like them.

Every script that shares these values has to be converted. A COB script that is left still reads 0.

### Check by hand after converting

Read every item under Checks first. Then check these, which coilbox cannot settle from the script alone.

- Piece names. BOS matches a piece name whatever its case, and Lua does not. The Lua asks for each piece as the BOS spells it, so make sure that matches the model.
- Weapons. The Lua unit script gadget only passes weapon call-ins on when `AimWeapon1` exists. A script with `QueryWeapon` call-ins and no `AimWeapon1` will not aim.
- `call-script lua_` calls. A Lua unit script cannot reach LuaRules directly, so the Lua calls `GG.` followed by the function's name, if a gadget has put a function there. Anything returned through `LUA0` to `LUA9` is lost.
- Sounds. `play-sound` becomes `Spring.PlaySoundFile` with `sounds/<name>.wav` at the unit. Check that is the file the unit played.
- Arguments to `start-script`. The engine hands them over in reverse order, and the Lua does the same so it plays as the `.cob` did. A script written for Total Annihilation may have had its arguments swapped all along.
- Call-ins that return an answer, such as `QueryWeapon`. If one waits, the engine stops it with an error the first time.
- Removed unit values. `CURRENT_FUEL` and `ALPHA_THRESHOLD` do nothing in today's engine. The Lua keeps them as the BOS wrote them.
- `Mission-Command`. It comes from Total Annihilation: Kingdoms and the engine does not run it. The Lua raises an error at that point.

Then test the unit in the game, against the `.cob` if you still have it.

## COB tools

Open Animation > COB tools. The page starts empty until you pick or drop a file.

### Compile a BOS script

1. Select Compile .bos… and pick the script, or drag a `.bos` file onto the window.
2. Coilbox writes a `.cob` with the same name beside the `.bos`. If one is already there, it asks before replacing it.

A green message gives the path of the `.cob` and its size in bytes. If the compile fails, a red message says why. Any compiler warnings are listed under it.

`#include` paths are read from the folder the `.bos` is in.

The compiler gives the same bytes as Beyond All Reason's [BARScriptCompiler](https://github.com/beyond-all-reason/BARScriptCompiler), with one exception. A `scale` statement has no axis in the `.cob`, because the engine scales the whole piece and an axis there stops the script. Coilbox warns that the axis went unused. It has no option for the glTF axis swap that BARScriptCompiler offers.

After a compile, a checks button may appear at the top with what the lint pass found, as on BOS → Lua.

### Open a COB file

Select Open .cob… and pick the file, or drag a `.cob` onto the window.

Three tabs show the same script:

- BOS is source rebuilt from the file. For a script you just compiled, it is the `.bos` as it is on disk.
- COB is the bytes of the file, 16 to a line.
- Opcodes is the instructions in the file.

A `.cob` keeps the names of pieces and functions but not of variables, so rebuilt source gives them general names. If a part of the script cannot be written as BOS, it is left as a comment with a line that will not compile, so it cannot be compiled into something different.

Coilbox compiles the rebuilt source again to check it. If that does not give the same bytes, a note says so. That happens when another compiler built the original. Compare how the two play before you replace one with the other.

To keep the rebuilt source, select Save as .bos… and choose where to save it.

### The other buttons

- Re-run does the last action again on the same file. For a `.bos` it compiles again and replaces the `.cob` without asking.
- Reveal in folder opens the folder holding the file on your computer.

Coilbox keeps the file you opened while you visit other pages. It forgets it when you close coilbox.

## Unit script guides

The engine's wiki covers both script formats in more detail than this page.

- [COB overview](https://springrts.com/wiki/Animation-CobOverview) introduces BOS and COB scripts.
- [COB call-ins](https://springrts.com/wiki/Animation-CobCallins) lists the functions the engine calls in a COB script.
- [COB constants](https://springrts.com/wiki/Animation-CobConstants) lists the unit values a script can get and set.
- [Lua unit scripting](https://springrts.com/wiki/Animation-LuaScripting) explains how to turn on Lua unit scripts in a game.
- [Lua call-ins](https://springrts.com/wiki/Animation-LuaCallins) and [Lua call-outs](https://springrts.com/wiki/Animation-LuaCallouts) list what a Lua unit script receives and can call.
- [Differences between COB and Lua](https://springrts.com/wiki/Animation-CobLuaDifferences) lists what changes when you move a script from one to the other.
