import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The replay list used to keep a private mm:ss / h:mm:ss formatter, a third
 * copy of the one in matchStats / debrief. Read as source because the page
 * needs a router and a Tauri backend to mount. #2467.
 */

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "ReplaysPage.tsx"),
  "utf8",
);

describe("ReplaysPage duration formatting", () => {
  it("does not declare its own formatDuration", () => {
    expect(SOURCE).not.toMatch(/^function formatDuration\(/m);
  });

  it("imports formatDuration from matchStats", () => {
    expect(SOURCE).toMatch(
      /import \{[^}]*\bformatDuration\b[^}]*\} from ["']\.\.\/matchStats["']/,
    );
  });
});
