import { describe, expect, it } from "vitest";
import { skyboxNote } from "./skyboxNote";

describe("skyboxNote", () => {
  it("says nothing about a map that declares no skybox", () => {
    expect(skyboxNote()).toBeNull();
    expect(skyboxNote(null)).toBeNull();
  });

  it("says a skybox coilbox could not read is why the sky is flat", () => {
    const note = skyboxNote("unreadable");
    expect(note?.label).toBe("flat sky");
    expect(note?.title).toMatch(/cannot read/i);
  });

  it("keeps an unreadable file apart from one that is not a cube map", () => {
    const unreadable = skyboxNote("unreadable");
    const flat = skyboxNote("not-a-cube-map");
    expect(unreadable?.title).not.toBe(flat?.title);
    expect(flat?.title).toMatch(/not a cube map/i);
  });
});
