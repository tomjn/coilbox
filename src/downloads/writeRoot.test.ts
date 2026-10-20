import { describe, expect, it } from "vitest";
import {
  backfillWriteRootId,
  healWriteRoot,
  mutatorDataDir,
  packageDirOf,
  pickWriteRoot,
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

  it("never picks the bundled content folder, even when it is configured", () => {
    // Inside the package and portable, so it passes every other test here.
    const bundle: WriteRootCandidate = {
      id: "bundle",
      path: "E:\\Coilbox-test\\.coilbox\\content",
      portable: true,
      bundled: true,
    };
    expect(healWriteRoot([bundle, inside], "bundle", pkg)).toBe(inside);
    expect(healWriteRoot([bundle, insideSub], undefined, pkg)).toBe(insideSub);
    expect(healWriteRoot([bundle], "bundle", null)).toBeUndefined();
  });

  it("never picks a read only folder, even when it is configured", () => {
    const steam: WriteRootCandidate = {
      id: "steam",
      path: "E:\\Coilbox-test\\Zero-K",
      portable: true,
      readOnly: true,
    };
    expect(healWriteRoot([steam, inside], "steam", pkg)).toBe(inside);
    expect(healWriteRoot([steam, insideSub], undefined, pkg)).toBe(insideSub);
    expect(healWriteRoot([steam], "steam", null)).toBeUndefined();
  });
});

describe("pickWriteRoot", () => {
  const a: WriteRootCandidate = { id: "a", path: "/data/a", portable: false };
  const b: WriteRootCandidate = { id: "b", path: "/data/b", portable: false };
  const c: WriteRootCandidate = { id: "c", path: "/data/c", portable: false };
  const roots = [a, b, c];

  it("answers the default when no kind is asked for", () => {
    const ids = { writeRootId: "a", gamesRootId: "b", mapsRootId: "c" };
    expect(pickWriteRoot(roots, ids, undefined, null)).toBe(a);
  });

  it("answers each kind's own folder when one is set", () => {
    const ids = { writeRootId: "a", gamesRootId: "b", mapsRootId: "c" };
    expect(pickWriteRoot(roots, ids, "games", null)).toBe(b);
    expect(pickWriteRoot(roots, ids, "maps", null)).toBe(c);
  });

  it("follows the default for a kind with no folder of its own", () => {
    const ids = { writeRootId: "a", mapsRootId: "c" };
    expect(pickWriteRoot(roots, ids, "games", null)).toBe(a);
    expect(pickWriteRoot(roots, { writeRootId: "b" }, "maps", null)).toBe(b);
  });

  it("falls back to the default when a kind's folder is gone", () => {
    const ids = { writeRootId: "a", gamesRootId: "removed" };
    expect(pickWriteRoot(roots, ids, "games", null)).toBe(a);
  });

  it("never answers the bundled content folder for a kind", () => {
    const bundle: WriteRootCandidate = {
      id: "bundle",
      path: "/data/bundle",
      portable: false,
      bundled: true,
    };
    const ids = { writeRootId: "a", mapsRootId: "bundle" };
    expect(pickWriteRoot([a, bundle], ids, "maps", null)).toBe(a);
  });

  it("never answers a read only folder for a kind", () => {
    const steam: WriteRootCandidate = {
      id: "steam",
      path: "/data/steam",
      portable: false,
      readOnly: true,
    };
    const ids = { writeRootId: "a", gamesRootId: "steam" };
    expect(pickWriteRoot([a, steam], ids, "games", null)).toBe(a);
    expect(
      pickWriteRoot([steam, a], { writeRootId: "steam" }, undefined, null),
    ).toBeUndefined();
  });

  it("keeps a portable install's kind folders inside the package", () => {
    const pkg = "/opt/game";
    const inside: WriteRootCandidate = {
      id: "in",
      path: "/opt/game",
      portable: true,
    };
    const insideSub: WriteRootCandidate = {
      id: "sub",
      path: "/opt/game/extra",
      portable: false,
    };
    const outside: WriteRootCandidate = {
      id: "out",
      path: "/home/me/spring",
      portable: false,
    };
    const all = [inside, insideSub, outside];
    expect(
      pickWriteRoot(all, { writeRootId: "in", mapsRootId: "out" }, "maps", pkg),
    ).toBe(inside);
    expect(
      pickWriteRoot(all, { writeRootId: "in", mapsRootId: "sub" }, "maps", pkg),
    ).toBe(insideSub);
  });

  it("is undefined when there is no default and no folder for the kind", () => {
    expect(pickWriteRoot(roots, {}, "games", null)).toBeUndefined();
  });
});

describe("mutatorDataDir", () => {
  const own: WriteRootCandidate = {
    id: "own",
    path: "/data/own",
    portable: false,
  };
  const steam: WriteRootCandidate = {
    id: "steam",
    path: "/steam/Zero-K",
    portable: false,
    readOnly: true,
  };

  it("keeps the engine's folder when coilbox may write into it", () => {
    expect(mutatorDataDir([own, steam], "/data/own", "/data/other")).toBe(
      "/data/own",
    );
  });

  it("moves to the default write folder when the engine's folder is read only", () => {
    expect(mutatorDataDir([own, steam], "/steam/Zero-K/", "/data/own")).toBe(
      "/data/own",
    );
  });

  it("leaves the folder alone with nowhere to fall back to, so the write is refused", () => {
    expect(mutatorDataDir([steam], "/steam/Zero-K", undefined)).toBe(
      "/steam/Zero-K",
    );
  });
});

describe("backfillWriteRootId", () => {
  const own: WriteRootCandidate = {
    id: "own",
    path: "/data/own",
    portable: false,
  };
  const steam: WriteRootCandidate = {
    id: "steam",
    path: "/steam/Zero-K",
    portable: false,
    readOnly: true,
  };

  it("picks the first writable folder when none is set", () => {
    expect(backfillWriteRootId([steam, own], undefined)).toBe("own");
  });

  it("moves off a folder that has become read only", () => {
    expect(backfillWriteRootId([steam, own], "steam")).toBe("own");
  });

  it("leaves a writable choice alone", () => {
    expect(backfillWriteRootId([steam, own], "own")).toBeUndefined();
  });

  it("keeps a choice whose folder is not listed, such as an unplugged drive", () => {
    expect(backfillWriteRootId([own], "usb")).toBeUndefined();
  });

  it("has nothing to pick when every folder is read only", () => {
    expect(backfillWriteRootId([steam], "steam")).toBeUndefined();
  });
});
