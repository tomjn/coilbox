import { describe, expect, it } from "vitest";
import type { CustomParamsResult } from "@/content/bindings";
import { consumerNote, customParamKey } from "./customParamConsumers";

const scan = (
  params: CustomParamsResult["params"],
  rest: Partial<CustomParamsResult> = {},
): CustomParamsResult => ({
  params,
  wholeTableFiles: 0,
  filesScanned: 100,
  truncated: false,
  errors: [],
  ...rest,
});

const site = (file: string, reads = 1, writes = 0) => ({ file, reads, writes });

describe("customParamKey", () => {
  it("takes the key out of a custom parameter path", () => {
    expect(customParamKey("customParams.techlevel")).toBe("techlevel");
  });

  /// The scan is keyed lowercase because that is how the engine hands
  /// `customParams` to Lua and how the def table arrives, so the lookup has to
  /// be too.
  it("lowercases, so a game's own spelling still finds the scan", () => {
    expect(customParamKey("customparams.techLevel")).toBe("techlevel");
  });

  it("answers for a weapon's parameters the same way", () => {
    expect(customParamKey("weapons.0.customParams.speceffect")).toBe(
      "speceffect",
    );
  });

  it("is not a custom parameter path", () => {
    expect(customParamKey("health")).toBeNull();
    expect(customParamKey("customParams")).toBeNull();
  });
});

describe("consumerNote", () => {
  it("says nothing about a field that is not a custom parameter", () => {
    expect(consumerNote("health", scan({}))).toBeNull();
  });

  /// The page never waits on the scan, so a row before it lands has no note
  /// rather than a placeholder saying nothing was found.
  it("says nothing while there is no scan to say it from", () => {
    expect(consumerNote("customParams.techlevel", null)).toBeNull();
  });

  it("names the one file that reads a parameter", () => {
    const note = consumerNote(
      "customParams.canareaattack",
      scan({
        canareaattack: {
          sites: [site("luarules/gadgets/unit_areaattack.lua")],
          files: 1,
        },
      }),
    );
    expect(note).toEqual({
      text: "Read by",
      files: ["luarules/gadgets/unit_areaattack.lua"],
    });
  });

  /// A parameter a game's own def post-processing writes onto units is a
  /// different fact from one a gadget acts on, and "read by" would be wrong.
  it("says a file sets a parameter rather than reads it", () => {
    const note = consumerNote(
      "customParams.techlevel",
      scan({
        techlevel: {
          sites: [site("unitbasedefs/techsplit_defs.lua", 0, 4)],
          files: 1,
        },
      }),
    );
    expect(note?.text).toBe("Set by");
  });

  it("lists a handful of files", () => {
    const note = consumerNote(
      "customParams.isairbase",
      scan({
        isairbase: {
          sites: [site("a.lua"), site("b.lua"), site("c.lua")],
          files: 3,
        },
      }),
    );
    expect(note?.files).toEqual(["a.lua", "b.lua", "c.lua"]);
  });

  /// The rule the issue asked for: a parameter read in twelve places has no
  /// answer, and printing twelve paths under a form row says less than the
  /// count does.
  it("gives the count rather than a list once there are too many", () => {
    const note = consumerNote(
      "customParams.iscommander",
      scan({
        iscommander: {
          sites: [site("a.lua"), site("b.lua"), site("c.lua"), site("d.lua")],
          files: 16,
        },
      }),
    );
    expect(note?.files).toEqual([]);
    expect(note?.text).toContain("16");
    expect(note?.text).toContain("no one of them is the answer");
  });

  /// Nothing naming the key is not the same as nothing using it. The scan
  /// cannot follow the table into a function, so the count of files that take
  /// it whole is the honest part of the answer.
  it("counts the files that read the table whole when nothing names the key", () => {
    const note = consumerNote(
      "customParams.mystery",
      scan({}, { wholeTableFiles: 88 }),
    );
    expect(note?.text).toBe(
      "No file in this game names this parameter. 88 files read the whole customParams table, so a gadget may still use it without naming it.",
    );
    expect(note?.files).toEqual([]);
  });

  it("says so plainly when nothing reads the table either", () => {
    const note = consumerNote("customParams.mystery", scan({}));
    expect(note?.text).toBe("No file in this game names this parameter.");
  });

  /// An absent answer after a truncated scan is a fact about the scan, not
  /// about the game, and saying otherwise would be a lie the reader acts on.
  it("admits when the scan did not finish", () => {
    const note = consumerNote(
      "customParams.mystery",
      scan({}, { truncated: true }),
    );
    expect(note?.text).toContain(
      "The scan stopped before it had read the whole archive.",
    );
  });
});
