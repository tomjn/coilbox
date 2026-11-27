import type { ReplayTrackTeam } from "../bindings";
import type { UnitIcons } from "./icons";
import type { MapScene } from "./scene";

/** The canvas the scene is drawn on. `width` and `height` are its own pixels,
 *  `scale` is pixels for each elmo, and `pixelRatio` is the screen's. */
export interface MapViewport {
  width: number;
  height: number;
  scale: number;
  pixelRatio: number;
}

/** What one picture put on the canvas. */
export interface PaintCounts {
  units: number;
  projectiles: number;
  wrecks: number;
  /** How many circles marked a shot landing or a unit dying. */
  explosions: number;
  /** How many of the units were drawn as their game icon. */
  icons: number;
  /** Whether the unit asked to be ringed is in the picture. */
  highlighted: boolean;
  /** Where the ring was drawn, in canvas pixels: its centre and radius. Null
   *  when no unit is ringed. */
  ring: { x: number; y: number; radius: number } | null;
}

/** The part of a 2D context the painter uses, so a test can hand it a
 *  recorder. */
export type PaintContext = Pick<
  CanvasRenderingContext2D,
  | "setTransform"
  | "clearRect"
  | "beginPath"
  | "moveTo"
  | "lineTo"
  | "closePath"
  | "drawImage"
  | "rect"
  | "arc"
  | "fill"
  | "stroke"
  | "fillStyle"
  | "strokeStyle"
  | "globalAlpha"
  | "lineWidth"
>;

/** How a team's marks are coloured. */
export interface TeamStyle {
  fill: string;
  /** The line round a mark: dark round a light colour, pale round a dark. */
  edge: string;
  /** How much of the team's units show, 0 to 1. Left out it is 1. */
  alpha?: number;
  /** The team is the one being pointed at: drawn last, with a halo. */
  lit?: boolean;
}

/** Display choices, in CSS pixels. They are how the picture looks and bound
 *  nothing in the track. */
/** Half the smallest mark, so 1,368 units on a small map are still 3 pixels
 *  each and can be told from the ground. */
export const LEAST_HALF_MARK = 1.5;
/** How far a facing line runs past the front of its mark, at the least. */
const FACING_REACH = 2.5;
/** A projectile's line, shortest and longest, and how many frames of its
 *  travel the line stands for between the two. */
export const SHOT_SHORTEST = 2;
export const SHOT_LONGEST = 9;
export const SHOT_FRAMES = 3;
export const HALF_WRECK = 1;
/** An explosion's circle at its fullest, in elmos and as least in CSS pixels,
 *  so it can be seen on a large map. A unit's death is the larger. Chosen by
 *  eye on a real battle. */
export const SHOT_BLAST_ELMOS = 20;
export const SHOT_BLAST_LEAST = 5;
export const DEATH_BLAST_ELMOS = 44;
export const DEATH_BLAST_LEAST = 11;
/** How big a circle is when it begins, as a part of its full size. */
export const BLAST_START = 0.3;
/** A circle is drawn in this many bands of opacity, so a frame costs this many
 *  fills however many circles it holds. */
export const BLAST_BANDS = 4;
/** How solid a circle is when it begins. */
export const BLAST_OPACITY = 0.9;
/** How much of a unit shows when construction has only just started. A unit
 *  at 0 would otherwise be invisible while it is on the map. */
const FAINTEST = 0.25;
/** How much of a faint team's units show. Enough that the battle still reads
 *  where the player is left out, and far enough from 1 that it recedes. */
export const FAINT_UNITS = 0.3;
/** The least a faint team's unit under construction shows, so it is still
 *  on the map. */
const FAINT_FLOOR = 0.12;

const DARK_EDGE = "rgba(9, 13, 22, 0.9)";
const PALE_EDGE = "rgba(226, 232, 240, 0.85)";
export const WRECK = "rgba(148, 156, 170, 0.85)";
export const SHOT = "rgba(255, 236, 170, 0.95)";
/** The colour of an explosion's circle. */
export const BLAST_FILL = "rgb(255, 196, 0)";
const RING = "rgba(255, 255, 255, 0.95)";
const NO_TEAM: TeamStyle = { fill: "rgb(148, 156, 170)", edge: DARK_EDGE };

/** The red, green and blue of a `#rrggbb` or `rgb(r, g, b)` colour, 0 to 255. */
function channels(css: string): [number, number, number] | null {
  const hex = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(css.trim());
  if (hex)
    return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
  const rgb = /^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i.exec(css.trim());
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
}

/**
 * How a mark in this colour is drawn. A colour too dark to see against the
 * dimmed map gets a pale edge, so the mark still reads as a shape.
 */
export function styleOfColour(css: string): TeamStyle {
  const rgb = channels(css);
  if (!rgb) return { fill: css, edge: DARK_EDGE };
  const [r, g, b] = rgb;
  // Relative luminance as sRGB weights it, without the gamma step, which is
  // close enough to choose between two edges.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return { fill: css, edge: luminance < 0.25 ? PALE_EDGE : DARK_EDGE };
}

/**
 * Each team's colours. They are the track's own, unless `colours` says what the
 * team is drawn in elsewhere on the page, which then wins.
 */
export function teamStyles(
  teams: readonly ReplayTrackTeam[],
  colours?: ReadonlyMap<number, string>,
): ReadonlyMap<number, TeamStyle> {
  const styles = new Map<number, TeamStyle>();
  for (const team of teams) {
    const [r, g, b] = team.colour;
    styles.set(
      team.id,
      styleOfColour(colours?.get(team.id) ?? `rgb(${r}, ${g}, ${b})`),
    );
  }
  return styles;
}

/** What the page's players table says about the teams on the map. */
export interface TeamEmphasis {
  /** Teams unticked in the players table. */
  hidden: readonly number[];
  /** The teams pointed at, or null when none is. */
  active: readonly number[] | null;
}

/**
 * The styles with the table's choices applied. A team unticked, or not the one
 * pointed at while another is, is faint. The team pointed at is lit. Colour is
 * never changed, as with the chart's lines.
 */
export function emphasisedStyles(
  base: ReadonlyMap<number, TeamStyle>,
  { hidden, active }: TeamEmphasis,
): ReadonlyMap<number, TeamStyle> {
  if (hidden.length === 0 && active === null) return base;
  const out = new Map<number, TeamStyle>();
  for (const [team, style] of base) {
    const unticked = hidden.includes(team);
    const pointed = active?.includes(team) ?? false;
    const faint = unticked || (active !== null && !pointed);
    out.set(team, {
      ...style,
      alpha: faint ? FAINT_UNITS : 1,
      lit: pointed && !unticked,
    });
  }
  return out;
}

/** How much of a unit shows at a build progress of 0 to 1. */
export function buildAlpha(build: number): number {
  if (build >= 1) return 1;
  // Never as solid as a finished unit, so the two are always told apart.
  return FAINTEST + (0.85 - FAINTEST) * Math.max(build, 0);
}

/**
 * Draws a scene: the wrecks, then the units, then the projectiles, then the
 * explosions, then a ring round the unit asked for. Each is its own pass.
 *
 * World x runs along the canvas and world z runs down it, as on the minimap.
 * `icons` draws each unit that has one as its game icon and every other as its
 * footprint. With none, every unit is its footprint.
 */
export function paintScene(
  ctx: PaintContext,
  scene: MapScene,
  view: MapViewport,
  teams: ReadonlyMap<number, TeamStyle>,
  highlight: number | null,
  icons: UnitIcons | null = null,
): PaintCounts {
  const { scale, pixelRatio: u } = view;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.clearRect(0, 0, view.width, view.height);

  paintWrecks(ctx, scene, view);
  const { ringed, iconed } = paintUnits(
    ctx,
    scene,
    view,
    teams,
    highlight,
    icons,
  );
  paintProjectiles(ctx, scene, view);
  paintExplosions(ctx, scene, view);

  let ring: PaintCounts["ring"] = null;
  if (ringed >= 0) {
    const iconEdge = icons?.edge(scene.unitDef[ringed], u) ?? 0;
    const reach =
      (iconEdge > 0
        ? (iconEdge / 2) * Math.SQRT2
        : Math.max(
            scene.unitAlong[ringed] * scale,
            scene.unitAcross[ringed] * scale,
            LEAST_HALF_MARK * u,
          ) * Math.SQRT2) +
      3 * u;
    ctx.beginPath();
    ctx.arc(
      scene.unitX[ringed] * scale,
      scene.unitZ[ringed] * scale,
      reach,
      0,
      Math.PI * 2,
    );
    ctx.lineWidth = 1.5 * u;
    ctx.strokeStyle = RING;
    ctx.stroke();
    ring = {
      x: scene.unitX[ringed] * scale,
      y: scene.unitZ[ringed] * scale,
      radius: reach,
    };
  }

  return {
    units: scene.units,
    projectiles: scene.projectiles,
    wrecks: scene.wrecks,
    explosions: scene.blasts,
    icons: iconed,
    highlighted: ringed >= 0,
    ring,
  };
}

function paintWrecks(
  ctx: PaintContext,
  scene: MapScene,
  { scale, pixelRatio: u }: MapViewport,
): void {
  if (scene.wrecks === 0) return;
  const half = HALF_WRECK * u;
  ctx.beginPath();
  for (let i = 0; i < scene.wrecks; i++) {
    ctx.rect(
      scene.wreckX[i] * scale - half,
      scene.wreckZ[i] * scale - half,
      half * 2,
      half * 2,
    );
  }
  ctx.fillStyle = WRECK;
  ctx.fill();
}

/**
 * Units go down a team at a time. Every finished footprint of a team is one
 * path, filled once, so a frame with a thousand units is a few dozen canvas
 * calls that paint and not a thousand. A unit under construction has its own
 * opacity and so its own fill. A unit with an icon is drawn from the icon
 * after its team's footprints, a picture to a unit. Returns the index of the
 * unit asked to be ringed, or -1, and how many units were drawn as icons.
 */
function paintUnits(
  ctx: PaintContext,
  scene: MapScene,
  view: MapViewport,
  teams: ReadonlyMap<number, TeamStyle>,
  highlight: number | null,
  icons: UnitIcons | null,
): { ringed: number; iconed: number } {
  const { scale, pixelRatio: u } = view;
  const least = LEAST_HALF_MARK * u;
  const hasIcon = (i: number) =>
    icons !== null && icons.edge(scene.unitDef[i], u) > 0;
  let iconed = 0;
  const outline = (i: number) => {
    const cx = scene.unitX[i] * scale;
    const cz = scene.unitZ[i] * scale;
    let fx = scene.unitFx[i];
    let fz = scene.unitFz[i];
    const length = Math.hypot(fx, fz);
    if (length < 1e-6) {
      fx = 0;
      fz = 1;
    } else {
      fx /= length;
      fz /= length;
    }
    const along = Math.max(scene.unitAlong[i] * scale, least);
    const across = Math.max(scene.unitAcross[i] * scale, least);
    // The front is along (fx, fz) and the side is a quarter turn from it.
    const ax = fx * along;
    const az = fz * along;
    const sx = -fz * across;
    const sz = fx * across;
    ctx.moveTo(cx + ax + sx, cz + az + sz);
    ctx.lineTo(cx + ax - sx, cz + az - sz);
    ctx.lineTo(cx - ax - sx, cz - az - sz);
    ctx.lineTo(cx - ax + sx, cz - az + sz);
    ctx.closePath();
  };
  const facing = (i: number) => {
    const cx = scene.unitX[i] * scale;
    const cz = scene.unitZ[i] * scale;
    const fx = scene.unitFx[i];
    const fz = scene.unitFz[i];
    const length = Math.hypot(fx, fz);
    if (length < 1e-6) return;
    const along = Math.max(scene.unitAlong[i] * scale, least);
    const reach = along + Math.max(FACING_REACH * u, along * 0.6);
    ctx.moveTo(cx, cz);
    ctx.lineTo(cx + (fx / length) * reach, cz + (fz / length) * reach);
  };

  // The teams in the picture, in rising order so the order of drawing does not
  // change from one frame to the next.
  const present: number[] = [];
  for (let i = 0; i < scene.units; i++) {
    if (!present.includes(scene.unitTeam[i])) present.push(scene.unitTeam[i]);
  }
  // The team pointed at goes last, so it is never under another's units.
  const litTeam = (team: number) => teams.get(team)?.lit === true;
  present.sort((a, b) => Number(litTeam(a)) - Number(litTeam(b)) || a - b);

  ctx.lineWidth = u;
  let ringed = -1;
  for (const team of present) {
    const style = teams.get(team) ?? NO_TEAM;
    const teamAlpha = style.alpha ?? 1;
    const edge = style.lit ? RING : style.edge;
    const edgeWidth = style.lit ? 2 * u : u;
    let built = 0;
    ctx.beginPath();
    for (let i = 0; i < scene.units; i++) {
      if (scene.unitTeam[i] !== team) continue;
      if (highlight !== null && scene.unitSerial[i] === highlight) ringed = i;
      if (scene.unitBuild[i] < 1 || hasIcon(i)) continue;
      outline(i);
      built++;
    }
    if (built > 0) {
      ctx.globalAlpha = teamAlpha;
      ctx.lineWidth = edgeWidth;
      ctx.strokeStyle = edge;
      ctx.stroke();
      ctx.fillStyle = style.fill;
      ctx.fill();
      ctx.beginPath();
      for (let i = 0; i < scene.units; i++) {
        if (
          scene.unitTeam[i] === team &&
          scene.unitBuild[i] >= 1 &&
          !hasIcon(i)
        ) {
          facing(i);
        }
      }
      ctx.lineWidth = u;
      ctx.strokeStyle = style.fill;
      ctx.stroke();
    }
    for (let i = 0; i < scene.units; i++) {
      if (scene.unitTeam[i] !== team || scene.unitBuild[i] >= 1 || hasIcon(i)) {
        continue;
      }
      const shown = buildAlpha(scene.unitBuild[i]) * teamAlpha;
      ctx.globalAlpha = teamAlpha < 1 ? Math.max(shown, FAINT_FLOOR) : shown;
      ctx.beginPath();
      outline(i);
      ctx.lineWidth = edgeWidth;
      ctx.strokeStyle = edge;
      ctx.stroke();
      ctx.fillStyle = style.fill;
      ctx.fill();
      ctx.beginPath();
      facing(i);
      ctx.lineWidth = u;
      ctx.strokeStyle = style.fill;
      ctx.stroke();
    }
    if (icons) {
      for (let i = 0; i < scene.units; i++) {
        if (scene.unitTeam[i] !== team) continue;
        const sprite = icons.sprite(
          scene.unitDef[i],
          style.fill,
          style.lit === true,
          u,
        );
        if (!sprite) continue;
        const shown = buildAlpha(scene.unitBuild[i]) * teamAlpha;
        ctx.globalAlpha =
          scene.unitBuild[i] >= 1
            ? teamAlpha
            : teamAlpha < 1
              ? Math.max(shown, FAINT_FLOOR)
              : shown;
        const { width, height } = sprite as { width: number; height: number };
        ctx.drawImage(
          sprite,
          scene.unitX[i] * scale - width / 2,
          scene.unitZ[i] * scale - height / 2,
        );
        iconed++;
      }
    }
    ctx.globalAlpha = 1;
  }

  return { ringed, iconed };
}

function paintProjectiles(
  ctx: PaintContext,
  scene: MapScene,
  { scale, pixelRatio: u }: MapViewport,
): void {
  if (scene.projectiles === 0) return;
  ctx.beginPath();
  for (let i = 0; i < scene.projectiles; i++) {
    const x = scene.shotX[i] * scale;
    const z = scene.shotZ[i] * scale;
    const vx = scene.shotVx[i];
    const vz = scene.shotVz[i];
    const speed = Math.hypot(vx, vz);
    const length = Math.min(
      Math.max(speed * scale * SHOT_FRAMES, SHOT_SHORTEST * u),
      SHOT_LONGEST * u,
    );
    // One falling straight down has no direction on the map, and is drawn as
    // the shortest line across.
    const dx = speed < 1e-6 ? 1 : vx / speed;
    const dz = speed < 1e-6 ? 0 : vz / speed;
    ctx.moveTo(x - dx * length, z - dz * length);
    ctx.lineTo(x, z);
  }
  ctx.lineWidth = u;
  ctx.strokeStyle = SHOT;
  ctx.stroke();
}

/**
 * A yellow circle for each shot that landed and each unit that died, growing
 * and fading with how far through its fade the scene has it (#5317). A circle
 * is drawn from its progress alone, so a frame looks the same however it was
 * reached.
 *
 * One fill has one opacity, so circles are gathered into {@link BLAST_BANDS}
 * bands of progress and each band is one path and one fill. A frame costs that
 * many fills whether it holds ten circles or a thousand.
 */
function paintExplosions(
  ctx: PaintContext,
  scene: MapScene,
  { scale, pixelRatio: u }: MapViewport,
): void {
  if (scene.blasts === 0) return;
  ctx.fillStyle = BLAST_FILL;
  for (let band = 0; band < BLAST_BANDS; band++) {
    let any = false;
    ctx.beginPath();
    for (let i = 0; i < scene.blasts; i++) {
      const progress = scene.blastProgress[i];
      if (
        Math.min(Math.floor(progress * BLAST_BANDS), BLAST_BANDS - 1) !== band
      ) {
        continue;
      }
      const full = scene.blastDeath[i]
        ? Math.max(DEATH_BLAST_ELMOS * scale, DEATH_BLAST_LEAST * u)
        : Math.max(SHOT_BLAST_ELMOS * scale, SHOT_BLAST_LEAST * u);
      // Quick at first and slower after, as a burst spreads.
      const radius =
        full * (BLAST_START + (1 - BLAST_START) * Math.sqrt(progress));
      const x = scene.blastX[i] * scale;
      const z = scene.blastZ[i] * scale;
      ctx.moveTo(x + radius, z);
      ctx.arc(x, z, radius, 0, Math.PI * 2);
      any = true;
    }
    if (!any) continue;
    ctx.globalAlpha = BLAST_OPACITY * (1 - (band + 0.5) / BLAST_BANDS);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
