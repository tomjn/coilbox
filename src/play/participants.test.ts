import { describe, expect, it } from "vitest";
import { isBlackHex } from "@/lib/teamColor";
import {
  initialParticipants,
  makeAiParticipant,
  PALETTE,
  type Participant,
  rgbToHex,
  sanitizeColors,
} from "./participants";

const you = (color: Participant["color"]): Participant => ({
  id: "you",
  kind: "you",
  name: "You",
  side: "",
  color,
  allyTeam: 0,
  spectator: false,
});

const ai = (id: string, color: Participant["color"]): Participant => ({
  id,
  kind: "ai",
  name: id,
  side: "",
  color,
  allyTeam: 1,
  spectator: false,
});

describe("makeAiParticipant colours", () => {
  it("gives each added AI a distinct, non-black colour as participants accumulate", () => {
    let ps = initialParticipants();
    const seen = new Set(ps.map((p) => rgbToHex(p.color)));
    for (let i = 0; i < 8; i++) {
      const next = makeAiParticipant(ps);
      const hex = rgbToHex(next.color);
      expect(isBlackHex(hex)).toBe(false);
      expect(seen.has(hex)).toBe(false);
      seen.add(hex);
      ps = [...ps, next];
    }
  });
});

describe("sanitizeColors", () => {
  it("heals a black 'you' row by seeding from the remembered colour", () => {
    const ps = [you([0, 0, 0]), ai("AI 1", PALETTE[1])];
    const out = sanitizeColors(ps, "#ff0000");
    expect(rgbToHex(out[0].color)).toBe("#ff0000");
  });

  it("picks a non-black colour for 'you' when there is no remembered colour", () => {
    const ps = [you([0, 0, 0]), ai("AI 1", PALETTE[1])];
    const out = sanitizeColors(ps, "");
    expect(isBlackHex(rgbToHex(out[0].color))).toBe(false);
  });

  it("keeps a valid 'you' colour and only heals black opponents", () => {
    const green = PALETTE[2];
    const ps = [you(green), ai("AI 1", [0, 0, 0])];
    const out = sanitizeColors(ps, "#ff0000");
    expect(rgbToHex(out[0].color)).toBe(rgbToHex(green)); // untouched
    expect(isBlackHex(rgbToHex(out[1].color))).toBe(false); // healed
  });

  it("returns the same array reference when nothing needs healing", () => {
    const ps = initialParticipants();
    expect(sanitizeColors(ps, "")).toBe(ps);
  });
});
