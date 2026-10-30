import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, describe, expect, it } from "vitest";

const RULE = fileURLToPath(
  new URL("./compat-proof-errors.awk", import.meta.url),
);
const dir = mkdtempSync(join(tmpdir(), "compat-proof-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** The lines the proof counts as errors in a log made of these lines. */
function errorLines(lines) {
  const log = join(dir, "infolog.txt");
  writeFileSync(log, `${lines.join("\n")}\n`);
  const out = execFileSync("awk", ["-f", RULE, log], { encoding: "utf8" });
  return out.split("\n").filter(Boolean);
}

describe("compat-proof error rule", () => {
  it("counts a widget that fails to load", () => {
    const line = "[t=00:00:09.1][f=0000001] Failed to load: bloomshader.lua";
    expect(errorLines([line])).toEqual([line]);
  });

  it("counts a Failed to load line behind a log tag", () => {
    const line =
      "[t=00:00:09.1][f=-000001] [LuaUI] Failed to load: gui_thing.lua";
    expect(errorLines([line])).toEqual([line]);
  });

  it("counts an Error line and a LuaUI line that says error", () => {
    const lines = [
      "[t=00:00:01.0][f=0000001] Error: something broke",
      "[t=00:00:01.0][f=0000001] LuaUI: widget has an error in it",
    ];
    expect(errorLines(lines)).toEqual(lines);
  });

  it("skips warnings and ordinary lines", () => {
    expect(
      errorLines([
        "[t=00:00:01.0][f=0000001] Warning: Failed to load: something.lua",
        "[t=00:00:01.0][f=0000001] Loaded widget gui_thing.lua",
      ]),
    ).toEqual([]);
  });
});
