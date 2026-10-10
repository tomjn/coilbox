import { describe, expect, it } from "vitest";
import { type EngineOfferReadings, skirmishEngineOffer } from "./engineOffer";

/** A machine with no engine, a writable folder and a build in the catalog. */
const bare = (
  over: Partial<EngineOfferReadings> = {},
): EngineOfferReadings => ({
  hasTarget: false,
  targetLoading: false,
  writeRoot: { loading: false, path: "/content" },
  newestEngine: { loaded: true, version: "2025.06.12" },
  ...over,
});

describe("skirmishEngineOffer", () => {
  it("offers the newest catalog build when no engine is installed and a folder is writable", () => {
    expect(skirmishEngineOffer(bare())).toEqual({
      kind: "download",
      version: "2025.06.12",
    });
  });

  it("sends the player to the folder setting when no folder can be written to", () => {
    expect(
      skirmishEngineOffer(bare({ writeRoot: { loading: false } })),
    ).toEqual({ kind: "settings" });
  });

  it("offers nothing when an engine is installed", () => {
    expect(skirmishEngineOffer(bare({ hasTarget: true }))).toEqual({
      kind: "none",
    });
  });

  it("falls back to the settings message when the catalog has no build for this platform", () => {
    expect(
      skirmishEngineOffer(
        bare({ newestEngine: { loaded: true, version: null } }),
      ),
    ).toEqual({ kind: "settings" });
  });

  it("says nothing while the engines, the folder or the catalog are still being read", () => {
    expect(skirmishEngineOffer(bare({ targetLoading: true }))).toEqual({
      kind: "pending",
    });
    expect(skirmishEngineOffer(bare({ writeRoot: { loading: true } }))).toEqual(
      { kind: "pending" },
    );
    expect(
      skirmishEngineOffer(
        bare({ newestEngine: { loaded: false, version: null } }),
      ),
    ).toEqual({ kind: "pending" });
  });
});
