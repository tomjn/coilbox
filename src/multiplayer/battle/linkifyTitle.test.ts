import { describe, expect, it } from "vitest";
import { linkifyTitle } from "./linkifyTitle";

describe("linkifyTitle", () => {
  it("returns plain text untouched when there is no URL", () => {
    expect(linkifyTitle("Newbie friendly FFA")).toEqual([
      { text: "Newbie friendly FFA" },
    ]);
  });

  it("links a bare https URL", () => {
    expect(linkifyTitle("https://example.com/rules")).toEqual([
      { text: "https://example.com/rules", url: "https://example.com/rules" },
    ]);
  });

  it("links a bare http URL", () => {
    expect(linkifyTitle("http://example.com")).toEqual([
      { text: "http://example.com", url: "http://example.com" },
    ]);
  });

  it("does not swallow a trailing paren that closes surrounding text", () => {
    expect(
      linkifyTitle("MC:L Testing (https://tinyurl.com/MCLpackage)"),
    ).toEqual([
      { text: "MC:L Testing (" },
      {
        text: "https://tinyurl.com/MCLpackage",
        url: "https://tinyurl.com/MCLpackage",
      },
      { text: ")" },
    ]);
  });

  it("keeps a closing paren that the URL itself opened", () => {
    expect(linkifyTitle("see https://en.wikipedia.org/wiki/Foo_(bar)")).toEqual(
      [
        { text: "see " },
        {
          text: "https://en.wikipedia.org/wiki/Foo_(bar)",
          url: "https://en.wikipedia.org/wiki/Foo_(bar)",
        },
      ],
    );
  });

  it("leaves a javascript: scheme as plain text", () => {
    expect(linkifyTitle("javascript:alert(1)")).toEqual([
      { text: "javascript:alert(1)" },
    ]);
  });

  it("leaves an ftp: scheme as plain text", () => {
    expect(linkifyTitle("ftp://example.com/file")).toEqual([
      { text: "ftp://example.com/file" },
    ]);
  });

  it("trims trailing sentence punctuation", () => {
    expect(linkifyTitle("Rules: https://example.com/rules.")).toEqual([
      { text: "Rules: " },
      { text: "https://example.com/rules", url: "https://example.com/rules" },
      { text: "." },
    ]);
  });

  it("links multiple URLs in one title", () => {
    expect(
      linkifyTitle("https://a.example.com and https://b.example.com"),
    ).toEqual([
      { text: "https://a.example.com", url: "https://a.example.com" },
      { text: " and " },
      { text: "https://b.example.com", url: "https://b.example.com" },
    ]);
  });
});
