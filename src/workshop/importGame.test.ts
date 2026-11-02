import { beforeEach, describe, expect, it } from "vitest";
import { resetShortnames } from "../container/shortnames";
import { bindToInstalledGame } from "./importGame";
import type { ImportedProject } from "./project";
import { EMPTY_EDITS } from "./project";

const game = (name: string, shortname: string, version: string) => ({
  name,
  info: { shortname, version },
});

const imported = (over: Partial<ImportedProject> = {}): ImportedProject => ({
  name: "Borrowed tanks",
  gameName: "Balanced Annihilation V15.9.8",
  game: { name: "Balanced Annihilation V15.9.8", shortname: "BA" },
  authoredChecksum: "author",
  edits: EMPTY_EDITS,
  ...over,
});

beforeEach(() => resetShortnames());

describe("bindToInstalledGame", () => {
  it("opens an older build's project on the newest installed build of the game", () => {
    const bound = bindToInstalledGame(imported(), [
      game("Balanced Annihilation V15.9.9", "BA", "V15.9.9"),
      game("Balanced Annihilation V15.9.10", "BA", "V15.9.10"),
      game("Zero-K v1.15", "ZK", "v1.15"),
    ]);
    expect(bound.gameName).toBe("Balanced Annihilation V15.9.10");
    expect(bound.game).toEqual({
      name: "Balanced Annihilation V15.9.10",
      shortname: "BA",
    });
  });

  it("keeps the author's checksum, which is how the editor sees the game moved", () => {
    const bound = bindToInstalledGame(imported(), [
      game("Balanced Annihilation V15.9.9", "BA", "V15.9.9"),
    ]);
    expect(bound.authoredChecksum).toBe("author");
  });

  it("leaves a project alone when its exact build is installed", () => {
    const project = imported();
    expect(
      bindToInstalledGame(project, [
        game("Balanced Annihilation V15.9.8", "BA", "V15.9.8"),
        game("Balanced Annihilation V15.9.9", "BA", "V15.9.9"),
      ]),
    ).toBe(project);
  });

  it("leaves a project alone when no installed game shares its shortname", () => {
    const project = imported();
    expect(
      bindToInstalledGame(project, [game("Zero-K v1.15", "ZK", "v1.15")]),
    ).toBe(project);
  });

  it("leaves a project alone when its shortname is not known", () => {
    const project = imported({ game: undefined });
    expect(
      bindToInstalledGame(project, [
        game("Balanced Annihilation V15.9.9", "BA", "V15.9.9"),
      ]),
    ).toBe(project);
  });

  it("does not take another game that happens to share the shortname", () => {
    const project = imported({
      gameName: "Zero-K v1.14.10.1",
      game: { name: "Zero-K v1.14.10.1", shortname: "ZK" },
    });
    expect(
      bindToInstalledGame(project, [game("Zero-K Benchmark v3", "ZK", "v3")]),
    ).toBe(project);
  });
});
