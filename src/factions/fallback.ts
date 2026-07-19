/**
 * Bundled faction emblems for the huge population of Total-Annihilation-derived
 * games that use `arm`/`core` sides and ship no `Sidepics/` folder (and will never
 * be updated). Matched case-insensitively on the side name.
 *
 * The source SVGs have no `fill` (they'd default to black — invisible on the dark
 * UI), so we render them *inline* with `fill="currentColor"` on the root, letting
 * them inherit the surrounding text colour and adapt to the theme. That's why the
 * resolver returns a small union: remote/archive rasters are `<img>` with their own
 * colours; these bundled vectors are inline SVG.
 *
 * The table is deliberately open for more legacy polyfills later — add a lowercase
 * side key mapped to inline SVG markup.
 */

/** A resolved faction logo: an `<img>` source (with the source's longest pixel side
 * when known) or inline SVG markup that inherits `currentColor`. */
export type FactionLogoSrc =
  | { kind: "img"; src: string; maxDim?: number }
  | { kind: "inline"; svg: string };

// Arm emblem (viewBox 400x400). Paths carry no fill; the root `fill="currentColor"`
// propagates to them.
const ARM_SVG = `<svg viewBox="0 0 400 400" fill="currentColor" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><path d="M373.3,181.6l22.6-23.1c0,0,0-1.9,0-2.5s-107.1,0-107.1,0L220.1,54.8h-1.2l-9.1,19.4v12.3l64,95.1l2.5,1L373.3,181.6z"/><path d="M27.6,181.6L5,158.4c0,0,0-1.9,0-2.5s106.5,0,106.5,0l68.4-101.2h1.2l9.1,19.4v12.3l-63.7,95.1l-2.4,1L27.6,181.6z"/><polygon points="198.6,308.5 201.3,308.5 273.5,201.8 275.4,200.6 375.1,200.6 399.5,222.1 397.3,223.6 294,223.5 199.9,369.7 "/><polygon points="201.3,308.5 198.6,308.5 126.4,201.8 124.5,200.6 24.8,200.6 0.5,222.1 2.7,223.6 105.9,223.5 199.9,369.7 "/><polygon points="143.2,185.2 199,103.9 201.8,103.9 256.8,185.2 256.8,196.5 201.2,277.3 199.9,277.3 143.2,196.5 "/></svg>`;

// Core emblem (viewBox 800x800).
const CORE_SVG = `<svg viewBox="0 0 800 800" fill="currentColor" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg"><polygon points="344.6,44.9 344.6,3.8 337.4,5.2 328.7,7.2 320.2,9.5 308.6,13.1 300.9,15.9 289.4,20.5 275.3,27.2 264.1,33.1 251.6,40.5 238.1,49.4 226.1,58.3 220.8,62.6 210.7,71.2 202.4,78.7 192.5,88.5 184.5,97.1 175,108.2 168,116.9 161,126.5 154.7,135.8 148.3,145.7 143.6,153.8 139.3,161.7 132.9,174.5 129.3,182.4 126.6,188.8 124,195.3 120.9,204 117.5,214.6 115.3,222.6 113.4,230.4 111.7,238.4 110.4,245.5 109.2,253.1 108.5,259.1 108,265.1 107.5,272.5 107.3,277.2 107.2,280.8 107.2,282.6 114.7,282.6 117.1,282.6 303.2,88.1 "/><polygon points="456.9,45.4 456.9,3.8 464,5.2 472.7,7.2 481.2,9.5 492.8,13.2 500.5,16.1 512,20.8 526.1,27.5 537.3,33.5 549.8,41 563.3,50.1 575.3,59.1 580.6,63.4 590.7,72.1 599,79.7 608.9,89.7 616.9,98.4 626.4,109.6 633.4,118.5 640.4,128.2 646.8,137.6 653.1,147.7 657.8,155.8 662.1,163.8 668.5,176.8 672.1,184.8 674.8,191.3 677.4,197.9 680.5,206.7 683.9,217.5 686.1,225.6 688,233.4 689.7,241.6 691,248.8 692.2,256.5 692.9,262.5 693.4,268.6 693.9,276.2 694.1,280.9 694.2,284.6 694.2,286.4 686.7,286.4 684.3,286.4 498.3,89.2 "/><polygon points="640.5,790.2 632.4,789 628,512.5 404.6,288.2 394.7,288.2 171.4,511.3 166.6,788.4 156.8,788.4 56.5,402.8 56.5,388.1 393.2,45.5 404.3,45.5 740.7,386.1 743.4,395.6 "/><polygon points="407.9,329.2 392.1,329.2 195.1,525.9 201.1,531.8 205.6,535.9 210.5,540.3 216.2,545.2 221.6,549.5 226.5,553.3 232,557.3 238,561.5 244.5,565.8 250.5,569.5 255.2,572.3 259.1,574.6 265.1,577.8 271.4,581.1 277.1,583.8 281,585.6 285.8,587.7 291.5,590.1 298.4,592.8 305.9,595.5 312,597.5 317.3,599.2 321.4,600.4 325.9,601.6 330.6,602.8 334.8,603.8 338.5,604.6 345.3,606 349.1,606.7 355,607.7 358.6,608.2 363.2,608.8 368.4,609.5 373.2,609.9 377.7,610.3 384.6,610.8 389.3,611 393.3,611 396.1,611 400.9,611.2 407.9,611.1 415.7,610.8 423.1,610.3 427.7,609.9 432.4,609.4 440.1,608.4 446.2,607.5 453.1,606.3 461.5,604.6 472,602.1 482.6,599.2 495,595.2 504.5,591.7 515.3,587.3 519.8,585.2 525.2,582.7 530.6,580 536.1,577.2 542.9,573.4 548.3,570.3 553,567.4 557.5,564.5 563.1,560.8 567.8,557.5 571.4,554.9 575.4,551.8 579,549 582.7,546 585.6,543.7 589.1,540.7 592.4,537.8 596,534.5 599.2,531.5 601.5,529.3 603.3,527.6 604.8,526 "/></svg>`;

/** Lowercase side name -> bundled inline SVG. Extend with more legacy emblems. */
const TA_FALLBACK: Record<string, string> = {
  arm: ARM_SVG,
  core: CORE_SVG,
};

/** A bundled emblem for a side name, or `undefined` if none is bundled. */
export function fallbackFactionLogo(side: string): FactionLogoSrc | undefined {
  const svg = TA_FALLBACK[side.trim().toLowerCase()];
  return svg ? { kind: "inline", svg } : undefined;
}
