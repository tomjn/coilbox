import { describe, expect, it } from "vitest";

import {
  engineConfigDir,
  underConfigDir,
  underEngineConfig,
} from "./enginePaths";

describe("engineConfigDir", () => {
  it("takes the directory off the path unitsync reports", () => {
    expect(engineConfigDir("/home/a/.spring/springsettings.cfg")).toBe(
      "/home/a/.spring",
    );
  });

  it("reads a Windows path the Windows way", () => {
    expect(
      engineConfigDir("C:\\Users\\a\\Documents\\Beyond All Reason\\cfg.cfg"),
    ).toBe("C:\\Users\\a\\Documents\\Beyond All Reason");
  });

  /** Every caller falls back to something else, so answering with a guess would
   *  be worse than answering with nothing. */
  it("answers nothing when there is no path, or no directory in it", () => {
    expect(engineConfigDir(undefined)).toBeUndefined();
    expect(engineConfigDir("")).toBeUndefined();
    expect(engineConfigDir("springsettings.cfg")).toBeUndefined();
  });
});

describe("underConfigDir", () => {
  it("names a file under the directory", () => {
    expect(
      underConfigDir("/home/a/.spring", "LuaUI/Config/blueprints.json"),
    ).toBe("/home/a/.spring/LuaUI/Config/blueprints.json");
  });

  it("writes a Windows path with Windows separators", () => {
    expect(
      underConfigDir("C:\\Users\\a\\BAR", "LuaUI/Config/blueprints.json"),
    ).toBe("C:\\Users\\a\\BAR\\LuaUI\\Config\\blueprints.json");
  });

  it("does not double a separator the directory already ends with", () => {
    expect(underConfigDir("/home/a/.spring/", "LuaUI/Config")).toBe(
      "/home/a/.spring/LuaUI/Config",
    );
  });
});

/** Every "true" here is a refusal, so the tests worth reading are the ones that
 *  say a path cannot be told apart rather than the ones that say it is inside.
 *  (issue #1488) */
describe("underEngineConfig", () => {
  const DIR = "/home/a/.spring";

  it("says a file inside the directory is one the engine writes", () => {
    expect(underEngineConfig(DIR, `${DIR}/LuaUI/Config/blueprints.json`)).toBe(
      true,
    );
    expect(underEngineConfig(DIR, DIR)).toBe(true);
  });

  it("says a file somewhere else is not", () => {
    expect(underEngineConfig(DIR, "/home/a/Downloads/blueprints.json")).toBe(
      false,
    );
  });

  /** `/home/a/.springfiles` is not inside `/home/a/.spring`, and a prefix match
   *  that forgot the separator would say it was. */
  it("does not take a longer name beginning the same way as inside it", () => {
    expect(underEngineConfig(DIR, "/home/a/.springfiles/blueprints.json")).toBe(
      false,
    );
  });

  it("compares a Windows path either way round and either case", () => {
    const dir = "C:\\Users\\A\\Documents\\Beyond All Reason";
    expect(
      underEngineConfig(dir, "c:/users/a/documents/beyond all reason/x.json"),
    ).toBe(true);
    expect(underEngineConfig(dir, "C:\\Users\\A\\Downloads\\x.json")).toBe(
      false,
    );
  });

  it("ignores a separator the directory ends with", () => {
    expect(underEngineConfig(`${DIR}/`, `${DIR}/x.json`)).toBe(true);
  });

  /** Text cannot compare a path that says nothing about where it starts from,
   *  so it says it cannot tell rather than saying it is elsewhere. */
  it("cannot tell about a relative path either side", () => {
    expect(underEngineConfig(DIR, "blueprints.json")).toBe(true);
    expect(underEngineConfig(".spring", `${DIR}/x.json`)).toBe(true);
  });

  it("cannot tell without a directory to compare against", () => {
    expect(underEngineConfig(undefined, "/home/a/Downloads/x.json")).toBe(true);
  });
});
