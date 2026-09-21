import { describe, expect, it } from "vitest";
import { findArchiveMusic, trackLabel, trackMood } from "./archiveMusic";

/**
 * There is no convention for where a game keeps its music, which is why the
 * issue asked for a spike before any code. The cases below are the real layouts
 * of the games installed on the machine this was written on, not invented ones.
 *
 * Of seven games, two ship music at all:
 *
 * - SplinterFaction, 28 tracks under `Music/original/<mood>/`.
 * - Spring 1944, 3 tracks under `LuaIntro/Assets/music/`.
 *
 * Balanced Annihilation and Metal Factions ship a `music.lua` and no audio,
 * which is the trap: a path with "music" in it that is not a track.
 */

const splinterFaction = [
  { path: "Music/original/bossfight/Cyberpunk Fight.ogg", size: 3963146 },
  { path: "Music/original/peace/Calm.ogg", size: 5516552 },
  { path: "Music/original/gameover/placeholder.txt", size: 0 },
  { path: "LuaUI/Images/music/play.png", size: 21244 },
  { path: "LuaIntro/Addons/music.lua", size: 1776 },
  { path: "Sounds/ui/click.wav", size: 4200 },
];

const spring1944 = [
  { path: "LuaIntro/Assets/music/colonelbogey.ogg", size: 3637616 },
  { path: "LuaIntro/Assets/music/lilimar4.ogg", size: 346783 },
  { path: "LuaIntro/Assets/music/svyashen.ogg", size: 1811009 },
  { path: "LuaIntro/Addons/music.lua", size: 1286 },
  { path: "sounds/Weapons/rifle.wav", size: 18000 },
];

const balancedAnnihilation = [
  { path: "luaintro/Addons/music.lua", size: 891 },
  { path: "sounds/explosion.wav", size: 30000 },
];

describe("finding a game's music", () => {
  it("finds SplinterFaction's tracks under its own Music folder", () => {
    expect(findArchiveMusic(splinterFaction)).toEqual([
      "Music/original/bossfight/Cyberpunk Fight.ogg",
      "Music/original/peace/Calm.ogg",
    ]);
  });

  it("finds Spring 1944's, which live somewhere else entirely", () => {
    // The whole reason the rule is a path segment rather than a folder name.
    expect(findArchiveMusic(spring1944)).toEqual([
      "LuaIntro/Assets/music/colonelbogey.ogg",
      "LuaIntro/Assets/music/lilimar4.ogg",
      "LuaIntro/Assets/music/svyashen.ogg",
    ]);
  });

  it("finds nothing in a game that only ships a music script", () => {
    expect(findArchiveMusic(balancedAnnihilation)).toEqual([]);
  });

  it("ignores a music.lua and the player-button icons beside it", () => {
    // `LuaUI/Images/music/play.png` is in a music folder and is not a track.
    const found = findArchiveMusic(splinterFaction);
    expect(found.some((p) => p.endsWith(".lua"))).toBe(false);
    expect(found.some((p) => p.endsWith(".png"))).toBe(false);
  });

  it("drops anything too small to be a song", () => {
    // A jingle or a UI blip sitting in a music folder is not a soundtrack.
    expect(findArchiveMusic([{ path: "music/blip.ogg", size: 2000 }])).toEqual(
      [],
    );
  });

  it("drops a track unitsync could not hand back anyway", () => {
    // Audio comes back as a data URL with a 16 MB cap, so a bigger track would
    // silently fail to play. Better not to list it.
    expect(
      findArchiveMusic([{ path: "music/epic.ogg", size: 20_000_000 }]),
    ).toEqual([]);
  });
});

describe("labelling a track", () => {
  it("names the mood a game filed it under", () => {
    expect(trackMood("Music/original/bossfight/Cyberpunk Fight.ogg")).toBe(
      "bossfight",
    );
  });

  it("has no mood for a game that does not group them", () => {
    expect(trackMood("LuaIntro/Assets/music/colonelbogey.ogg")).toBeNull();
  });

  it("shows the track name without its folders or extension", () => {
    expect(trackLabel("Music/original/peace/Calm.ogg")).toBe("Calm");
  });
});
