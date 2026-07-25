#!/usr/bin/env bun
/**
 * Builds the real-star conquest catalogue from a checked-in RECONS snapshot.
 *
 * Reads `scripts/data/recons-top100.html` (the nearest 100 star systems, epoch
 * 2012-01-01) plus `scripts/data/supplement.json` (nearby systems discovered
 * after that snapshot), merges each system's components into one entry, and
 * writes `src/conquest/realstars/catalogue.json`.
 *
 * The snapshot is checked in rather than fetched so the build is reproducible
 * and any data change shows up as a reviewable diff. RECONS serves recons.org
 * under a certificate for astro.gsu.edu, so a live fetch needs `curl -k`.
 *
 * Run with `bun run stars:catalogue`.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT = join(ROOT, "scripts/data/recons-top100.html");
const SUPPLEMENT = join(ROOT, "scripts/data/supplement.json");
const OUT = join(ROOT, "src/conquest/realstars/catalogue.json");

/** Light years per parsec. */
const LY_PER_PC = 3.2615638;

/**
 * Fixed-width column offsets in the RECONS table. Verified against all 171
 * data rows: RA always starts at 34 and the parallax pair always at 75.
 */
const COL = {
  rank: [0, 4],
  designation: [5, 16],
  component: [16, 17],
  spectral: [98, 107],
  visualMag: [108, 116],
  commonName: [155, Number.MAX_SAFE_INTEGER],
};

const slice = (line, [a, b]) => line.slice(a, b).trim();

/**
 * Strip HTML tags without eating table content. A naive `<[^>]+>` swallows
 * whole rows, because notes like `orbit < 2"` look like an opening tag. This
 * requires a letter or `!` right after the bracket, which a literal `<` in
 * prose never has.
 */
function toText(html) {
  return html
    .replace(/<\/?[a-zA-Z!][^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

/** Sexagesimal right ascension ("14 29 43.0") to radians. */
function raToRadians(text) {
  const [h, m, s] = text.trim().split(/\s+/).map(Number);
  return ((h + m / 60 + s / 3600) * Math.PI) / 12;
}

/** Sexagesimal declination ("-62 40 46") to radians. */
function decToRadians(text) {
  const [d, m, s] = text.trim().split(/\s+/).map(Number);
  const sign = text.trim().startsWith("-") ? -1 : 1;
  return ((Math.abs(d) + m / 60 + s / 3600) * sign * Math.PI) / 180;
}

/**
 * Equatorial spherical coordinates to Cartesian light years, Sol at the
 * origin: +X toward the vernal equinox, +Z toward the north celestial pole,
 * +Y toward RA 6h. Same convention as the HYG database, so a cross-check
 * needs no transform.
 */
function toCartesian(raText, decText, parallaxArcsec) {
  const d = LY_PER_PC / parallaxArcsec;
  const ra = raToRadians(raText);
  const dec = decToRadians(decText);
  return {
    distance: d,
    pos: [
      d * Math.cos(dec) * Math.cos(ra),
      d * Math.cos(dec) * Math.sin(ra),
      d * Math.sin(dec),
    ],
  };
}

/** A spectral type we recognise: a class letter, or a white dwarf `D` type. */
const SPECTRAL =
  /^(D[A-Z]{0,2}\d*(\.\d)?|[OBAFGKMLTY]\d*(\.\d)?(\s+[IV]+(-[IV]+)?[A-Za-z]*)?)$/;

/** Parse the RECONS table into component rows, grouped into systems by rank. */
function parseRecons(text) {
  const systems = [];
  for (const line of text.split("\n")) {
    const coords = line.match(
      /(\d{2}) (\d{2}) (\d{2}\.\d) ([+-]\d{2}) (\d{2}) (\d{2})/,
    );
    const parallax = line.match(/(\d\.\d{5})\s+(\d\.\d{5})/);
    if (!coords || !parallax || coords.index !== 34 || parallax.index !== 75) {
      continue;
    }
    const spectral = slice(line, COL.spectral).replace(/\s+/g, " ");
    // The table lists known exoplanets as components. They are not stars and
    // never become nodes, so drop them before anything else looks at the row.
    if (spectral === "planet") continue;
    if (spectral !== "" && !SPECTRAL.test(spectral)) {
      throw new Error(
        `unrecognised spectral type ${JSON.stringify(spectral)} in: ${line}`,
      );
    }
    const magText = slice(line, COL.visualMag).replace(/[^\d.-]/g, "");
    const component = {
      designation: slice(line, COL.designation).replace(/\s+/g, " "),
      letter: slice(line, COL.component),
      spectral,
      visualMag: magText === "" ? Number.POSITIVE_INFINITY : Number(magText),
      commonName: slice(line, COL.commonName).replace(/\s+/g, " "),
      ...toCartesian(
        coords[0].slice(0, 10),
        coords[0].slice(11),
        Number(parallax[1]),
      ),
    };
    if (slice(line, COL.rank) !== "") systems.push([]);
    if (systems.length === 0) {
      throw new Error(`component row before any ranked system: ${line}`);
    }
    systems[systems.length - 1].push(component);
  }
  return systems;
}

/** Does this common-name cell hold a literature citation rather than a name? */
const isCitation = (s) => s === "" || /et al\.|\(\d{4}\)/.test(s);

/**
 * The display name for a merged system: the brightest component's common name
 * with any trailing component letter removed, falling back to its catalogue
 * designation when the table gives a citation instead of a name.
 */
function systemName(brightest) {
  const common = brightest.commonName.split(",")[0].trim();
  const base = isCitation(common)
    ? brightest.designation
    : common.replace(/\s+[A-C]$/, "");
  return base.charAt(0).toUpperCase() + base.slice(1);
}

/**
 * Collapse a system's components into one catalogue entry. Position and name
 * come from the brightest component, so Alpha Centauri A anchors the system
 * that RECONS ranks by Proxima. Components are listed brightest first.
 */
function mergeSystem(components) {
  const byBrightness = [...components].sort(
    (a, b) => a.visualMag - b.visualMag,
  );
  const brightest = byBrightness[0];
  return {
    name: systemName(brightest),
    distance: Math.hypot(...brightest.pos),
    pos: brightest.pos,
    components: byBrightness.map((c) => c.spectral).filter((s) => s !== ""),
  };
}

/** Round for a stable, reviewable committed file. */
const round = (n, places) => Number(n.toFixed(places));

function build() {
  const recons = parseRecons(toText(readFileSync(SNAPSHOT, "utf8")));
  const supplement = JSON.parse(readFileSync(SUPPLEMENT, "utf8"));

  const systems = recons.map(mergeSystem);

  for (const s of supplement.systems) {
    const { distance, pos } = toCartesian(s.ra, s.dec, s.parallax);
    systems.push({ name: s.name, distance, pos, components: s.components });
  }

  // Sol is not a row in the table, and sits at the origin by definition.
  systems.push({
    name: "Sol",
    distance: 0,
    pos: [0, 0, 0],
    components: ["G2 V"],
    home: true,
  });

  systems.sort((a, b) => a.distance - b.distance);

  verify(systems);

  const catalogue = {
    source:
      "RECONS, The One Hundred Nearest Star Systems (http://www.recons.org/TOP100.posted.htm), plus cited post-2012 discoveries",
    epoch: "2012-01-01, supplemented",
    note: "Positions are light years from Sol in equatorial Cartesian coordinates: +X to the vernal equinox, +Z to the north celestial pole. The census of very faint brown dwarfs is not closed, so this is a dated snapshot rather than a guarantee of completeness.",
    generatedBy: "scripts/build-star-catalogue.mjs",
    systems: systems.map((s) => ({
      ...s,
      distance: round(s.distance, 3),
      pos: s.pos.map((v) => round(v, 4)),
    })),
  };

  writeFileSync(OUT, `${JSON.stringify(catalogue, null, 2)}\n`);
  report(systems);
}

/**
 * Fail loudly on known values. A silent parse drift producing a plausible but
 * wrong galaxy is the main risk in this feature, and these are what catch it.
 */
function verify(systems) {
  const find = (name) => systems.find((s) => s.name === name);
  const near = (actual, want, tol, what) => {
    if (actual === undefined || Math.abs(actual - want) > tol) {
      throw new Error(`${what}: expected ${want}, got ${actual}`);
    }
  };

  if (systems[0]?.name !== "Sol")
    throw new Error("Sol is not the first system");
  near(Math.hypot(...(systems[0].pos ?? [])), 0, 1e-9, "Sol at the origin");

  near(find("Alpha Centauri")?.distance, 4.37, 0.05, "Alpha Centauri distance");
  near(find("Sirius")?.distance, 8.58, 0.05, "Sirius distance");
  near(find("Barnard's Star")?.distance, 5.98, 0.05, "Barnard's Star distance");
  near(find("Luhman 16")?.distance, 6.51, 0.05, "Luhman 16 distance");

  const alphaCen = find("Alpha Centauri");
  if (alphaCen?.components.length !== 3) {
    throw new Error(
      `Alpha Centauri should merge 3 components, got ${alphaCen?.components.length}`,
    );
  }
  const sirius = find("Sirius");
  if (!sirius?.components[1]?.startsWith("D")) {
    throw new Error("Sirius B should be a white dwarf component");
  }

  const within10 = systems.filter((s) => s.distance <= 10);
  const objects = within10.reduce((n, s) => n + s.components.length, 0);
  if (within10.length !== 10 || objects !== 15) {
    throw new Error(
      `within 10 ly: expected 10 systems and 15 objects, got ${within10.length} and ${objects}`,
    );
  }

  const names = new Set();
  for (const s of systems) {
    if (names.has(s.name)) throw new Error(`duplicate system name ${s.name}`);
    names.add(s.name);
  }
}

function report(systems) {
  const counts = [8, 10, 12, 14, 16, 19].map(
    (r) => `${r} ly: ${systems.filter((s) => s.distance <= r).length}`,
  );
  console.log(`Wrote ${systems.length} systems to ${OUT}`);
  console.log(`Systems by radius -> ${counts.join(", ")}`);
}

build();
