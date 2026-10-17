import { describe, expect, it } from "vitest";

import type { FactionLogoEntry, FactionLogosResult } from "@/content/bindings";
import {
  type FactionLogoTools,
  factionLogoUploads,
  sendFactionLogos,
} from "./factionLogos";
import type { AssetKey } from "./have";
import type { AssetUpload } from "./upload";

/**
 * What goes to the hub for a faction logo is the contract in issue #4387, and
 * the hub refuses a field it does not know with a 400. These hold the shape and
 * the order: ask first, send only what is missing.
 */

const FACTIONS = [
  { key: "armada", name: "Armada" },
  { key: "cortex", name: "Cortex" },
];

function logo(side: string): FactionLogoEntry {
  return {
    side,
    maxDim: 16,
    asset: {
      variant: "logo",
      origin: "extracted",
      sourceArchive: "Beyond All Reason test-1",
      path: `/assets/${side}.webp`,
      hash: `hash-${side}`,
      sourceHash: `src-${side}`,
      sourceMember: `Sidepics/${side}.png`,
      encodeProfile: "webp-lossless-128",
      mime: "image/webp",
      width: 16,
      height: 16,
      bytes: 120,
    },
  };
}

const TARGET = {
  hubUrl: "https://hub.example",
  enginePath: "/engines/105",
  dataDir: "/data",
  gameArchive: "BAR.sdz",
};

function tools(options: {
  logos?: FactionLogoEntry[];
  have?: (factionKey: string) => boolean;
}) {
  const calls = {
    read: [] as { sides: string[]; assets: boolean | undefined }[],
    asked: [] as AssetKey[][],
    sent: [] as AssetUpload[][],
  };
  const fake: FactionLogoTools = {
    logos: async (args) => {
      calls.read.push({ sides: args.sides, assets: args.assets });
      return { logos: options.logos ?? [], errors: [] } as FactionLogosResult;
    },
    ask: async (_hubUrl, keys) => {
      calls.asked.push(keys);
      return keys.map(
        (key) =>
          ({
            ...key,
            status:
              key.keyed_on === "faction" && options.have?.(key.faction_key)
                ? "have"
                : "missing",
          }) as never,
      );
    },
    upload: async (_hubUrl, assets) => {
      calls.sent.push(assets);
      return { outcomes: [], written: assets.length, error: null };
    },
  };
  return { fake, calls };
}

describe("factionLogoUploads", () => {
  it("declares exactly the fields the hub takes for a faction logo", () => {
    const [upload] = factionLogoUploads("bar", FACTIONS, {
      logos: [logo("Armada")],
      errors: [],
    });

    // The Rust side adds `bytes` from the file's length. `path` is never sent.
    // No width, height, hash, map_* or unit_name, which the hub refuses.
    expect(Object.keys(upload).sort()).toEqual(
      [
        "keyed_on",
        "game",
        "faction_key",
        "variant",
        "source_hash",
        "encode_profile",
        "origin",
        "mime",
        "source_archive",
        "path",
      ].sort(),
    );
    expect(upload).toEqual({
      keyed_on: "faction",
      game: "bar",
      faction_key: "armada",
      variant: "logo",
      source_hash: "src-Armada",
      encode_profile: "webp-lossless-128",
      origin: "extracted",
      mime: "image/webp",
      source_archive: "Beyond All Reason test-1",
      path: "/assets/Armada.webp",
    });
  });

  it("keys a logo on the facts' faction key, not on the side's spelling", () => {
    const uploads = factionLogoUploads(
      "bar",
      [{ key: "the swarm", name: " The Swarm " }],
      { logos: [logo(" The Swarm ")], errors: [] },
    );
    expect(uploads.map((one) => one.faction_key)).toEqual(["the swarm"]);
  });

  it("leaves out a side with no asset and a side the facts did not name", () => {
    const withoutAsset: FactionLogoEntry = { side: "Cortex", maxDim: 16 };
    const uploads = factionLogoUploads("bar", FACTIONS, {
      logos: [logo("Armada"), withoutAsset, logo("Legion")],
      errors: [],
    });
    expect(uploads.map((one) => one.faction_key)).toEqual(["armada"]);
  });
});

describe("sendFactionLogos", () => {
  it("asks the worker for each faction by name and for assets", async () => {
    const { fake, calls } = tools({ logos: [] });
    await sendFactionLogos(TARGET, "bar", FACTIONS, fake);
    expect(calls.read).toEqual([{ sides: ["Armada", "Cortex"], assets: true }]);
  });

  it("asks the hub first with a faction key per logo, then sends the missing", async () => {
    const { fake, calls } = tools({
      logos: [logo("Armada"), logo("Cortex")],
      have: (key) => key === "armada",
    });
    const pass = await sendFactionLogos(TARGET, "bar", FACTIONS, fake);

    expect(calls.asked).toEqual([
      [
        {
          keyed_on: "faction",
          game: "bar",
          faction_key: "armada",
          variant: "logo",
          source_hash: "src-Armada",
        },
        {
          keyed_on: "faction",
          game: "bar",
          faction_key: "cortex",
          variant: "logo",
          source_hash: "src-Cortex",
        },
      ],
    ]);
    expect(calls.sent).toHaveLength(1);
    expect(
      calls.sent[0].map((one) =>
        one.keyed_on === "faction" ? one.faction_key : "",
      ),
    ).toEqual(["cortex"]);
    expect(pass).toEqual({ found: 2, written: 1, errors: [] });
  });

  it("sends nothing when the hub holds every logo", async () => {
    const { fake, calls } = tools({
      logos: [logo("Armada")],
      have: () => true,
    });
    const pass = await sendFactionLogos(TARGET, "bar", FACTIONS, fake);
    expect(calls.sent).toEqual([]);
    expect(pass).toEqual({ found: 1, written: 0, errors: [] });
  });

  it("reads and asks nothing for a game with no factions", async () => {
    const { fake, calls } = tools({ logos: [logo("Armada")] });
    const pass = await sendFactionLogos(TARGET, "bar", [], fake);
    expect(calls).toEqual({ read: [], asked: [], sent: [] });
    expect(pass).toEqual({ found: 0, written: 0, errors: [] });
  });

  it("asks nothing when the game ships no emblems", async () => {
    const { fake, calls } = tools({ logos: [] });
    await sendFactionLogos(TARGET, "bar", FACTIONS, fake);
    expect(calls.asked).toEqual([]);
    expect(calls.sent).toEqual([]);
  });
});
