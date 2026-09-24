/**
 * Reading a game's own particle bitmaps and packing them into one atlas for
 * the preview's effects layer (issue #1526's sibling in PR B).
 *
 * `ProjectileDrawer` reads `gamedata/resources.lua`, prefixes `bitmaps/`, and
 * falls back to the base content's defaults when a game ships neither the file
 * nor a smoke table (`ProjectileDrawer.cpp:98-150,231,137-145`). `RESOURCES_LUA`
 * plays that same lookup back through unitsync, with the game and its
 * dependencies mounted, and answers the bytes as hex because that is all the
 * unitsync Lua parser can hand back.
 *
 * The image decode and canvas draw are pulled out into `buildAtlas` so a test
 * can replace them: a real decode never resolves in an environment with no
 * image pipeline.
 */

import * as THREE from "three";
import { unitsyncLuaExec } from "@/content/bindings";
import { legoBitmapPng } from "./bindings";
import { BITMAP_LASER, BITMAP_MUZZLE_FLAME, BITMAP_SMOKE } from "./effects";
import type { EffectsAtlas } from "./pages/components/effectsLayer";

/** The Lua that finds and reads the bitmaps, run with the game mounted. */
export const RESOURCES_LUA = `
local function field(t, key)
  if type(t) ~= 'table' then return nil end
  for k, v in pairs(t) do
    if type(k) == 'string' and string.lower(k) == key then return v end
  end
  return nil
end

-- The engine reads gamedata/resources.lua through the game and the base
-- content under it (ProjectileDrawer.cpp:98). With neither, these are the
-- base content's defaults (springcontent/gamedata/resources.lua:97-112).
local textures = { explo = 'explo.tga', laserfalloff = 'laserfalloff.tga' }
local smoke = nil
if VFS.FileExists('gamedata/resources.lua') then
  local ok, res = pcall(VFS.Include, 'gamedata/resources.lua')
  if ok then
    local graphics = field(res, 'graphics')
    textures = field(graphics, 'projectiletextures') or {}
    smoke = field(graphics, 'smoke')
  end
end

local function hex(file)
  local path = 'bitmaps/' .. file
  if not VFS.FileExists(path) then return '' end
  local data = VFS.LoadFile(path)
  if not data then return '' end
  return (string.gsub(data, '.', function(c)
    return string.format('%02x', string.byte(c))
  end))
end

local out = {}
local function add(key, file)
  if type(file) ~= 'string' then file = nil end
  out[#out + 1] = key .. '|' .. (file or '') .. '|' .. (file and hex(file) or '')
end

add('muzzleflame', field(textures, 'muzzleflametexture') or field(textures, 'explo'))
add('laserfalloff', field(textures, 'laserfalloff'))
if type(smoke) == 'table' and #smoke > 0 then
  for i = 1, #smoke do add('smoke' .. i, smoke[i]) end
else
  for i = 0, 11 do add('smoke' .. (i + 1), string.format('smoke/smoke%02d.tga', i)) end
end
return table.concat(out, ';')
`;

export interface BitmapFile {
  /** "muzzleflame", "laserfalloff", or "smoke1", "smoke2" and so on. */
  key: string;
  /** The name under `bitmaps/`, or null when the game names none. */
  file: string | null;
  /** The file's bytes as hex, or null when it is not in the game. */
  hex: string | null;
}

/** Turns one `\X` escape back into the literal character it stands for,
 *  which covers both `%q`'s `\\` and `\"` in one pass. */
function unescapeQuoted(source: string): string {
  let out = "";
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\\" && i + 1 < source.length) {
      i++;
      out += source[i];
      continue;
    }
    out += source[i];
  }
  return out;
}

export function parseBitmaps(result: string | undefined): BitmapFile[] {
  if (!result) return [];
  let trimmed = result.trim();
  if (trimmed.startsWith('"')) trimmed = trimmed.slice(1);
  if (trimmed.endsWith('"')) trimmed = trimmed.slice(0, -1);
  const line = unescapeQuoted(trimmed);
  if (line === "") return [];

  const out: BitmapFile[] = [];
  for (const entry of line.split(";")) {
    const [rawKey, rawFile, rawHex] = entry.split("|");
    const key = rawKey ?? "";
    if (key === "") continue;
    out.push({
      key,
      file: rawFile ? rawFile : null,
      hex: rawHex ? rawHex : null,
    });
  }
  return out;
}

/** The atlas slot a key goes in: `BITMAP_MUZZLE_FLAME`, `BITMAP_LASER`, or
 *  `BITMAP_SMOKE + n - 1` for smoke n. */
export function slotOf(key: string): number {
  if (key === "muzzleflame") return BITMAP_MUZZLE_FLAME;
  if (key === "laserfalloff") return BITMAP_LASER;
  const smoke = /^smoke(\d+)$/.exec(key);
  if (smoke) return BITMAP_SMOKE + Number(smoke[1]) - 1;
  return -1;
}

export interface ShelfRect {
  slot: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Shelf packs the images tallest first, one pixel apart from their
 * neighbours and from the row below, so linear filtering never samples a
 * neighbour's edge.
 */
export function packShelves(
  sizes: { slot: number; width: number; height: number }[],
): { width: number; height: number; rects: ShelfRect[] } {
  const sorted = [...sizes].sort((a, b) => b.height - a.height);

  const widest = sorted.reduce((max, size) => Math.max(max, size.width), 0);
  const paddedArea = sorted.reduce(
    (sum, size) => sum + (size.width + 1) * (size.height + 1),
    0,
  );
  const width = Math.max(widest, Math.ceil(Math.sqrt(paddedArea)));

  const rects: ShelfRect[] = [];
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  for (const size of sorted) {
    if (x > 0 && x + size.width > width) {
      y += rowHeight + 1;
      x = 0;
      rowHeight = 0;
    }
    rects.push({
      slot: size.slot,
      x,
      y,
      width: size.width,
      height: size.height,
    });
    x += size.width + 1;
    rowHeight = Math.max(rowHeight, size.height);
  }

  return { width, height: y + rowHeight, rects };
}

export interface EffectBitmaps {
  atlas: EffectsAtlas | null;
  /** What the panel says about the bitmaps, or null when every one loaded. */
  note: string | null;
}

/** Names a list of missing bitmaps, or null when nothing is missing. */
export function missingNote(missing: string[]): string | null {
  if (missing.length === 0) return null;
  const list =
    missing.length === 1
      ? missing[0]
      : `${missing.slice(0, -1).join(", ")} and ${missing[missing.length - 1]}`;
  return `The game has no ${list}, so those are drawn as a plain round sprite.`;
}

/** How a missing entry is named in a note: by its file under `bitmaps/` when
 *  it has one, otherwise by its key. */
function missingName(entry: { key: string; file: string | null }): string {
  return entry.file ? `bitmaps/${entry.file}` : entry.key;
}

interface AtlasEntry {
  slot: number;
  dataUrl: string;
  width: number;
  height: number;
}

/**
 * Decodes and draws every loaded bitmap into one atlas canvas, at the rects
 * `packShelves` works out, and answers a texture ready for the effects layer.
 *
 * Pulled out on its own so a test can replace it: decoding a data URL and
 * drawing into a canvas both need a real image pipeline, which an
 * environment built for logic tests does not have.
 */
async function buildAtlas(entries: AtlasEntry[]): Promise<{
  texture: THREE.Texture;
  packed: { width: number; height: number; rects: ShelfRect[] };
  failed: number[];
}> {
  const loaded: {
    slot: number;
    width: number;
    height: number;
    image: HTMLImageElement;
  }[] = [];
  const failed: number[] = [];

  for (const entry of entries) {
    try {
      const image = new Image();
      image.src = entry.dataUrl;
      await image.decode();
      loaded.push({
        slot: entry.slot,
        width: entry.width,
        height: entry.height,
        image,
      });
    } catch {
      failed.push(entry.slot);
    }
  }

  const packed = packShelves(
    loaded.map(({ slot, width, height }) => ({ slot, width, height })),
  );

  const canvas = document.createElement("canvas");
  canvas.width = packed.width;
  canvas.height = packed.height;
  const context = canvas.getContext("2d");
  if (context) {
    for (const rect of packed.rects) {
      const image = loaded.find((entry) => entry.slot === rect.slot)?.image;
      if (image) context.drawImage(image, rect.x, rect.y);
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.flipY = false;
  texture.needsUpdate = true;

  return { texture, packed, failed };
}

/**
 * `buildAtlas` behind a mutable reference, so a test can replace it with
 * `vi.spyOn(atlasBuilder, "build")`. A plain named export cannot be
 * intercepted this way: `loadEffectBitmaps` calls it as a direct binding, not
 * through the module's exports object, so a spy on the export would never be
 * seen. Real decoding and drawing need an image pipeline no logic test has.
 */
export const atlasBuilder = { build: buildAtlas };

/**
 * Reads a game's particle bitmaps through unitsync and packs the ones it has
 * into one atlas, noting the rest as drawn plain instead.
 */
export async function loadEffectBitmaps(
  target: { enginePath: string; dataDir: string },
  archive: string,
): Promise<EffectBitmaps> {
  const res = await unitsyncLuaExec({
    ...target,
    archive,
    source: RESOURCES_LUA,
  });
  if (res.error) {
    return {
      atlas: null,
      note: `Could not read the game's bitmaps, so effects are drawn as a plain round sprite: ${res.error}`,
    };
  }

  const bitmaps = parseBitmaps(res.result);
  const smokeCount = Math.max(
    1,
    bitmaps.filter((bitmap) => bitmap.key.startsWith("smoke")).length,
  );

  const missing: string[] = [];
  const entries: AtlasEntry[] = [];
  for (const bitmap of bitmaps) {
    if (!bitmap.file || !bitmap.hex) {
      missing.push(missingName(bitmap));
      continue;
    }
    try {
      const png = await legoBitmapPng({ hex: bitmap.hex, file: bitmap.file });
      entries.push({
        slot: slotOf(bitmap.key),
        dataUrl: png.dataUrl,
        width: png.width,
        height: png.height,
      });
    } catch {
      missing.push(missingName(bitmap));
    }
  }

  const rectCount = BITMAP_SMOKE + smokeCount;
  const rects: (readonly [number, number, number, number] | null)[] = new Array(
    rectCount,
  ).fill(null);

  if (entries.length === 0) {
    return { atlas: null, note: missingNote(missing) };
  }

  const { texture, packed, failed } = await atlasBuilder.build(entries);
  for (const rect of packed.rects) {
    if (failed.includes(rect.slot)) continue;
    rects[rect.slot] = [
      rect.x / packed.width,
      rect.y / packed.height,
      (rect.x + rect.width) / packed.width,
      (rect.y + rect.height) / packed.height,
    ];
  }
  for (const slot of failed) {
    const bitmap = bitmaps.find((entry) => slotOf(entry.key) === slot);
    if (bitmap) missing.push(missingName(bitmap));
  }

  return {
    atlas: { texture, rects, smokeCount },
    note: missingNote(missing),
  };
}
