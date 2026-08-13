import { afterEach, describe, expect, it, vi } from "vitest";
import { liveCacheHit, thumbFileExists } from "./cachedFile";

/** A fetch that answers every request with `status`. */
function answering(status: number) {
  const fetched = vi.fn(async () => new Response(null, { status }));
  vi.stubGlobal("fetch", fetched);
  return fetched;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("thumbFileExists", () => {
  it("reads a file that is there as there", async () => {
    answering(206);
    expect(await thumbFileExists("abc-3.png")).toBe(true);
  });

  it("reads a 404 as gone", async () => {
    answering(404);
    expect(await thumbFileExists("abc-3.png")).toBe(false);
  });

  it("asks for one byte, past the webview's own cache", async () => {
    const fetched = answering(206);
    await thumbFileExists("abc-3.png");
    const [url, init] = fetched.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toContain("abc-3.png");
    expect(init.cache).toBe("no-store");
    expect(new Headers(init.headers).get("Range")).toBe("bytes=0-0");
  });

  it("treats a request that fails as no answer rather than a missing file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("no scheme handler");
      }),
    );
    expect(await thumbFileExists("abc-3.png")).toBe(true);
  });
});

describe("liveCacheHit", () => {
  const fileOf = (v: { file?: string }) => v.file;

  it("keeps a hit whose file is still there", async () => {
    answering(206);
    const cache = new Map([["k", { file: "abc-3.png" }]]);
    expect(await liveCacheHit(cache, "k", fileOf)).toEqual({
      file: "abc-3.png",
    });
    expect(cache.has("k")).toBe(true);
  });

  it("forgets a hit whose file was swept, so the caller asks the worker again", async () => {
    answering(404);
    const cache = new Map([["k", { file: "abc-3.png" }]]);
    expect(await liveCacheHit(cache, "k", fileOf)).toBeUndefined();
    expect(cache.has("k")).toBe(false);
  });

  it("does not ask about a result that inlined its bytes", async () => {
    const fetched = answering(404);
    const cache = new Map([["k", { file: undefined }]]);
    expect(await liveCacheHit(cache, "k", fileOf)).toEqual({ file: undefined });
    expect(fetched).not.toHaveBeenCalled();
  });

  it("does not ask about a key it has never seen", async () => {
    const fetched = answering(206);
    const cache = new Map<string, { file?: string }>();
    expect(await liveCacheHit(cache, "k", fileOf)).toBeUndefined();
    expect(fetched).not.toHaveBeenCalled();
  });
});
