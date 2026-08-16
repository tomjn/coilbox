import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssetIdentity } from "./have";
import {
  forgetHeldPictures,
  heldMapAsset,
  heldPicture,
  identityKey,
} from "./heldPictures";
import type { AssetPicture } from "./pictures";

const BASE = "https://hub.example";

function mapKey(name: string): AssetIdentity {
  return { keyed_on: "map", map_name: name, variant: "minimap" };
}

const HELD: AssetPicture = {
  tier: "static",
  path: "maps/minimap/ccr18-abcdef.webp",
  url: "https://tomjn.github.io/coilbox-assets/maps/minimap/ccr18-abcdef.webp",
  width: 1024,
  height: 1024,
  served_variant: "minimap",
  substituted: false,
};

/** A hub that answers every key it is asked, with a picture for the names in
 *  `holding` and null for the rest. Records each batch it was sent. */
function stubHub(holding: string[] = [], answer?: { status: number }) {
  const batches: AssetIdentity[][] = [];
  const fn = vi.fn(async (_url: string, init: RequestInit) => {
    const asked = JSON.parse(String(init.body)).keys as AssetIdentity[];
    batches.push(asked);
    if (answer) {
      return {
        ok: false,
        status: answer.status,
        json: async () => ({ error: "The hub is asleep." }),
      } as Response;
    }
    return {
      ok: true,
      status: 200,
      json: async () => ({
        format: "coilbox-hub-asset-pictures",
        version: 1,
        results: asked.map((key) => ({
          ...key,
          picture:
            key.keyed_on === "map" && holding.includes(key.map_name)
              ? HELD
              : null,
        })),
      }),
    } as Response;
  });
  vi.stubGlobal("fetch", fn);
  return { fn, batches };
}

beforeEach(() => {
  forgetHeldPictures();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("identityKey", () => {
  it("cannot collide across the two key shapes", () => {
    expect(identityKey(mapKey("Isis 1.3"))).not.toBe(
      identityKey({
        keyed_on: "unit",
        game: "map",
        unit_name: "Isis 1.3",
        variant: "minimap",
      }),
    );
  });
});

describe("heldMapAsset", () => {
  it("hands the ladder the tier and the path, and drops the hub's URL", () => {
    // The ladder joins the path to whichever durable base this session is
    // configured with, which a distributor may have overridden.
    expect(heldMapAsset(HELD)).toEqual({
      tier: "static",
      path: "maps/minimap/ccr18-abcdef.webp",
      width: 1024,
      height: 1024,
    });
  });

  it("has no asset for no picture", () => {
    expect(heldMapAsset(null)).toBeNull();
  });
});

describe("heldPicture", () => {
  it("answers each caller with its own picture", async () => {
    stubHub(["Comet Catcher Remake 1.8"]);

    const [held, missing] = await Promise.all([
      heldPicture(BASE, mapKey("Comet Catcher Remake 1.8")),
      heldPicture(BASE, mapKey("Nothing Here 1.0")),
    ]);

    expect(held).toEqual(HELD);
    expect(missing).toBeNull();
  });

  /** The point of the file. A screen of cards each asking for one map is one
   *  request, because the queue is flushed after the commit's effects run. */
  it("turns a screen of maps into one request", async () => {
    const { fn, batches } = stubHub([]);

    await Promise.all(
      Array.from({ length: 24 }, (_, n) =>
        heldPicture(BASE, mapKey(`Map ${n}`)),
      ),
    );

    expect(fn).toHaveBeenCalledTimes(1);
    expect(batches[0]).toHaveLength(24);
  });

  it("splits a screen bigger than the hub's cap into batches of 500", async () => {
    const { batches } = stubHub([]);

    await Promise.all(
      Array.from({ length: 501 }, (_, n) =>
        heldPicture(BASE, mapKey(`Map ${n}`)),
      ),
    );

    expect(batches.map((batch) => batch.length)).toEqual([500, 1]);
  });

  it("asks about one map once, however many cards want it", async () => {
    const { fn, batches } = stubHub(["Isis 1.3"]);

    const answers = await Promise.all([
      heldPicture(BASE, mapKey("Isis 1.3")),
      heldPicture(BASE, mapKey("Isis 1.3")),
    ]);

    expect(batches[0]).toHaveLength(1);
    expect(answers).toEqual([HELD, HELD]);
    // And again on the next screen, off the session's memory.
    expect(await heldPicture(BASE, mapKey("Isis 1.3"))).toEqual(HELD);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("remembers that the hub has no picture, rather than asking again", async () => {
    const { fn } = stubHub([]);

    expect(await heldPicture(BASE, mapKey("Nothing Here 1.0"))).toBeNull();
    expect(await heldPicture(BASE, mapKey("Nothing Here 1.0"))).toBeNull();

    expect(fn).toHaveBeenCalledTimes(1);
  });

  /** A failure says nothing about what the hub holds, so remembering it would
   *  turn one bad moment on the network into a session with no hub pictures. */
  it("asks again after a request that failed", async () => {
    const failing = stubHub([], { status: 503 });
    expect(await heldPicture(BASE, mapKey("Isis 1.3"))).toBeNull();
    expect(failing.fn).toHaveBeenCalledTimes(1);

    const answering = stubHub(["Isis 1.3"]);
    expect(await heldPicture(BASE, mapKey("Isis 1.3"))).toEqual(HELD);
    expect(answering.fn).toHaveBeenCalledTimes(1);
  });

  it("never rejects, so a card always gets an answer to draw with", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no route");
      }),
    );
    await expect(heldPicture(BASE, mapKey("Isis 1.3"))).resolves.toBeNull();
  });

  /** Changing the hub in Settings must not leave the old one's paths on screen. */
  it("keeps one hub's answers off another hub", async () => {
    stubHub(["Isis 1.3"]);
    expect(await heldPicture(BASE, mapKey("Isis 1.3"))).toEqual(HELD);

    stubHub([]);
    expect(
      await heldPicture("https://other.example", mapKey("Isis 1.3")),
    ).toBeNull();
  });
});
