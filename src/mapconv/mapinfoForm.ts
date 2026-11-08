import type { MapAppearance, MapinfoForm } from "./bindings";

/**
 * The Compile page's `mapinfo.lua` fields, held as strings so an empty field
 * means "the page has no opinion". An empty field is left out of the request,
 * so the writer keeps whatever an existing file says or, for a new file, uses
 * its own default.
 */
export interface MapinfoDraft {
  name: string;
  shortname: string;
  description: string;
  author: string;
  /** `#rrggbb`, or empty for the default. */
  skyColor: string;
  fogColor: string;
  sunColor: string;
  groundAmbientColor: string;
  groundDiffuseColor: string;
  waterSurfaceColor: string;
  sunDir: [string, string, string];
  waterSurfaceAlpha: string;
  terrainHardness: string;
  /**
   * One row per team. `null` means the page has no opinion, so the file's teams
   * stay. A list, even an empty one, is the page's say: rows taken out are taken
   * out of the file, and an empty list removes the start positions.
   */
  startRows: { x: string; z: string }[] | null;
}

export const defaultMapinfoDraft: MapinfoDraft = {
  name: "",
  shortname: "",
  description: "",
  author: "",
  skyColor: "",
  fogColor: "",
  sunColor: "",
  groundAmbientColor: "",
  groundDiffuseColor: "",
  waterSurfaceColor: "",
  sunDir: ["", "", ""],
  waterSurfaceAlpha: "",
  terrainHardness: "",
  startRows: null,
};

export type ColourKey =
  | "skyColor"
  | "fogColor"
  | "sunColor"
  | "groundAmbientColor"
  | "groundDiffuseColor"
  | "waterSurfaceColor";

type Rgb = [number, number, number];

/** What the writer uses for a new file, which is also the engine's own default. */
export const COLOUR_DEFAULTS: Record<ColourKey, Rgb> = {
  skyColor: [0.1, 0.15, 0.7],
  fogColor: [0.7, 0.7, 0.8],
  sunColor: [1, 1, 1],
  groundAmbientColor: [0.5, 0.5, 0.5],
  groundDiffuseColor: [0.5, 0.5, 0.5],
  waterSurfaceColor: [0.75, 0.8, 0.85],
};

export const SUN_DIR_DEFAULT: Rgb = [0, 1, 2];

const channel = (v: number) =>
  Math.round(Math.min(1, Math.max(0, v)) * 255)
    .toString(16)
    .padStart(2, "0");

/** `[0.1, 0.15, 0.7]` as `#1a26b3`. */
export function rgbToHex(c: Rgb): string {
  return `#${c.map(channel).join("")}`;
}

/** `#1a26b3` as three values in 0 to 1, rounded to three places. */
export function hexToRgb(hex: string): Rgb | undefined {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) return undefined;
  const v = (s: string) =>
    Math.round((Number.parseInt(s, 16) / 255) * 1000) / 1000;
  return [v(m[1]), v(m[2]), v(m[3])];
}

function text(s: string): string | undefined {
  const t = s.trim();
  return t === "" ? undefined : t;
}

function finite(s: string): number | undefined {
  if (s.trim() === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/** A number from 0 to 1, as the water opacity field allows. */
function opacity(s: string): number | undefined {
  const n = finite(s);
  return n !== undefined && n >= 0 && n <= 1 ? n : undefined;
}

/** The request body for `mc_write_mapinfo`. Empty and unreadable fields are left out. */
export function toMapinfoForm(d: MapinfoDraft): MapinfoForm {
  const sun = d.sunDir.map(finite);
  const sunDir =
    sun.every((n) => n !== undefined) && sun.some((n) => n !== 0)
      ? (sun as Rgb)
      : undefined;
  return {
    name: text(d.name),
    shortname: text(d.shortname),
    description: text(d.description),
    author: text(d.author),
    skyColor: hexToRgb(d.skyColor),
    fogColor: hexToRgb(d.fogColor),
    sunColor: hexToRgb(d.sunColor),
    sunDir,
    groundAmbientColor: hexToRgb(d.groundAmbientColor),
    groundDiffuseColor: hexToRgb(d.groundDiffuseColor),
    waterSurfaceColor: hexToRgb(d.waterSurfaceColor),
    waterSurfaceAlpha: opacity(d.waterSurfaceAlpha),
    terrainHardness: finite(d.terrainHardness),
    // One slot per row. A row with a missing coordinate is null, not dropped,
    // because the slot's position is the team number the writer uses.
    startPositions: d.startRows?.map((p) => {
      const x = finite(p.x);
      const z = finite(p.z);
      return x === undefined || z === undefined ? null : { x, z };
    }),
  };
}

/**
 * The saved draft as the page state. Drafts saved before the page could tell
 * "no start positions" from "leave them alone" kept their rows in
 * `startPositions`, with an empty list for both. Their rows are used and an
 * empty list is read as leaving the file's teams alone, so an old draft never
 * removes the teams of a file it never looked at.
 */
export function readSavedMapinfo(
  saved:
    | (Partial<MapinfoDraft> & {
        startPositions?: { x: string; z: string }[];
      })
    | undefined,
): MapinfoDraft {
  const { startPositions: legacy, ...current } = saved ?? {};
  const startRows =
    current.startRows !== undefined
      ? current.startRows
      : legacy?.length
        ? legacy
        : null;
  return { ...defaultMapinfoDraft, ...current, startRows };
}

/** How many fields the user has set, for the section's badge. */
export function countMapinfo(d: MapinfoDraft): number {
  const form = toMapinfoForm(d);
  const { startPositions, ...rest } = form;
  return (
    Object.values(rest).filter((v) => v !== undefined).length +
    (startPositions ?? []).filter((p) => p !== null).length
  );
}

/**
 * The sky the Compile page's preview shows: the source folder's `mapinfo.lua`
 * with the page's own sky, fog and sun overriding it, the values Write
 * mapinfo.lua puts in the compiled map. The page writes its sun colour to
 * `atmosphere.sunColor`, so it colours the sky's sun and not the ground.
 */
export function withFormSky(
  app: MapAppearance | null,
  form: MapinfoForm,
): MapAppearance | null {
  if (!form.skyColor && !form.fogColor && !form.sunColor && !form.sunDir)
    return app;
  return {
    ...app,
    skyColor: form.skyColor ?? app?.skyColor,
    fogColor: form.fogColor ?? app?.fogColor,
    skySunColor: form.sunColor ?? app?.skySunColor,
    sunDir: form.sunDir ?? app?.sunDir,
  };
}
