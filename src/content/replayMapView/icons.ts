/**
 * The game's own map icons for the unit map (#5316).
 *
 * A game ships one picture for each icon type, mostly white or grey so the
 * engine can tint it in the owning player's colour. Tinting a picture on the
 * canvas for every unit on every frame is slow, so each picture is tinted once
 * for each colour onto an off-screen canvas and the painter draws from that.
 */

/** What the painter needs to draw and find units by their icons. */
export interface UnitIcons {
  /**
   * The edge of the icon for a unit definition, in canvas pixels, or 0 when the
   * unit has no icon and is drawn as its footprint.
   */
  edge(def: number, pixelRatio: number): number;
  /**
   * The icon of a unit definition tinted in `fill`, ready to draw. A lit icon
   * has a white edge, as a lit team's footprints do. Null when the unit has no
   * icon. The picture is centred on the unit and is as wide as it is tall.
   */
  sprite(
    def: number,
    fill: string,
    lit: boolean,
    pixelRatio: number,
  ): CanvasImageSource | null;
  /**
   * The untinted icon of a unit definition, for a view that tints it itself,
   * with the name of its icon type and its edge in CSS pixels. Null when the
   * unit has no icon.
   */
  type(
    def: number,
  ): { name: string; picture: IconPicture; edge: number } | null;
}

/** How wide an icon of type size 1 is on the screen, in CSS pixels. The game
 *  says an icon type's size as a multiplier on the engine's base icon size. */
export const ICON_EDGE = 10;
/** The least an icon is drawn at, in CSS pixels, so a unit whose icon type is
 *  tiny stays visible on a large map. */
export const LEAST_ICON_EDGE = 8;
/** How far a lit icon's white edge reaches, in CSS pixels. */
const HALO = 1.5;

/** An icon's edge in CSS pixels for an icon type of this `size`. */
export function iconEdge(size: number): number {
  return Math.max(LEAST_ICON_EDGE, ICON_EDGE * (size > 0 ? size : 1));
}

/** A picture the tinter can draw from. */
export type IconPicture = CanvasImageSource;

/** Makes the picture of one icon in one colour, `edge` pixels across. */
export type Tint = (
  picture: IconPicture,
  edge: number,
  fill: string,
  halo: number,
) => CanvasImageSource | null;

/** One icon type the game defines, with its picture once that has loaded. */
export interface IconType {
  size: number;
  picture: IconPicture;
}

function canvasOf(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

/**
 * The picture multiplied by `fill`, which is how the engine tints an icon,
 * `edge` pixels across. A positive `halo` leaves that many pixels round it and
 * fills them with a white copy of the picture's outline.
 */
export const tintOnCanvas: Tint = (picture, edge, fill, halo) => {
  const pad = Math.ceil(halo);
  const size = edge + pad * 2;
  const out = canvasOf(size, size);
  const g = out.getContext("2d");
  if (!g) return null;
  if (pad > 0) {
    // A white copy of the picture, put down a little to every side.
    const white = canvasOf(edge, edge);
    const w = white.getContext("2d");
    if (!w) return null;
    w.drawImage(picture, 0, 0, edge, edge);
    w.globalCompositeOperation = "source-in";
    w.fillStyle = "rgb(255, 255, 255)";
    w.fillRect(0, 0, edge, edge);
    for (const [dx, dy] of [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      g.drawImage(white, pad + dx * pad, pad + dy * pad);
    }
  }
  const tinted = canvasOf(edge, edge);
  const t = tinted.getContext("2d");
  if (!t) return null;
  t.fillStyle = fill;
  t.fillRect(0, 0, edge, edge);
  t.globalCompositeOperation = "multiply";
  t.drawImage(picture, 0, 0, edge, edge);
  // Multiplying leaves the fill's own corners behind, so the picture's shape is
  // cut back out of it.
  t.globalCompositeOperation = "destination-in";
  t.drawImage(picture, 0, 0, edge, edge);
  g.drawImage(tinted, pad, pad);
  return out;
};

/**
 * Icons for a recording's units. `unitIcon` is the icon type of each unit
 * definition, in the order of the recording's `unitDefs`, and null for a unit
 * whose type has no picture. `types` holds the pictures that loaded.
 */
export function createUnitIcons(
  unitIcon: readonly (string | null)[],
  types: ReadonlyMap<string, IconType>,
  tint: Tint = tintOnCanvas,
): UnitIcons {
  const cache = new Map<string, CanvasImageSource | null>();
  const typeOf = (def: number) => {
    const name = unitIcon[def];
    return name ? types.get(name) : undefined;
  };
  return {
    edge(def, pixelRatio) {
      const type = typeOf(def);
      return type ? Math.round(iconEdge(type.size) * pixelRatio) : 0;
    },
    sprite(def, fill, lit, pixelRatio) {
      const type = typeOf(def);
      if (!type) return null;
      const edge = Math.round(iconEdge(type.size) * pixelRatio);
      const key = `${unitIcon[def]}|${fill}|${lit ? 1 : 0}|${edge}`;
      let sprite = cache.get(key);
      if (sprite === undefined) {
        sprite = tint(
          type.picture,
          edge,
          fill,
          lit ? Math.max(1, Math.round(HALO * pixelRatio)) : 0,
        );
        cache.set(key, sprite);
      }
      return sprite;
    },
    type(def) {
      const type = typeOf(def);
      const name = unitIcon[def];
      return type && name
        ? { name, picture: type.picture, edge: iconEdge(type.size) }
        : null;
    },
  };
}
