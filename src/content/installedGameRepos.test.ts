import { describe, expect, it } from "vitest";
import type { HubGame } from "../hub/api";
import type { GameItem } from "./bindings";
import { installedGameRepos } from "./useUpdates";

const game = (name: string, shortname: string, version: string) =>
  ({ name, info: { shortname, version } }) as unknown as GameItem;

const hubGame = (shortname: string, repo: string | null): HubGame => ({
  shortname,
  title: shortname,
  description: null,
  featured: false,
  downloads: repo ? [{ kind: "github", value: repo }] : [],
  logo: null,
  card: null,
  faction_count: 0,
  unit_count: 0,
  item_count: 0,
});

const THIS = game("THIS 0.13.6", "THIS", "0.13.6");
const HUB = [
  hubGame("THIS", "Recoil-Game-Archive/THIS"),
  hubGame("OTHER", "someone/other"),
];

describe("installedGameRepos", () => {
  it("reads an installed game's releases from the repo the hub lists", () => {
    expect(installedGameRepos([THIS], [], HUB)).toEqual([
      "Recoil-Game-Archive/THIS",
    ]);
  });

  it("leaves out a hub game that is not installed", () => {
    expect(installedGameRepos([], [], HUB)).toEqual([]);
  });

  it("names a repo once when the catalog and the hub both list it", () => {
    const catalog = [
      {
        key: "this",
        label: "THIS",
        repo: "Recoil-Game-Archive/THIS",
        nameKey: "this",
      },
    ];
    expect(installedGameRepos([THIS], catalog, HUB)).toEqual([
      "Recoil-Game-Archive/THIS",
    ]);
  });

  it("still reads the catalog's repos before the hub's list arrives", () => {
    const catalog = [
      { key: "this", label: "THIS", repo: "a/this", nameKey: "this" },
    ];
    expect(installedGameRepos([THIS], catalog, null)).toEqual(["a/this"]);
  });

  it("skips the repo it is told to", () => {
    expect(
      installedGameRepos([THIS], [], HUB, "Recoil-Game-Archive/THIS"),
    ).toEqual([]);
  });
});
