import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HIDEABLE_NAV_IDS } from "./hidden";

/**
 * `HIDEABLE_NAV_IDS`'s doc comment asks a human to keep it in sync with every
 * `isProfileHidden(...)` call site, which is exactly the kind of rule a human
 * forgets. #2481 found `multiplayer.battles` gated in code but missing from
 * the list, so the health check flagged a working profile as broken. This
 * scans the real call sites instead of trusting the comment.
 *
 * There's no importable registry of hideable ids to check against (hiding is
 * opt-in per call site, not centrally registered), so this reads source text
 * the same way `metricRegistry.test.ts` does for the metric registry.
 */

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = join(REPO, "src");

/** The file that defines `isProfileHidden`/`gateProfileHidden`, not a call site. */
const DEFINITION_FILE = "src/profile/hidden.tsx";

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry.name)) found.push(full);
  }
  return found;
}

/**
 * Every id passed as a string literal to `isProfileHidden(...)` or
 * `gateProfileHidden(...)` anywhere under `src`, excluding the definition
 * file itself.
 */
function hideCallSiteIds(): Set<string> {
  const ids = new Set<string>();
  for (const file of sourceFiles(SRC)) {
    const rel = relative(REPO, file).split("\\").join("/");
    if (rel === DEFINITION_FILE) continue;
    const source = readFileSync(file, "utf8");
    for (const m of source.matchAll(
      /\b(?:isProfileHidden|gateProfileHidden)\(\s*"([^"]+)"/g,
    )) {
      ids.add(m[1]);
    }
  }
  return ids;
}

describe("HIDEABLE_NAV_IDS", () => {
  it("found call sites to check against", () => {
    // A guard on the extraction itself: a scan that stopped finding call
    // sites would otherwise pass this suite by finding nothing to compare.
    expect(hideCallSiteIds().size).toBeGreaterThan(5);
  });

  it("matches every isProfileHidden/gateProfileHidden call site exactly", () => {
    const callSiteIds = hideCallSiteIds();
    const listedIds = new Set(HIDEABLE_NAV_IDS);

    const missingFromList = [...callSiteIds].filter((id) => !listedIds.has(id));
    const deadInList = [...listedIds].filter((id) => !callSiteIds.has(id));

    expect(
      missingFromList,
      "gated in code but missing from HIDEABLE_NAV_IDS",
    ).toEqual([]);
    expect(
      deadInList,
      "listed in HIDEABLE_NAV_IDS but nothing gates on it",
    ).toEqual([]);
  });
});
