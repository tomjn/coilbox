import { describe, expect, it } from "vitest";
import { encodeChallenge, encodeChallengeFile } from "../challenge/code";
import {
  encodeContainerCode,
  encodeContainerJson,
} from "../container/container";
import { clipboardOffer, readImport } from "./readImport";

const warpathSettings = {
  seed: 7,
  nodes: 12,
  game: { shortname: "BA" },
};

const presetPayload = {
  participants: [],
  gameName: "Balanced Annihilation 12.1",
  mapName: "Comet Catcher",
  startPosType: 2,
  modOptionValues: {},
};

const packPayload = {
  engineVersion: "105.1.1",
  maps: ["Comet Catcher"],
  game: { name: "Beyond All Reason test-1234", shortname: "BAR" },
};

describe("readImport: the four things somebody can hand it", () => {
  it("takes a bare share code and names what it is", () => {
    const r = readImport(encodeChallenge("warpath", warpathSettings));
    expect(r.outcome).toBe("confirm");
    if (r.outcome !== "confirm") return;
    expect(r.phrase).toBe("a warpath challenge for BA");
    expect(r.plan.route).toContain("/warpath?import=");
  });

  it("takes the raw text of an exported .json file", () => {
    const r = readImport(encodeChallengeFile("conquest", warpathSettings));
    expect(r.outcome).toBe("confirm");
    if (r.outcome !== "confirm") return;
    expect(r.phrase).toBe("a conquest challenge for BA");
    expect(r.plan.route).toContain("/conquest?import=");
  });

  it("takes a file's contents for a kind that only exports as a file", () => {
    // What `content_import_container` hands back for a setup pack export.
    const r = readImport(encodeContainerJson("setup-pack", 1, packPayload));
    expect(r.outcome).toBe("confirm");
    if (r.outcome !== "confirm") return;
    expect(r.phrase).toBe("a setup pack for Beyond All Reason test-1234");
    expect(r.plan.route).toContain("/content/setup-packs?import=");
  });

  it("unwraps a coilbox://import?code= link and confirms it in the box", () => {
    const code = encodeContainerCode("preset", 1, presetPayload);
    const r = readImport(`coilbox://import?code=${code}`);
    expect(r.outcome).toBe("confirm");
    if (r.outcome !== "confirm") return;
    expect(r.phrase).toBe(
      "a singleplayer preset for Balanced Annihilation 12.1",
    );
    expect(r.plan.route).toContain("/play/skirmish?import=");
  });

  it("hands a join link to the deep-link handler", () => {
    const url = "coilbox://join?server=lobby.example.com&battle=42";
    expect(readImport(url)).toEqual({ outcome: "link", url });
  });

  it("hands an import?url= link to the deep-link handler, which owns the fetch", () => {
    const url = "coilbox://import?url=https%3A%2F%2Fexample.com%2Fshared.json";
    const r = readImport(url);
    expect(r.outcome).toBe("link");
  });

  it("hands an open link to the deep-link handler", () => {
    const url = "coilbox://open?screen=conquest";
    expect(readImport(url)).toEqual({ outcome: "link", url });
  });

  it("turns a pasted https address into a fetch the handler confirms", () => {
    // Coilbox Hub serves a share's container JSON off its item URL.
    const r = readImport(
      "https://coilbox-hub.vercel.app/i/9638778b-b619-4339-8d85-7432af1eb984",
    );
    expect(r).toEqual({
      outcome: "link",
      url: "coilbox://import?url=https%3A%2F%2Fcoilbox-hub.vercel.app%2Fi%2F9638778b-b619-4339-8d85-7432af1eb984",
    });
  });

  it("ignores surrounding whitespace from a sloppy copy", () => {
    const r = readImport(
      `\n  ${encodeChallenge("warpath", warpathSettings)} \n`,
    );
    expect(r.outcome).toBe("confirm");
  });
});

describe("readImport: a wrong paste is a sentence, not a validation failure", () => {
  it("refuses a plain http address without going near it", () => {
    const r = readImport("http://example.com/shared.json");
    expect(r.outcome).toBe("rejected");
    if (r.outcome !== "rejected") return;
    expect(r.reason).toMatch(/https/i);
  });

  it("says half a code is half a code", () => {
    const whole = encodeChallenge("warpath", warpathSettings);
    const r = readImport(whole.slice(0, Math.floor(whole.length / 2)));
    expect(r.outcome).toBe("rejected");
    if (r.outcome !== "rejected") return;
    expect(r.reason).toMatch(/damaged or cut short/i);
  });

  it("says JSON that is not a coilbox file is exactly that", () => {
    const r = readImport('{"name":"my mod","version":2}');
    expect(r.outcome).toBe("rejected");
    if (r.outcome !== "rejected") return;
    expect(r.reason).toMatch(/JSON file, but not one coilbox made/i);
  });

  it("says a container from a newer coilbox needs a newer coilbox", () => {
    const r = readImport(encodeContainerCode("preset", 99, presetPayload));
    expect(r.outcome).toBe("rejected");
    if (r.outcome !== "rejected") return;
    expect(r.reason).toMatch(/newer version of coilbox/i);
  });

  it("says a coilbox container of an unheard-of kind needs a newer coilbox", () => {
    const r = readImport(
      encodeContainerCode("mystery" as "preset", 1, presetPayload),
    );
    expect(r.outcome).toBe("rejected");
    if (r.outcome !== "rejected") return;
    expect(r.reason).toMatch(/newer version of coilbox/i);
  });

  it("names a campaign and says where a campaign goes", () => {
    const r = readImport(
      encodeContainerCode("campaign", 1, {
        type: "ta",
        missions: [{ snapshot: { gameName: "Balanced Annihilation 12.1" } }],
      }),
    );
    expect(r.outcome).toBe("rejected");
    if (r.outcome !== "rejected") return;
    expect(r.reason).toContain(
      "a coilbox campaign for Balanced Annihilation 12.1",
    );
    expect(r.reason).toMatch(/Campaign Builder/);
    expect(r.reason).toMatch(/Advanced mode/);
  });

  it("passes a broken coilbox link's own reason through", () => {
    const r = readImport("coilbox://import");
    expect(r.outcome).toBe("rejected");
    if (r.outcome !== "rejected") return;
    expect(r.reason).toMatch(/no payload/i);
  });

  it("says an unknown coilbox action is unknown", () => {
    const r = readImport("coilbox://frobnicate?x=1");
    expect(r.outcome).toBe("rejected");
    if (r.outcome !== "rejected") return;
    expect(r.reason).toMatch(/unknown action/i);
  });

  it("falls back to a sentence for text that is nothing at all", () => {
    const r = readImport("hello, is this the import box");
    expect(r.outcome).toBe("rejected");
    if (r.outcome !== "rejected") return;
    expect(r.reason).toMatch(/does not recognise/i);
  });

  it("asks for something when handed nothing", () => {
    const r = readImport("   ");
    expect(r.outcome).toBe("rejected");
    if (r.outcome !== "rejected") return;
    expect(r.reason).toMatch(/Paste a coilbox link/);
  });
});

describe("clipboardOffer", () => {
  it("offers a container the clipboard happens to be holding", () => {
    const offer = clipboardOffer(encodeChallenge("warpath", warpathSettings));
    expect(offer).toBe("Your clipboard holds a warpath challenge for BA.");
  });

  it("offers a coilbox link", () => {
    expect(clipboardOffer("coilbox://open?screen=battles")).toBe(
      "Your clipboard holds a coilbox link.",
    );
  });

  it("says nothing about an ordinary clipboard", () => {
    expect(clipboardOffer("the quick brown fox")).toBeNull();
    expect(clipboardOffer("")).toBeNull();
  });

  it("does not offer to download a web address it happens to find", () => {
    expect(clipboardOffer("https://example.com/anything")).toBeNull();
    expect(clipboardOffer("https://coilbox-hub.vercel.app/i/abc")).toBeNull();
  });

  it("says nothing about a campaign, which the box cannot take anyway", () => {
    const code = encodeContainerCode("campaign", 1, {
      type: "ta",
      missions: [],
    });
    expect(clipboardOffer(code)).toBeNull();
  });
});
