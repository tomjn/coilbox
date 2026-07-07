import { mulberry32 } from "../rng";
import { hashString } from "./layout";

/**
 * Pure geometry builders for the decorative starfield — the galactic disc the
 * playable subsection sits in. Returns plain typed arrays (positions, colours,
 * sizes, twinkle phases/speeds) that `GalaxyView` uploads as buffer
 * attributes; no three.js here so the density maths unit-tests.
 */

export interface StarfieldOptions {
  /** Number of stars. */
  count: number;
  /** Disc radius (world units). */
  radius: number;
  /** Vertical thickness of the disc (world units). */
  thickness: number;
  /** Y offset of the disc's mid-plane (negative = below the play plane). */
  yOffset: number;
  /** Seed string — same seed, same sky (stable across mounts). */
  seed: string;
  /** Optional `#rrggbb` tints; defaults to a white/blue/amber temperature mix. */
  palette?: string[];
}

export interface StarfieldBuffers {
  /** xyz per star. */
  positions: Float32Array;
  /** rgb (0..1) per star. */
  colors: Float32Array;
  /** Point-size multiplier per star. */
  sizes: Float32Array;
  /** Twinkle phase (radians) per star. */
  phases: Float32Array;
  /** Twinkle speed (rad/s) per star. */
  speeds: Float32Array;
}

/** Default star temperature palette: mostly white, some blue and amber. */
const DEFAULT_PALETTE: [number, number, number][] = [
  [1.0, 1.0, 1.0],
  [0.75, 0.85, 1.0],
  [1.0, 0.9, 0.7],
  [0.85, 0.9, 1.0],
  [1.0, 0.8, 0.8],
];

function hexToRgb01(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** Standard-normal-ish sample (Box–Muller, one output). */
function gaussian(rng: () => number): number {
  const u = Math.max(rng(), 1e-9);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

const ARMS = 3;
/** How tightly the spiral winds (bigger = more turns across the radius). */
const WIND = 2.4;

/**
 * Sample a galactic disc with a log-spiral arm density pattern: radius is
 * biased inward, each star snaps near one of {@link ARMS} arms whose angle
 * advances with `log(r)`, then gaussian scatter blurs the arms into a believable
 * disc. Deterministic for a given seed.
 */
export function buildStarfield(opts: StarfieldOptions): StarfieldBuffers {
  const rng = mulberry32(hashString(opts.seed));
  const palette = opts.palette?.length
    ? opts.palette.map(hexToRgb01)
    : DEFAULT_PALETTE;

  const positions = new Float32Array(opts.count * 3);
  const colors = new Float32Array(opts.count * 3);
  const sizes = new Float32Array(opts.count);
  const phases = new Float32Array(opts.count);
  const speeds = new Float32Array(opts.count);

  for (let i = 0; i < opts.count; i++) {
    // Inward-biased radius (sqrt would be uniform; ^0.7 concentrates the core).
    const r = opts.radius * (0.08 + 0.92 * rng() ** 0.7);
    const arm = Math.floor(rng() * ARMS);
    const armAngle =
      (arm * 2 * Math.PI) / ARMS + Math.log(1 + r / opts.radius) * WIND * 2;
    // Arm scatter widens with radius so the core reads dense and the rim wispy.
    const angle = armAngle + gaussian(rng) * (0.18 + 0.25 * (r / opts.radius));
    const y = opts.yOffset + gaussian(rng) * (opts.thickness / 2);

    positions[i * 3] = Math.cos(angle) * r;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = Math.sin(angle) * r;

    const [cr, cg, cb] = palette[Math.floor(rng() * palette.length)];
    // Dim with a wide spread so a few stars pop and most recede.
    const brightness = 0.25 + 0.75 * rng() ** 2;
    colors[i * 3] = cr * brightness;
    colors[i * 3 + 1] = cg * brightness;
    colors[i * 3 + 2] = cb * brightness;

    sizes[i] = 0.5 + rng() * 1.3;
    phases[i] = rng() * Math.PI * 2;
    speeds[i] = 0.4 + rng() * 1.8;
  }

  return { positions, colors, sizes, phases, speeds };
}
