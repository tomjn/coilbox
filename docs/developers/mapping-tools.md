# Compile and decompile maps

Coilbox can build a map for the engine from a set of images, and take an existing map apart back into those images. It does this with SpringMapConvNG, a map compiler that comes with coilbox, so there is nothing else to install.

The tools are under Mapping Tools in the sidebar:

- Projects lists the maps you have compiled or decompiled.
- Compile builds a map from your images.
- Decompile takes a map apart.

This page covers what is on each screen. The detail of the map format, such as how to paint a heightmap or what goes in `mapinfo.lua`, belongs to the engine's own guides. See [Map making guides](#map-making-guides) at the end.

## Turn on Mapping Tools

Mapping Tools is hidden until you turn on Advanced mode.

1. Open Settings, then General.
2. Under Advanced tools, turn on Advanced mode.

Mapping Tools now appears in the sidebar, with Projects, Compile and Decompile under it.

## What a map is made of

A compiled map is two files with the same name. The `.smf` file holds the shape of the ground and the other maps. The `.smt` file holds the ground texture, cut into tiles.

You make a map from these images:

- The main texture is the colour picture painted across the whole map. Its size sets the size of the map, and each side must be a multiple of 1024 pixels, such as 1024, 2048 or 8192.
- The heightmap is a greyscale image of the ground. White is the highest point and black the lowest. Each side should be the texture's size divided by 8, plus 1. An 8192 pixel texture needs a 1025 pixel heightmap.
- The metal map marks where the metal is. Brighter red means more metal.
- The type map gives each part of the map a terrain type.
- The minimap is the small picture of the map that players see in the lobby and in the game.
- The vegetation map is a greyscale image of where grass grows. Brighter means denser grass.
- The features file is a text file that places trees, rocks and other features, one per line.

Only the main texture is required. Images can be PNG, BMP, TGA, JPEG or TIFF.

## Compile a map

1. Open Mapping Tools > Compile.
2. Next to Main texture (-t), select Browse and pick your texture.
3. Next to Output folder, select Browse and pick the folder to write the map to.
4. Type a name in Output name (-o). This is the file name of the `.smf` and `.smt`, without the extension.
5. Select Compile.

The compiler's messages appear on the right while it runs. Cancel stops it.

When it finishes, the right side says Compiled and shows the path of the `.smf`. Show in folder opens the output folder on your computer. If the compile fails, a red message says why.

Coilbox writes only the `.smf` and `.smt`. To play the map, put them in a map archive with a `mapinfo.lua`, as the engine's map guide describes.

Coilbox keeps what you filled in when you leave the page or close coilbox.

### Let coilbox find your other images

Give your images these names and put them in the same folder as the main texture:

- `heightmap` or `height`
- `metalmap` or `metal`
- `typemap` or `type`
- `minimap`
- `vegmap` or `vegetationmap`
- `features.txt` for the features file

When you pick the main texture, coilbox fills in any of these it finds, and opens Advanced options to show them. It does not replace a field you have already filled in.

If there is a `mapinfo.lua` in that folder or the one above it, coilbox also reads the map's lowest and highest points from it into Min height and Max height.

### Check the texture size

Under Main texture, coilbox shows the size of the picture you picked. If a side is not a multiple of 1024, a warning says so. The compiler will probably refuse the texture.

### Compression type

Compression type (-ct) decides how the `.smt` tiles are packed. It trades file size against how long the compile takes. Each choice starts with its number:

- 1, No compression, is the fastest and makes the largest file.
- 2, Fast, shares tiles that match one of the last few tiles.
- 3, Insane, compares every tile on the map. It makes the smallest file and takes the longest.
- 4, High quality fast, is a good choice for most maps.

To change which type the page starts with, see [Settings](#settings).

### Advanced options

Select Advanced options to see the rest. The number beside it is how many of these you have filled in.

Under Source maps, each image from [What a map is made of](#what-a-map-is-made-of) has its own field and Browse button:

- Heightmap (-h)
- Metal map (-m)
- Type map (-z)
- Minimap (-minimap)
- Vegetation map (-v)
- Features file (-features)

Under Height range:

- Min height (-minh) is the height of black in the heightmap, the lowest point of the map. It is 0 if you leave it empty. Below 0 is under water.
- Max height (-maxh) is the height of white, the highest point. It is 1 if you leave it empty. The gap between the two sets how steep the ground is.
- Disable height clamping (-noclamp) is not recommended, because the heights lose precision. Set Min height and Max height instead.

If Min height is not below Max height, a warning says the ground will be flat or upside down.

Under Compression tuning:

- Threshold (-th) is how closely two tiles must match to be shared. It is 0.8 if you leave it empty.
- Compare count (-ccount) is how many tiles types 2 and 4 compare against. It is 64 if you leave it empty.
- Smooth texture (-smooth) blurs the main texture before compiling.

The letters in brackets are the compiler's own option names, so you can match them to its documentation.

### Get help on the page

The question mark beside a field explains it. Learn more opens the matching page of the Spring mapping wiki in your browser. Beginner guide and Mapping wiki at the top of the page do the same.

## Decompile a map

Decompiling takes a map apart into its images, so you can change a map or see how one was made.

1. Open Mapping Tools > Decompile.
2. Choose the map. Select Browse to pick a `.smf`, `.sdz` or `.sd7` file, or drag the file onto the window. For a map that is a `.sdd` folder, select Pick a .sdd folder….
3. Select Decompile.

The images go into the folder that holds the map's `.smf`:

- A `.smf` file is decompiled where it is.
- A `.sdz` or `.sd7` archive is first unpacked into a folder beside it, with the same name ending in `.sdd`. The images go inside that folder.
- A `.sdd` folder is decompiled in place.

When it finishes, the page shows where the images went, the map's name, version, description and author, its minimap, and its size and height range. Below that is a [3D preview](#the-3d-preview).

- Show in folder opens the folder with the images.
- Recompile opens Compile with the decompiled texture, the other images found beside it and the same folder filled in. Output name is taken from the folder's name, so check it before you select Compile.

You can also start from a map you already have. Open Library > Maps, select the map, then select Open in mapconv decompile. Decompile opens with that map chosen. The button is only there with Advanced mode on.

## Projects

Every map you compile or decompile is added to Mapping Tools > Projects, so you can come back to it.

Each project shows a picture of the map, its name, whether it was compile or decompiled, and its folder.

- Compile opens Compile ready to build the map again. A compiled map comes back with every option you used last time. A decompiled map comes back as it would from Recompile.
- Folder opens the project's folder on your computer.
- The bin removes the project from the list. The files stay on your computer.

To add a map folder you already have, select Import .sdd folder… at the top and pick the folder.

## The 3D preview

The 3D preview shows the map as ground, from the texture and the heightmap. On Compile it appears once you have chosen both a main texture and a heightmap. On Decompile it appears when a map has been taken apart. It is the same view as on a map's page in the Library.

- Drag to turn the map. Scroll to zoom.
- Water shows or hides the water. It starts off for a map with no ground below sea level.
- Wireframe shows the ground as a wire mesh.
- The button at the top left opens the preview full screen. Select it again, or press Esc, to go back.

The label at the bottom left gives the height range the preview uses.

If the map has a `mapinfo.lua`, the preview uses its water colour, sky and sun. If the map names a skybox that the preview cannot show, it draws a plain sky and says flat sky at the bottom right.

## Settings

Open Settings, then Advanced > mapconv.

Under Defaults:

- Default compression type is the Compression type the Compile page starts with.
- Remember last-used folders starts each Browse in the folder you used last time.

SpringMapConvNG sidecars shows whether coilbox can find its two compiler programs. mapcompile compiles and mapdecompile decompiles. Each says available or not found. If one is not found, its page shows a warning and the tool cannot run.

## Map making guides

The engine and the compiler have their own guides. They cover the map format in more detail than this page.

- [Mapping wiki](https://springrts.com/wiki/Mapdev:Main) is the engine's map making guide. It covers every image, `mapinfo.lua` and how to package a map.
- [Beginner guide](https://springrts.com/wiki/Mapdev:Tutorial_Simple) walks through making a first map.
- [mapinfo.lua](https://springrts.com/wiki/Mapdev:mapinfo.lua) lists what a map's `mapinfo.lua` can set.
- [MapConvNG](https://springrts.com/wiki/MapConvNG) is the compiler's guide on the wiki.
- [SpringMapConvNG](https://github.com/tomjn/SpringMapConvNG) is the compiler's source and releases.
