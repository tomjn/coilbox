# Coilbox conquest town models

Every building in the conquest campaign map's towns, exported from the game's own generator, in every colourway the game uses.

- `open-town/` has 46 buildings from the open towns on temperate, desert and ice planets.
- `open-town-fillers/` has 8 lot fillers from the same towns: parks, courts, car parks.
- `outpost/` has 39 structures from the sealed outposts on red, moon, volcanic and acid planets.
- `recoil/` has every building and colourway as a Recoil `.s3o` model with its two textures, ready to copy into a game or map archive.

## In each model's folder

- `<model>.stl` is the plain geometry, with no colour.
- `colourways/<model>-<colourway>.obj` is the same geometry with UVs. Each has its own `.mtl` pointing at its texture. Select one in Finder and press space to preview it, then use the arrow keys to step through the colourways.
- `textures/<colourway>.png` is the baked texture for that colourway.
- `<model>_ao.png` is the model's ambient occlusion on its own, white where a surface sees open sky and dark where it is enclosed. It is already baked into every texture. Use it if you light the model yourself and want the occlusion as a separate map.

Every colourway of a model shares one geometry and one UV layout, so any texture fits any of that model's OBJs, and the AO map fits them all.

## Colourways

- Open-town buildings are named `<planet>-<livery>`, with planets `temperate`, `desert` and `ice` and 25 liveries. Each building only takes the liveries the game allows for its height, so a tall tower has no brick.
- Open-town fillers are named after the planet alone, as the game gives them no livery.
- Outposts are named `<planet>-<colourway>`, from the colourways the game allows for that structure's family.

## Scale and orientation

- In the STL and OBJ files, Z is up and one game world unit is 100 mm. An open-town lot is 25 mm across, and an outpost lot is 75 mm.
- Each model stands on the ground plane, centred on its own origin.

## What the textures hold

- The textures hold the game's surface colour and its painted patterns: stone courses, brick, glass panes, cast panels, ribs, metal plate and hazard stripes.
- Ambient occlusion is baked in, so corners, recesses and wall bases are darker. Outside corners have a thin lighter edge. Lamps and glass are left as they are.
- Sunlight is not baked in. In the game, glass reflects the sky and metal catches the sun, so glass looks darker here than it does in play.
- Every texture is baked at 256 texels per world unit. Brick courses are finer than that, so brick walls show an even tone.

## The Recoil models

- `recoil/objects3d/<folder>-<model>-<colourway>.s3o` is one model, with `recoil/unittextures/<folder>-<model>-<colourway>.png` and `..._2.png` as its two textures.
- The models are at 512 elmos per world unit, so an open-town lot is 128 elmos across, or 8 footprint squares. This is the scale the Persepolis map uses.
- The first texture's alpha is 0 everywhere, so no part takes team colour.
- The second texture holds glow in red, metalness in green and roughness in blue, as Recoil's model shaders read it. Lamps glow, glass is smooth, and occluded corners are rougher so they do not catch reflections.
- To use one as a map feature, add a feature def with `object = "<name>.s3o"` and a footprint to match its lot.

## Printing

Models are made from overlapping solid parts rather than one closed shell. Most slicers accept this.
