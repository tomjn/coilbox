import type { Version } from "../../downloads/bindings";
import type { DownloadHistory } from "../../downloads/downloadHistory";
import type { RapidRepoVersions } from "../gameVersionRows";
import { buildLibrary, type LibraryGame } from "../library";
import { LIBRARY_GAMES_INPUT } from "./libraryGames";

const INSTALLED_MD5 = "7c02aa11bb22cc33dd44ee55ff66118a";

const { games } = buildLibrary(LIBRARY_GAMES_INPUT);
const byId = (id: string): LibraryGame => {
  const g = games.find((r) => r.id === id);
  if (!g) throw new Error(`no record for ${id}`);
  return g;
};

/**
 * Balanced Annihilation installed from rapid: the scan's archive is the pool
 * package of `ba:stable`, so that tag's row is the installed one.
 */
export const BA_GAME: LibraryGame = (() => {
  const ba = byId("ba");
  return {
    ...ba,
    installed: ba.installed.map((g) => ({
      ...g,
      primaryArchive: {
        ...g.primaryArchive,
        path: `/data/packages/${INSTALLED_MD5}.sdp`,
      },
    })),
  };
})();

/** Splinter Faction, installed from GitHub with a newer release out. */
export const SF_GAME: LibraryGame = byId("sf");

/** Metal Factions: on the hub as rapid then GitHub, and on springfiles. */
export const MF_GAME: LibraryGame = byId("mf");

const version = (
  tag: string,
  name: string,
  md5: string,
  installed = false,
): Version => ({
  tag,
  md5,
  name,
  depends: ["rapid://ba-chobby:stable"],
  kind: tag.includes(":git:") ? "snapshot" : "release",
  installed,
});

/** The `ba` rapid repo: two named tags, a version tag and three snapshots. */
export const BA_RAPID: RapidRepoVersions[] = [
  {
    repo: "ba",
    masterUrl: "https://repos.springrts.com",
    ageSecs: 180,
    versions: [
      version(
        "ba:stable",
        "Balanced Annihilation V15.9.8",
        INSTALLED_MD5,
        true,
      ),
      version(
        "ba:test",
        "Balanced Annihilation test-30922-8064a43",
        "e37b0000111122223333444455590aa",
      ),
      version(
        "ba:15.9.9",
        "Balanced Annihilation V15.9.9",
        "a91f0000111122223333444455c3e2",
      ),
      version("ba:git:111aaaa", "Balanced Annihilation git-1", "11110000"),
      version("ba:git:222bbbb", "Balanced Annihilation git-2", "22220000"),
      version("ba:git:333cccc", "Balanced Annihilation git-3", "33330000"),
    ],
  },
];

/**
 * Metal Factions' download history: rapid worked, springfiles failed and
 * GitHub has never been tried.
 */
export const MF_HISTORY: DownloadHistory = {
  "game:metal factions": {
    "rapid|": {
      source: "rapid",
      outcome: "ok",
      reference: "mf:stable",
      filename: null,
      md5: null,
      mirror: null,
      failure: null,
      durationMs: 130_000,
      at: "2026-10-02T10:00:00.000Z",
    },
    "springfiles|one.example": {
      source: "springfiles",
      outcome: "failed",
      reference: "Metal Factions V1.4",
      filename: "mf-v1.4.sdz",
      md5: null,
      mirror: "one.example",
      failure: "one.example has no such file",
      durationMs: 900,
      at: "2026-09-28T10:00:00.000Z",
    },
  },
};
