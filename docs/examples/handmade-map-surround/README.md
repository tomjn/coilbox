# Sample hand-made map with a surround

This is the [Two Shores sample](../handmade-map/README.md) with land past its frame. On the strategic map the country carries on past the edge of the map and fades out. Nothing past the frame can be played or picked.

The manifest differs from the first sample in its `id`, `title` and `description`, and in `files.surround`, which names the two wider images.

`surround-picture.png` and `surround-heightmap.png` are 382 by 318 pixels. `picture.png` and `heightmap.png` are 160 by 96, so the surround adds 111 pixels to all four sides. The sample has 10 locations, and 111 pixels is the margin a generated map with 10 locations gets on a map 160 pixels wide.

The land round the two land masses crosses the frame, so `picture.png` and `heightmap.png` differ from the first sample's. None of that land is painted on `provinces.png`, which is the first sample's file unchanged.

`scripts/build-sample-handmade-map.mjs` draws these images too. [The author guide](../../developers/hand-made-maps.md#the-surround) says how big a surround should be and why.
