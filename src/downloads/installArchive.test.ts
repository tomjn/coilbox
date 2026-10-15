import { describe, expect, it, vi } from "vitest";
import {
  type ArchiveOffer,
  describeOffers,
  installArchives,
  isArchivePath,
  pathFromFileUrl,
  planArchives,
} from "./installArchive";

const game: ArchiveOffer = {
  path: "/dl/SplinterFaction_0.1.89.sdz",
  kind: "game",
  fileName: "SplinterFaction_0.1.89.sdz",
  destDir: "/spring/games",
};
const map: ArchiveOffer = {
  path: "/dl/comet.sd7",
  kind: "map",
  fileName: "comet.sd7",
  destDir: "/spring/maps",
};

describe("isArchivePath", () => {
  it("takes the two packaged kinds, whatever their case", () => {
    expect(isArchivePath("/a/Game.sdz")).toBe(true);
    expect(isArchivePath("C:\\a\\Map.SD7")).toBe(true);
  });

  it("leaves out a folder archive and everything else", () => {
    expect(isArchivePath("/a/Game.sdd")).toBe(false);
    expect(isArchivePath("/a/Game.sdz.part")).toBe(false);
    expect(isArchivePath("/a/notes.txt")).toBe(false);
  });
});

describe("pathFromFileUrl", () => {
  it("reads the path out of a file URL, with its spaces", () => {
    expect(pathFromFileUrl("file:///Users/me/Downloads/Some%20Game.sdz")).toBe(
      "/Users/me/Downloads/Some Game.sdz",
    );
  });

  it("drops the slash before a Windows drive", () => {
    expect(pathFromFileUrl("file:///C:/Games/a.sd7")).toBe("C:/Games/a.sd7");
  });

  it("is null for a link and for text that is not a URL", () => {
    expect(pathFromFileUrl("coilbox://open?screen=maps")).toBeNull();
    expect(pathFromFileUrl("https://example.com/a.sdz")).toBeNull();
    expect(pathFromFileUrl("not a url")).toBeNull();
  });
});

describe("planArchives", () => {
  it("sorts what can be installed from what is refused, with the reason", async () => {
    const inspect = vi.fn(async ({ path }: { path: string }) => {
      if (path === game.path) {
        return {
          kind: game.kind,
          fileName: game.fileName,
          destDir: game.destDir,
        };
      }
      throw new Error("notes.sdz is neither a game nor a map.");
    });
    const plan = await planArchives(
      [game.path, "/dl/notes.sdz", "/dl/picture.png"],
      { gamesRoot: "/spring", mapsRoot: "/spring" },
      inspect,
    );
    expect(plan.offers).toEqual([game]);
    expect(plan.refused).toEqual([
      "notes.sdz is neither a game nor a map.",
      "picture.png is not a .sdz or .sd7 archive.",
    ]);
    expect(inspect).toHaveBeenCalledWith({
      path: game.path,
      gamesRoot: "/spring",
      mapsRoot: "/spring",
    });
  });

  it("never asks the Rust side to open a file that is not an archive", async () => {
    const inspect = vi.fn();
    await planArchives(["/dl/picture.png"], {}, inspect);
    expect(inspect).not.toHaveBeenCalled();
  });

  it("reads a file named twice once", async () => {
    const inspect = vi.fn(async () => ({
      kind: game.kind,
      fileName: game.fileName,
      destDir: game.destDir,
    }));
    const plan = await planArchives([game.path, game.path], {}, inspect);
    expect(plan.offers).toHaveLength(1);
  });
});

describe("describeOffers", () => {
  it("names the kind, the file and the folder for one archive", () => {
    expect(describeOffers([game])).toEqual({
      title: "Install a game",
      lines: [
        "Install the game SplinterFaction_0.1.89.sdz?",
        "It is copied to /spring/games. The file you opened stays where it is.",
      ],
    });
  });

  it("lists every archive when there are several", () => {
    expect(describeOffers([game, map])).toEqual({
      title: "Install 2 archives",
      lines: [
        "SplinterFaction_0.1.89.sdz, a game, is copied to /spring/games.",
        "comet.sd7, a map, is copied to /spring/maps.",
        "The files you opened stay where they are.",
      ],
    });
  });
});

describe("installArchives", () => {
  it("carries on past one that fails and reports both", async () => {
    const install = vi.fn(async ({ path }: { path: string }) => {
      if (path === game.path) throw new Error("Could not write it.");
    });
    const result = await installArchives(
      [game, map],
      { gamesRoot: "/spring", mapsRoot: "/spring" },
      install,
    );
    expect(result.installed).toEqual([map]);
    expect(result.failed).toEqual(["Could not write it."]);
  });
});
