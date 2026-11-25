import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  forgetLinkCards,
  heldLinkCard,
  hubLinkCard,
  hubLinkCardUrl,
  readLinkCardBody,
} from "./linkCard";

const HUB = "https://hub.coilbox.org";
const PICTURE = `${HUB}/api/v1/links/image?url=x&sig=y`;

const card = (overrides: Record<string, unknown> = {}) => ({
  card: {
    url: "https://example.com/page",
    type: null,
    site_name: "Example",
    title: "A page",
    description: "About the page",
    image: PICTURE,
    ...overrides,
  },
});

describe("hubLinkCardUrl", () => {
  it("encodes the link and keeps a path prefix", () => {
    expect(
      hubLinkCardUrl("https://hub.test/base/", "https://a.test/?q=1&r=2"),
    ).toBe(
      "https://hub.test/base/api/v1/links/card?url=https%3A%2F%2Fa.test%2F%3Fq%3D1%26r%3D2",
    );
  });
});

describe("readLinkCardBody", () => {
  it("reads a card", () => {
    expect(readLinkCardBody(card(), HUB)).toEqual({
      title: "A page",
      siteName: "Example",
      description: "About the page",
      image: PICTURE,
    });
  });

  it("reads no card as null", () => {
    expect(readLinkCardBody({ card: null }, HUB)).toBeNull();
  });

  it("reads a card with no title as no card", () => {
    expect(readLinkCardBody(card({ title: "" }), HUB)).toBeNull();
  });

  it("drops a picture that is not on the hub", () => {
    const read = readLinkCardBody(
      card({ image: "https://example.com/og.png" }),
      HUB,
    );
    expect(read?.image).toBeNull();
  });

  it("refuses a body that is not the card endpoint's", () => {
    expect(readLinkCardBody({ error: "nope" }, HUB)).toBeUndefined();
    expect(readLinkCardBody("card", HUB)).toBeUndefined();
  });
});

describe("hubLinkCard", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    forgetLinkCards();
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  const answer = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(body), { status }),
    );

  it("asks once for the same link, a fragment apart", async () => {
    answer(card());
    const first = await hubLinkCard(HUB, "https://example.com/page#top");
    const second = await hubLinkCard(HUB, "https://example.com/page");
    expect(first?.title).toBe("A page");
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(heldLinkCard(HUB, "https://example.com/page")).toEqual(first);
  });

  it("remembers no card as an answer", async () => {
    answer({ card: null });
    expect(await hubLinkCard(HUB, "https://example.com/")).toBeNull();
    expect(await hubLinkCard(HUB, "https://example.com/")).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("does not remember a refusal or a failed request", async () => {
    answer({ error: "slow down" }, 429);
    fetchMock.mockRejectedValueOnce(new TypeError("offline"));
    answer(card());
    expect(await hubLinkCard(HUB, "https://example.com/")).toBeNull();
    expect(heldLinkCard(HUB, "https://example.com/")).toBeUndefined();
    expect(await hubLinkCard(HUB, "https://example.com/")).toBeNull();
    expect((await hubLinkCard(HUB, "https://example.com/"))?.title).toBe(
      "A page",
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
