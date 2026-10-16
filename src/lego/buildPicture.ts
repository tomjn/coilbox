/**
 * The build picture: what the engine draws for a unit on a build menu
 * (issue #3347).
 *
 * The engine looks for `unitpics/<unit>.png` when a definition sets no
 * `buildpic` (`CUnitDrawerData::SetUnitDefImage`), so the builder writes that
 * name and adds no key. Taking the picture is `captureThumbnail` with a size, a
 * background and a camera direction. This file holds the parts that need no
 * renderer.
 */

import type { PictureSurvey } from "./bindings";
import { comparablePath } from "./exportRecord";
import type { LegoExport, LegoProject, PictureViewId } from "./model";
import type { Vec3 } from "./snapping";
import { THUMBNAIL_PIXELS, THUMBNAIL_VIEW } from "./thumbnail";

const [viewX, viewY, viewZ] = THUMBNAIL_VIEW;

/**
 * The directions a picture can be taken from. They keep the height and depth of
 * the overview's three-quarter view and move it round the unit.
 */
export const PICTURE_VIEWS: {
  id: PictureViewId;
  label: string;
  direction: Vec3;
}[] = [
  { id: "right", label: "Three-quarter, right", direction: THUMBNAIL_VIEW },
  {
    id: "left",
    label: "Three-quarter, left",
    direction: [-viewX, viewY, viewZ],
  },
  { id: "front", label: "Front", direction: [0, viewY, viewZ] },
  { id: "side", label: "Side", direction: [viewZ, viewY, 0] },
];

/** The direction the camera takes for a stored view. */
export function viewDirection(id: PictureViewId): Vec3 {
  return (PICTURE_VIEWS.find((view) => view.id === id) ?? PICTURE_VIEWS[0])
    .direction;
}

/** The size a picture starts at, which is the overview thumbnail's. */
export const DEFAULT_PICTURE_SIZE = THUMBNAIL_PIXELS;

/** A whole number of at least one pixel. */
export function clampPictureSize(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_PICTURE_SIZE;
  return Math.max(1, Math.round(raw));
}

/** A short hash of text. It only has to differ when the text does. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16);
}

/**
 * What the unit looks like, boiled down to one string.
 *
 * Its pieces, the atlas they are painted from and the imported meshes. Notes,
 * export settings and the picture itself are left out, because changing those
 * does not change the picture.
 */
export function pictureFingerprint(
  project: Pick<LegoProject, "pieces" | "atlas" | "imported">,
): string {
  return hash(
    JSON.stringify([
      project.pieces,
      project.atlas ?? null,
      project.imported ?? null,
    ]),
  );
}

/** Whether the unit has changed since its picture was taken. */
export function pictureIsStale(
  project: Pick<LegoProject, "pieces" | "atlas" | "imported" | "picture">,
): boolean {
  return (
    project.picture !== undefined &&
    project.picture.fingerprint !== pictureFingerprint(project)
  );
}

/**
 * The digest of the picture the builder last wrote into `dir`, from the receipt,
 * or null if it never has.
 *
 * This is what the write once rule compares the file on disk to.
 */
export function pictureDigest(
  exported: LegoExport | undefined,
  dir: string,
  unitName: string,
): string | null {
  if (!exported) return null;
  const wanted = `${comparablePath(dir)}/unitpics/${unitName}.png`;
  const file = exported.files.find((f) => comparablePath(f.path) === wanted);
  return file?.sha256 ?? null;
}

/**
 * What to tell the game maker about their game's own pictures.
 *
 * The builder writes a PNG of the size they chose. A game whose pictures are
 * another size scales this one or looks wrong with it, and the engine reads
 * `.dds`, `.png`, `.pcx` then `.bmp`, in that order, so another format may be
 * the one it uses.
 */
export function pictureNotices(survey: PictureSurvey, size: number): string[] {
  const notices: string[] = [];
  const common = survey.pngSizes[0];
  if (common && (common.width !== size || common.height !== size)) {
    notices.push(
      `Most of this game's PNG build pictures are ${common.width} by ${common.height} pixels. This one is ${size} by ${size}.`,
    );
  }
  if (survey.otherFormats.length > 0) {
    const formats = survey.otherFormats.map((f) => f.extension).join(", ");
    notices.push(
      `This game also has build pictures as ${formats} files. Coilbox writes a PNG.`,
    );
  }
  return notices;
}
