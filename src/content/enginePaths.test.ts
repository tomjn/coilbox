import { describe, expect, it } from "vitest";

import { engineConfigDir, underConfigDir } from "./enginePaths";

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
