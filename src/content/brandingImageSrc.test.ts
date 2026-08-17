import { afterEach, describe, expect, it, vi } from "vitest";

// branding.ts transitively pulls in @picoframe/plugin-sdk, whose published dist
// uses extensionless relative imports Vitest's node resolver won't load from
// node_modules (see imageCacheKey.test.ts). Standing the command up here also
// lets the tests decide what the Rust side answered.
const command = vi.hoisted(() => vi.fn());
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand: () => command,
}));

const { resolveBrandingDataUrl, resolveBrandingImage } = await import(
  "./branding"
);

/** A fresh URL per test, so the module's session cache never crosses them. */
let n = 0;
const urls = () => [`https://catalog.example/logo-${n++}.png`];

afterEach(() => {
  command.mockReset();
  vi.unstubAllGlobals();
});

describe("resolveBrandingImage", () => {
  it("points a cached picture at the asset protocol", async () => {
    command.mockResolvedValue({ file: "abc.v3.raw.png" });
    expect(await resolveBrandingImage(urls())).toBe(
      "coilbox://localhost/contentbranding/abc.v3.raw.png",
    );
  });

  it("passes an inlined picture through", async () => {
    command.mockResolvedValue({ dataUrl: "data:image/png;base64,aGk=" });
    expect(await resolveBrandingImage(urls())).toBe(
      "data:image/png;base64,aGk=",
    );
  });

  it("resolves to nothing for no URLs and for a picture that did not fetch", async () => {
    expect(await resolveBrandingImage([])).toBeUndefined();
    command.mockResolvedValue({});
    expect(await resolveBrandingImage(urls())).toBeUndefined();
  });
});

describe("resolveBrandingDataUrl", () => {
  /// An export writes the bytes into a file that leaves this machine, so a name
  /// pointing at this cache has to be read back.
  it("reads a cached picture back as base64", async () => {
    command.mockResolvedValue({ file: "abc.v3.photo.jpg" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        headers: new Headers({ "content-type": "image/jpeg" }),
        arrayBuffer: async () => new Uint8Array([104, 105]).buffer,
      })),
    );
    expect(await resolveBrandingDataUrl(urls(), true)).toBe(
      "data:image/jpeg;base64,aGk=",
    );
  });

  it("passes an already-inline picture straight back without fetching", async () => {
    command.mockResolvedValue({ dataUrl: "data:image/png;base64,aGk=" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await resolveBrandingDataUrl(urls())).toBe(
      "data:image/png;base64,aGk=",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
