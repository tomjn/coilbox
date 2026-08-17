import { afterEach, describe, expect, it, vi } from "vitest";
import { unitIconDataUrl, unitIconSrc } from "./unitIcon";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("unitIconSrc", () => {
  it("draws a cached icon from the asset protocol", () => {
    expect(unitIconSrc({ iconFile: "abc_armcom.png" })).toBe(
      "coilbox://localhost/unitsyncbuildpic/abc_armcom.png",
    );
  });

  it("falls back to the inline copy when the icon had nowhere to go", () => {
    expect(unitIconSrc({ icon: "data:image/png;base64,aGk=" })).toBe(
      "data:image/png;base64,aGk=",
    );
  });

  it("has nothing to draw for a unit with no picture", () => {
    expect(unitIconSrc(undefined)).toBeUndefined();
    expect(unitIconSrc({ iconSkipped: "no-source" })).toBeUndefined();
  });
});

describe("unitIconDataUrl", () => {
  it("reads a cached icon back as base64, which is what an export carries", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      arrayBuffer: async () => new Uint8Array([104, 105]).buffer,
    }));
    vi.stubGlobal("fetch", fetchMock);

    expect(await unitIconDataUrl({ iconFile: "abc_armcom.png" })).toBe(
      "data:image/png;base64,aGk=",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "coilbox://localhost/unitsyncbuildpic/abc_armcom.png",
    );
  });

  it("passes an already-inline icon straight back", async () => {
    vi.stubGlobal("fetch", vi.fn());
    expect(await unitIconDataUrl({ icon: "data:image/png;base64,aGk=" })).toBe(
      "data:image/png;base64,aGk=",
    );
  });

  /// An export of several hundred units should lose the one picture it cannot
  /// read rather than failing outright.
  it("yields nothing for a file that will not read", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("gone");
      }),
    );
    expect(
      await unitIconDataUrl({ iconFile: "abc_armcom.png" }),
    ).toBeUndefined();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false })),
    );
    expect(
      await unitIconDataUrl({ iconFile: "abc_armcom.png" }),
    ).toBeUndefined();
  });
});
