import { describe, expect, it } from "vitest";
import type { ArchiveFileEntry } from "../../../content/bindings";
import {
  archiveFileExt,
  archiveMediaKey,
  filterArchiveFilesByType,
  needsDuplicateConfirm,
  searchArchiveFiles,
} from "./archiveMedia";

function entry(path: string, size = 100): ArchiveFileEntry {
  return { path, size };
}

describe("archiveFileExt", () => {
  it("lowercases the extension of the last path segment", () => {
    expect(archiveFileExt("bitmaps/Loadscreens/BAR.PNG")).toBe("png");
  });

  it("returns empty for a path with no extension", () => {
    expect(archiveFileExt("gamedata/README")).toBe("");
  });

  it("ignores a dot in an earlier path segment", () => {
    expect(archiveFileExt("v1.2/sounds/voice.ogg")).toBe("ogg");
  });

  it("does not treat a leading dotfile as an extension", () => {
    expect(archiveFileExt(".gitignore")).toBe("");
  });
});

describe("filterArchiveFilesByType", () => {
  const files = [
    entry("unitpics/commander.png"),
    entry("sounds/voice.ogg"),
    entry("sounds/explosion.wav"),
    entry("gamedata/defs.lua"),
    entry("bitmaps/loading.jpg"),
    entry("videos/intro.mp4"),
    entry("videos/outro.webm"),
  ];

  it("keeps only image extensions for the image type", () => {
    expect(filterArchiveFilesByType(files, "image").map((f) => f.path)).toEqual(
      ["unitpics/commander.png", "bitmaps/loading.jpg"],
    );
  });

  it("keeps only audio extensions for the audio type", () => {
    expect(filterArchiveFilesByType(files, "audio").map((f) => f.path)).toEqual(
      ["sounds/voice.ogg", "sounds/explosion.wav"],
    );
  });

  it("keeps only video extensions for the video type", () => {
    expect(filterArchiveFilesByType(files, "video").map((f) => f.path)).toEqual(
      ["videos/intro.mp4", "videos/outro.webm"],
    );
  });

  it("returns an empty list when nothing matches", () => {
    expect(
      filterArchiveFilesByType([entry("gamedata/defs.lua")], "image"),
    ).toEqual([]);
    expect(
      filterArchiveFilesByType([entry("gamedata/defs.lua")], "video"),
    ).toEqual([]);
  });
});

describe("searchArchiveFiles", () => {
  const files = [entry("unitpics/commander.png"), entry("sounds/voice.ogg")];

  it("returns everything for an empty or whitespace query", () => {
    expect(searchArchiveFiles(files, "")).toEqual(files);
    expect(searchArchiveFiles(files, "   ")).toEqual(files);
  });

  it("matches case-insensitively anywhere in the path", () => {
    expect(searchArchiveFiles(files, "COMMANDER").map((f) => f.path)).toEqual([
      "unitpics/commander.png",
    ]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(searchArchiveFiles(files, "nope")).toEqual([]);
  });
});

describe("needsDuplicateConfirm", () => {
  const key = archiveMediaKey("Game 1.0", "unitpics/commander.png");

  it("is false for a file never imported this session", () => {
    expect(needsDuplicateConfirm(new Set(), "Game 1.0", "x.png", null)).toBe(
      false,
    );
  });

  it("is true once the same archive+file was already imported", () => {
    const imported = new Set([key]);
    expect(
      needsDuplicateConfirm(
        imported,
        "Game 1.0",
        "unitpics/commander.png",
        null,
      ),
    ).toBe(true);
  });

  it("is false again once that exact key has been confirmed", () => {
    const imported = new Set([key]);
    expect(
      needsDuplicateConfirm(
        imported,
        "Game 1.0",
        "unitpics/commander.png",
        key,
      ),
    ).toBe(false);
  });

  it("does not carry a confirm across a different file", () => {
    const imported = new Set([key]);
    expect(
      needsDuplicateConfirm(imported, "Game 1.0", "unitpics/other.png", key),
    ).toBe(false);
  });
});
