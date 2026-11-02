import { expect, it } from "vitest";
import { linkCardFor, linkCardsIn } from "./linkCards";

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
