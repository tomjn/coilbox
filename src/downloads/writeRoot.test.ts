import { describe, expect, it } from "vitest";
import {
  healWriteRoot,
  packageDirOf,
  type WriteRootCandidate,
} from "./writeRoot";

describe("packageDirOf", () => {
  it("strips the trailing .coilbox segment (both separators)", () => {
    expect(packageDirOf("E:\\Coilbox-test\\.coilbox")).toBe("E:\\Coilbox-test");
    expect(packageDirOf("/opt/game/.coilbox")).toBe("/opt/game");
    expect(packageDirOf("/opt/game/.coilbox/")).toBe("/opt/game");
  });

  it("returns null when not portable (empty root)", () => {
    expect(packageDirOf("")).toBeNull();
  });
});

describe("healWriteRoot", () => {
  const pkg = "E:\\Coilbox-test";
  const inside: WriteRootCandidate = {
    id: "in",
    path: "E:\\Coilbox-test",
    portable: true,
  };
  const insideSub: WriteRootCandidate = {
    id: "sub",
    path: "E:\\Coilbox-test\\data",
    portable: false,
  };
  const outside: WriteRootCandidate = {
    id: "out",
    path: "E:\\Coilbox-master",
    portable: true,
  };

  it("keeps the user's choice when not portable", () => {
    expect(healWriteRoot([outside], "out", null)).toBe(outside);
  });

  it("keeps a configured root that is inside the package", () => {
    expect(healWriteRoot([inside, insideSub], "sub", pkg)).toBe(insideSub);
  });

  it("heals a configured root that points outside the package", () => {
    // The regression: a stale absolute root copied in from E:\\Coilbox-master.
    expect(healWriteRoot([outside, inside], "out", pkg)).toBe(inside);
  });

  it("prefers a portable in-package root over a non-portable one", () => {
    expect(healWriteRoot([insideSub, inside], "out", pkg)).toBe(inside);
  });

  it("heals a dangling write-root id to an in-package root", () => {
    expect(healWriteRoot([inside], "gone", pkg)).toBe(inside);
  });

  it("leaves the external root when no in-package root exists", () => {
    // Nothing to heal to — return the configured root rather than nothing.
    expect(healWriteRoot([outside], "out", pkg)).toBe(outside);
  });

  it("is undefined when no root is configured and none is in-package", () => {
    expect(healWriteRoot([outside], undefined, pkg)).toBeUndefined();
  });
});
