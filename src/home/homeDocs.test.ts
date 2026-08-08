import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The `@`-reference parser imports defineCommand from @picoframe/plugin-sdk for
// its file-read binding, and that published dist will not load under Vitest's
// node resolver. Nothing here goes through the Rust command, so stub the leaf
// (same shim as background.test.ts and profileArt.test.ts).
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => async () => ({}),
}));

import { resolveHomeBackground } from "./background";
import { DEFAULT_ZONES, resolveHome } from "./config";
import { homeMarkup, loadHomeMarkup } from "./markup";
import { resolveCardArtOverrides } from "./profileArt";

/**
 * What `docs/distribution-profile.md` tells a distribution author about the
 * `home` key has to stay true.
 *
 * Two things are checked, and both are documentation rather than code:
 *
 * 1. The worked example in `docs/examples/branded-home`. An author is told to
 *    copy that folder and edit it, so an example that no longer parses, or that
 *    names a file nobody shipped, is worse than no example: it fails on their
 *    machine rather than on ours.
 * 2. Every JSON sample in the `home` section of the documentation. A sample that
 *    warns is a sample that teaches the wrong spelling.
 *
 * Both resolve real text through the real schema, so the documentation rots
 * loudly instead of silently.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXAMPLE = join(REPO, "docs", "examples", "branded-home", ".coilbox");

/** The example distribution's profile, as Coilbox would read it. */
function exampleProfile(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(EXAMPLE, "profile.json"), "utf8"));
}

/** Every `@.coilbox/<path>` reference anywhere in the profile, deduplicated. */
function fileRefs(value: unknown, found = new Set<string>()): Set<string> {
  if (typeof value === "string" && value.startsWith("@.coilbox/"))
    found.add(value);
  else if (Array.isArray(value)) for (const v of value) fileRefs(v, found);
  else if (typeof value === "object" && value !== null)
    for (const v of Object.values(value)) fileRefs(v, found);
  return found;
}

/** A reader over the example folder, standing in for the Rust command. */
async function readExampleFile(path: string) {
  const full = join(EXAMPLE, path);
  return existsSync(full)
    ? { text: readFileSync(full, "utf8"), ok: true }
    : { text: "", ok: false };
}

// A warning is how a bad profile reports itself, so a clean example must produce
// none. Spied rather than silenced so the assertion can name what was warned.
let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  warn.mockRestore();
});

describe("the worked example distribution", () => {
  it("parses as JSON and declares the schema version", () => {
    expect(exampleProfile().version).toBe(1);
  });

  it("resolves to the page the documentation describes, with no warning", () => {
    const { layout, entries } = resolveHome(exampleProfile().home);
    expect(layout).toBe("stacked");
    expect(
      entries.map((e) => (e.kind === "zone" ? e.zone : "html")),
    ).toStrictEqual([
      "onboarding",
      "greeting",
      "continue",
      "resume",
      "cards",
      "suggested",
      "html",
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("lists every built-in zone, so the example hides nothing by accident", () => {
    const { entries } = resolveHome(exampleProfile().home);
    const zones = entries.flatMap((e) => (e.kind === "zone" ? [e.zone] : []));
    expect([...zones].sort()).toStrictEqual([...DEFAULT_ZONES].sort());
  });

  it("paints its own backdrop", () => {
    const home = exampleProfile().home as { background: unknown };
    expect(resolveHomeBackground(home.background)).toStrictEqual({
      kind: "image",
      url: expect.stringContaining("art/backdrop.svg"),
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("overrides one tool's art and takes it away from another", () => {
    const { entries } = resolveHome(exampleProfile().home);
    const overrides = resolveCardArtOverrides(entries);
    expect(overrides.get("runlite.list")).toContain("art/warpath.svg");
    expect(overrides.get("play.replays")).toBe(false);
    expect(warn).not.toHaveBeenCalled();
  });

  it("names only tool ids the routes reference documents", () => {
    const routes = readFileSync(join(REPO, "docs", "routes.md"), "utf8");
    const { entries } = resolveHome(exampleProfile().home);
    const ids = [...resolveCardArtOverrides(entries).keys()];
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(routes).toContain(`\`${id}\``);
  });

  it("ships every file it references", async () => {
    const refs = [...fileRefs(exampleProfile())];
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const { ok } = await readExampleFile(ref.slice("@.coilbox/".length));
      expect(ok, `${ref} is missing from the example`).toBe(true);
    }
  });

  it("is the example the documentation prints", () => {
    const doc = readFileSync(
      join(REPO, "docs", "distribution-profile.md"),
      "utf8",
    );
    const shipped = readFileSync(join(EXAMPLE, "profile.json"), "utf8").trim();
    expect(doc).toContain(shipped);
  });

  it("resolves its markup, inline and by reference alike", async () => {
    const profile = exampleProfile();
    await loadHomeMarkup(profile.home, readExampleFile);
    const { entries } = resolveHome(profile.home);

    const custom = entries.find((e) => e.kind === "html");
    expect(custom).toBeDefined();
    // A reference, resolved from the file the example ships.
    expect(
      homeMarkup(custom?.kind === "html" ? custom.html : ""),
    ).toStrictEqual({ html: expect.stringContaining("data-coilbox-action") });

    // Inline markup on a zone, which is its own answer and reads no file.
    const greeting = entries.find(
      (e) => e.kind === "zone" && e.zone === "greeting",
    );
    const before = greeting?.entry.before;
    expect(typeof before).toBe("string");
    expect(homeMarkup(before as string)).toStrictEqual({ html: before });
  });
});

/**
 * Every fenced JSON block in the `home` section of the documentation, as
 * written. A sample is either a whole profile, a bare `home` object, or a single
 * zone entry, and all three are shown, so each is resolved as what it is.
 */
function docSamples(): { block: string; home: unknown }[] {
  const doc = readFileSync(
    join(REPO, "docs", "distribution-profile.md"),
    "utf8",
  );
  const start = doc.indexOf("### `home` (object)");
  const end = doc.indexOf("### `links` (object[])", start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const section = doc.slice(start, end);
  return [...section.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => {
    const block = m[1];
    const parsed = JSON.parse(block) as Record<string, unknown>;
    if ("zone" in parsed) return { block, home: { zones: [parsed] } };
    return { block, home: parsed.home ?? parsed };
  });
}

describe("the JSON samples in the home documentation", () => {
  it("all parse and resolve without a warning", () => {
    const samples = docSamples();
    // A guard on the extraction itself: a regex that stopped matching would
    // otherwise pass this suite by finding nothing to check.
    expect(samples.length).toBeGreaterThanOrEqual(5);
    for (const { block, home } of samples) {
      const { background, entries } = resolveHome(home);
      expect(entries.length, block).toBeGreaterThan(0);
      resolveHomeBackground(background);
      resolveCardArtOverrides(entries);
      expect(warn.mock.calls, block).toStrictEqual([]);
    }
  });

  it("shows a zone list whose ids are all real zones", () => {
    for (const { block, home } of docSamples()) {
      const listed = (home as { zones?: { zone?: string }[] }).zones ?? [];
      for (const entry of listed) {
        if (entry.zone === undefined) continue;
        expect(DEFAULT_ZONES, block).toContain(entry.zone);
      }
    }
  });
});
