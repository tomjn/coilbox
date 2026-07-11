/**
 * Shared, hook-free team-colour core, in the `#rrggbb` hex space. Every surface
 * that assigns a player colour (the multiplayer lobby, self-hosted battles, and
 * singleplayer skirmish) picks the *value* here, then bridges hex to its own
 * encoding — the lobby's `0xBBGGRR` int (`config.ts`) or play's `0..1` float RGB
 * (`participants.ts`). Those converters are deliberately NOT shared; only this
 * hex-space core is. Mirrors `src/lib/assetUrl.ts` as a pure lib module.
 *
 * Framing: in the Spring lobby protocol there is no "no colour chosen" — the
 * client always picks its own team colour, so a `teamColor` of 0 (black) is never
 * a deliberate choice to protect, only an un-assigned default we must fill.
 */

/** Per-channel ceiling below which a colour counts as "black" (stale 0-default). */
const BLACK_MAX_CHANNEL = 0x18;

/** Split a validated `#rrggbb` into its three 0..255 channels. */
function channels(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

/** Canonicalise any-case hex, with or without a leading '#', to `#rrggbb`; else null. */
export function normalizeHex(hex?: string): string | null {
  if (!hex) return null;
  const body = hex.startsWith("#") ? hex.slice(1) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(body)) return null;
  return `#${body.toLowerCase()}`;
}

/**
 * Whether `hex` reads as black: every channel at or below {@link BLACK_MAX_CHANNEL}.
 * The threshold only bites near-`#000000` values (stale drafts / the protocol's 0
 * default); the saturated colours {@link randomTeamColorHex} produces never qualify.
 * A non-hex string is not "black" (callers normalise separately).
 */
export function isBlackHex(hex: string): boolean {
  const n = normalizeHex(hex);
  if (!n) return false;
  return channels(n).every((c) => c <= BLACK_MAX_CHANNEL);
}

/** HSL (h in 0..360, s/l in 0..1) -> `#rrggbb`. */
function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const rgb =
    h < 60
      ? [c, x, 0]
      : h < 120
        ? [x, c, 0]
        : h < 180
          ? [0, c, x]
          : h < 240
            ? [0, x, c]
            : h < 300
              ? [x, 0, c]
              : [c, 0, x];
  return `#${rgb
    .map((v) =>
      Math.round((v + m) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/**
 * A fresh random team colour as `#rrggbb`. A random hue at fixed saturation/
 * lightness always yields a bright, distinct colour — never the muddy or
 * near-black values a uniform-random RGB would sometimes produce. Used when the
 * user has no remembered colour yet, so they never join a battle as black.
 */
export function randomTeamColorHex(): string {
  return hslToHex(Math.floor(Math.random() * 360), 0.65, 0.55);
}

/** Manhattan (sum of per-channel) distance between two validated hex colours. */
function colorDistance(a: string, b: string): number {
  const [ar, ag, ab] = channels(a);
  const [br, bg, bb] = channels(b);
  return Math.abs(ar - br) + Math.abs(ag - bg) + Math.abs(ab - bb);
}

/**
 * Choose a team colour, in order of preference:
 *   (a) `remembered`, if it's valid, non-black and not already used;
 *   (b) the first `palette` entry that is non-black and not already used;
 *   (c) a random non-black colour, sampled to sit as far as possible from the
 *       colours already in use (maximise distance to the nearest used colour).
 * The `used` set may be any case, with or without '#'; invalid and black entries
 * are dropped so a stale 0-colour never blocks a pick. Always returns a canonical
 * non-black `#rrggbb`.
 */
export function pickTeamColorHex(opts: {
  remembered?: string;
  used: Iterable<string>;
  palette?: string[];
}): string {
  const used = new Set<string>();
  for (const u of opts.used) {
    const n = normalizeHex(u);
    if (n && !isBlackHex(n)) used.add(n);
  }
  const free = (hex: string) => !used.has(hex);

  const remembered = normalizeHex(opts.remembered);
  if (remembered && !isBlackHex(remembered) && free(remembered))
    return remembered;

  for (const entry of opts.palette ?? []) {
    const n = normalizeHex(entry);
    if (n && !isBlackHex(n) && free(n)) return n;
  }

  // Sample a handful of random colours and keep the one whose nearest used
  // colour is farthest away — cheap collision avoidance with no server arbitration.
  let best = randomTeamColorHex();
  let bestScore = -1;
  for (let i = 0; i < 24; i++) {
    const cand = randomTeamColorHex();
    if (used.has(cand)) continue;
    const score =
      used.size === 0
        ? Number.POSITIVE_INFINITY
        : Math.min(...[...used].map((u) => colorDistance(cand, u)));
    if (score > bestScore) {
      best = cand;
      bestScore = score;
    }
  }
  return best;
}
