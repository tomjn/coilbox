import { describe, expect, it } from "vitest";

import {
  clampPictureSize,
  PICTURE_VIEWS,
  pictureDigest,
  pictureFingerprint,
  pictureIsStale,
  pictureNotices,
} from "./buildPicture";
import type { LegoExport, LegoProject } from "./model";
import { PICTURE_VIEW_IDS } from "./model";
import { THUMBNAIL_PIXELS } from "./thumbnail";

function project(overrides: Partial<LegoProject> = {}): LegoProject {
  return {
    schemaVersion: 1,
    id: "p",
    name: "Walker",
    unitName: "walker",
    packId: "base",
    packVersion: "1",
    createdAt: "",
    updatedAt: "",
    rootPieceId: "a",
    pieces: [
      {
        id: "a",
        name: "base",
        partId: "box",
        position: [0, 0, 0],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        parentId: null,
      },
    ],
    ...overrides,
  } as unknown as LegoProject;
}

describe("pictureFingerprint", () => {
  it("changes when a piece moves", () => {
    const moved = project();
    moved.pieces = [{ ...moved.pieces[0], position: [1, 0, 0] }];
    expect(pictureFingerprint(moved)).not.toBe(pictureFingerprint(project()));
  });

  it("ignores everything that is not how the unit looks", () => {
    const base = pictureFingerprint(project());
    const taken = project({
      notes: "hello",
      exportDir: "/game",
      picture: {
        size: 64,
        background: null,
        view: "right",
        takenAt: "now",
        fingerprint: "x",
      },
    });
    expect(pictureFingerprint(taken)).toBe(base);
  });
});

describe("pictureIsStale", () => {
  it("is not stale when no picture has been taken", () => {
    expect(pictureIsStale(project())).toBe(false);
  });

  it("is stale once the unit has changed since the picture", () => {
    const before = project();
    const taken = {
      size: 320,
      background: null,
      view: "right" as const,
      takenAt: "",
      fingerprint: pictureFingerprint(before),
    };
    expect(pictureIsStale({ ...before, picture: taken })).toBe(false);
    const after = { ...before, pieces: [] as LegoProject["pieces"] };
    expect(pictureIsStale({ ...after, picture: taken })).toBe(true);
  });
});

describe("clampPictureSize", () => {
  it("keeps a whole number of at least one pixel", () => {
    expect(clampPictureSize(64.6)).toBe(65);
    expect(clampPictureSize(0)).toBe(1);
    expect(clampPictureSize(-5)).toBe(1);
  });

  it("falls back to the thumbnail's size for something that is not a number", () => {
    expect(clampPictureSize(Number.NaN)).toBe(THUMBNAIL_PIXELS);
  });
});

describe("PICTURE_VIEWS", () => {
  it("offers every view the project can store", () => {
    expect(PICTURE_VIEWS.map((view) => view.id)).toEqual([...PICTURE_VIEW_IDS]);
  });
});

describe("pictureDigest", () => {
  const exported = (files: LegoExport["files"]): LegoExport => ({
    dir: "/games/sf",
    at: "",
    unitName: "walker",
    def: {},
    files,
  });

  it("finds the digest the builder recorded for the picture's path", () => {
    const receipt = exported([
      { path: "/games/sf/units/walker.lua", sha256: "aaa" },
      { path: "/games/sf/unitpics/walker.png", sha256: "bbb" },
    ]);
    expect(pictureDigest(receipt, "/games/sf", "walker")).toBe("bbb");
  });

  it("reads the path however the folder was spelled", () => {
    const receipt = exported([
      { path: "C:\\Games\\SF\\unitpics\\walker.png", sha256: "bbb" },
    ]);
    expect(pictureDigest(receipt, "c:/games/sf/", "walker")).toBe("bbb");
  });

  it("has no digest for a game the unit was never exported into", () => {
    const receipt = exported([
      { path: "/games/sf/unitpics/walker.png", sha256: "bbb" },
    ]);
    expect(pictureDigest(receipt, "/games/other", "walker")).toBeNull();
    expect(pictureDigest(undefined, "/games/sf", "walker")).toBeNull();
  });
});

describe("pictureNotices", () => {
  it("says nothing about a game with no pictures", () => {
    expect(pictureNotices({ pngSizes: [], otherFormats: [] }, 320)).toEqual([]);
  });

  it("says nothing when the game's pictures are the same size", () => {
    expect(
      pictureNotices(
        { pngSizes: [{ width: 64, height: 64, count: 9 }], otherFormats: [] },
        64,
      ),
    ).toEqual([]);
  });

  it("names the size most of the game's pictures have", () => {
    const [notice] = pictureNotices(
      {
        pngSizes: [
          { width: 64, height: 48, count: 9 },
          { width: 32, height: 32, count: 1 },
        ],
        otherFormats: [],
      },
      320,
    );
    expect(notice).toContain("64 by 48");
    expect(notice).toContain("320 by 320");
  });

  it("names a format other than the PNG that coilbox writes", () => {
    const [notice] = pictureNotices(
      { pngSizes: [], otherFormats: [{ extension: "dds", count: 40 }] },
      320,
    );
    expect(notice).toContain("dds");
  });
});
