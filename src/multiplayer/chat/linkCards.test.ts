import { expect, it } from "vitest";
import { buildMapLink } from "../../deeplink/build";
import { linkCardFor, linkCardsIn, mapNameForSlug, mapSlug } from "./linkCards";

const ID = "dQw4w9WgXcQ";
const THUMB = `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`;

it.each([
  `https://www.youtube.com/watch?v=${ID}`,
  `https://youtube.com/watch?v=${ID}&t=42`,
  `https://m.youtube.com/watch?v=${ID}`,
  `https://music.youtube.com/watch?v=${ID}`,
  `https://youtu.be/${ID}`,
  `https://youtu.be/${ID}?si=abc`,
  `https://www.youtube.com/shorts/${ID}`,
  `https://www.youtube.com/live/${ID}`,
  `https://www.youtube.com/embed/${ID}`,
  `http://www.youtube.com/watch?v=${ID}`,
])("gives %s a YouTube card with the fixed thumbnail path", (href) => {
  expect(linkCardFor(href)).toEqual({
    site: "YouTube",
    url: href,
    thumbnail: THUMB,
  });
});

it.each([
  "https://example.com/watch?v=dQw4w9WgXcQ",
  "https://notyoutube.com/watch?v=dQw4w9WgXcQ",
  "https://youtube.com.evil.example/watch?v=dQw4w9WgXcQ",
  "https://www.youtube.com/",
  "https://www.youtube.com/@somechannel",
  "https://www.youtube.com/watch",
  "https://www.youtube.com/watch?v=short",
  "https://www.youtube.com/watch?v=has/slash-1",
  "https://youtu.be/",
  "coilbox://join/abc",
  "not a url",
])("gives %s no card", (href) => {
  expect(linkCardFor(href)).toBeNull();
});

it("finds a link in the middle of a sentence, past trailing punctuation", () => {
  expect(linkCardsIn(`watch this https://youtu.be/${ID}, it is good`)).toEqual([
    { site: "YouTube", url: `https://youtu.be/${ID}`, thumbnail: THUMB },
  ]);
});

it("finds a link inside a quote and a list", () => {
  const url = `https://youtu.be/${ID}`;
  expect(linkCardsIn(`> ${url}`)).toHaveLength(1);
  expect(linkCardsIn(`- one\n- ${url}`)).toHaveLength(1);
});

it("gives no card for a link in a code span or a code block", () => {
  const url = `https://youtu.be/${ID}`;
  expect(linkCardsIn(`\`${url}\``)).toEqual([]);
  expect(linkCardsIn(`\`\`\`\n${url}\n\`\`\``)).toEqual([]);
});

it("gives no card for an ordinary link or a message with no link", () => {
  expect(linkCardsIn("see https://example.com/page")).toEqual([]);
  expect(linkCardsIn("hello")).toEqual([]);
});

it("keeps to one card per message, the first known link", () => {
  const cards = linkCardsIn(
    `https://example.com https://youtu.be/${ID} https://youtu.be/aaaaaaaaaaa https://youtu.be/${ID}`,
  );
  expect(cards.map((c) => c.url)).toEqual([`https://youtu.be/${ID}`]);
});

const HUB = "https://hub.example";

it("reads a coilbox map link as the map's exact name", () => {
  const href = buildMapLink("Comet Catcher Redux v1.8") as string;
  expect(linkCardsIn(`try ${href}`)).toEqual([
    {
      site: "Coilbox",
      url: href,
      map: { kind: "name", name: "Comet Catcher Redux v1.8" },
    },
  ]);
});

it("keeps a final dot of a map name through chat's trailing punctuation rule", () => {
  const href = buildMapLink("Odd Map v1.") as string;
  expect(linkCardsIn(`try ${href}`)[0]).toMatchObject({
    map: { kind: "name", name: "Odd Map v1." },
  });
});

it.each([
  "coilbox://open?screen=game&id=Comet",
  "coilbox://open?screen=map",
  "coilbox://open?screen=battles",
])("gives %s no card", (href) => {
  expect(linkCardFor(href)).toBeNull();
});

it("recognises a map page on the trusted hub only", () => {
  expect(linkCardFor(`${HUB}/map/comet-catcher-1-8`, HUB)).toEqual({
    site: "Coilbox Hub",
    url: `${HUB}/map/comet-catcher-1-8`,
    map: { kind: "slug", slug: "comet-catcher-1-8", anyVersion: false },
  });
  expect(linkCardFor(`${HUB}/map/comet-catcher-1-8`, null)).toBeNull();
  expect(linkCardFor(`${HUB}.evil.test/map/comet`, HUB)).toBeNull();
  expect(linkCardFor(`${HUB}/maps`, HUB)).toBeNull();
  expect(linkCardFor(`${HUB}/map/a/b`, HUB)).toBeNull();
});

it("recognises Beyond All Reason's map pages with no hub set", () => {
  expect(
    linkCardFor("https://www.beyondallreason.info/map/supreme-isthmus"),
  ).toEqual({
    site: "Beyond All Reason",
    url: "https://www.beyondallreason.info/map/supreme-isthmus",
    map: { kind: "slug", slug: "supreme-isthmus", anyVersion: true },
  });
  expect(linkCardFor("https://www.beyondallreason.info/maps")).toBeNull();
  expect(
    linkCardFor("https://beyondallreason.info.evil.test/map/a"),
  ).toBeNull();
});

it("slugs a map name the way the hub does", () => {
  expect(mapSlug("Comet_Catcher 1.8")).toBe("comet-catcher-1-8");
  expect(mapSlug("  !!  ")).toBe("map");
});

it("matches a hub slug exactly and a BAR slug to the newest version", () => {
  const names = [
    "Supreme Isthmus v2",
    "Supreme Isthmus v10",
    "Comet Catcher 1.8",
  ];
  const hub = { kind: "slug", anyVersion: false } as const;
  const bar = { kind: "slug", anyVersion: true } as const;
  expect(mapNameForSlug({ ...hub, slug: "comet-catcher-1-8" }, names)).toBe(
    "Comet Catcher 1.8",
  );
  expect(mapNameForSlug({ ...hub, slug: "supreme-isthmus" }, names)).toBeNull();
  expect(mapNameForSlug({ ...bar, slug: "supreme-isthmus" }, names)).toBe(
    "Supreme Isthmus v10",
  );
  expect(mapNameForSlug({ ...bar, slug: "nowhere" }, names)).toBeNull();
});
