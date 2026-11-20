# Coilbox x-ray widget

A Recoil engine widget, named X-Ray Unit Silhouettes in game, that draws units hidden behind buildings and other tall features as team coloured silhouettes. It began as the x-ray in the Persepolis map, made to work on any map.

`luaui/` is what gets installed into a content root as `LuaUI/`. This file is not installed.

## What the player gets

- every unit they can see, drawn flat in its team's colour where a tall feature stands between it and the camera
- allied units and units in line of sight only, never radar contacts, unless they spectate with full view
- parts of a unit below the ground stay hidden, so a buried armour plate or foundation shows no silhouette

A feature is tall when its model is at least 100 elmos high. On Persepolis the tallest street furniture, a tree, is 48 elmos and the lowest building is 201.6, so lamps, bollards, rocks and trees never trigger a silhouette and every building does. A feature that Lua has stopped the engine drawing hides nothing, so a map that fades out a building to show the street keeps the x-ray right.

## Alongside the Persepolis map

Persepolis carried its own copy of this x-ray, called Persepolis x-ray. While this widget runs it sets `WG.xrayUnitSilhouettes`, and Persepolis v1.7 and later switch their copy off when they see it. On older Persepolis builds the widget sends `luaui disablewidget Persepolis x-ray` instead, which the engine's own widget handler and Zero-K's carry out. That switches the map's copy off for later games too, until the player turns it back on in the widget list. BAR does not let a player's widget send that command, so on Persepolis v1.6 and earlier in BAR both copies draw.

## Engine support

It needs an engine with quaternion transforms in GL4 (`Engine.FeatureSupport.transformsInGL4`) and `Spring.GetFeatureNoDraw`. Without them it logs why and removes itself.
