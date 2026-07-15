import { describe, expect, it } from "vitest";
import { parseMessage } from "./parseMessage";

describe("parseMessage", () => {
  it("returns a single text token for plain text", () => {
    expect(parseMessage("hello world")).toEqual([
      { type: "text", value: "hello world" },
    ]);
  });

  it("highlights only a leading command token", () => {
    expect(parseMessage("!start now")).toEqual([
      { type: "command", value: "!start" },
      { type: "text", value: " now" },
    ]);
  });

  it("does not treat a mid-text ! as a command", () => {
    expect(parseMessage("no way !nope")).toEqual([
      { type: "text", value: "no way !nope" },
    ]);
  });

  it("parses inline code and ignores markers inside it", () => {
    expect(parseMessage("run `!foo *bar*` please")).toEqual([
      { type: "text", value: "run " },
      { type: "code", value: "!foo *bar*" },
      { type: "text", value: " please" },
    ]);
  });

  it("leaves an unclosed backtick as literal text", () => {
    expect(parseMessage("a ` b")).toEqual([{ type: "text", value: "a ` b" }]);
  });

  it("auto-links a bare URL", () => {
    expect(parseMessage("see https://example.com yo")).toEqual([
      { type: "text", value: "see " },
      { type: "url", value: "https://example.com" },
      { type: "text", value: " yo" },
    ]);
  });

  it("trims trailing sentence punctuation off a URL", () => {
    expect(parseMessage("go https://example.com.")).toEqual([
      { type: "text", value: "go " },
      { type: "url", value: "https://example.com" },
      { type: "text", value: "." },
    ]);
  });

  it("parses bold and both italic markers, stripping the markers", () => {
    expect(parseMessage("a **b** c *d* e _f_")).toEqual([
      { type: "text", value: "a " },
      { type: "bold", children: [{ type: "text", value: "b" }] },
      { type: "text", value: " c " },
      { type: "italic", children: [{ type: "text", value: "d" }] },
      { type: "text", value: " e " },
      { type: "italic", children: [{ type: "text", value: "f" }] },
    ]);
  });

  it("nests italic inside bold", () => {
    expect(parseMessage("**_x_**")).toEqual([
      {
        type: "bold",
        children: [
          { type: "italic", children: [{ type: "text", value: "x" }] },
        ],
      },
    ]);
  });

  it("leaves a lone asterisk as literal text", () => {
    expect(parseMessage("2 * 3")).toEqual([{ type: "text", value: "2 * 3" }]);
  });

  it("wraps a leading > line in a quote token", () => {
    expect(parseMessage("> hello")).toEqual([
      { type: "quote", children: [{ type: "text", value: "hello" }] },
    ]);
  });

  it("keeps inline formatting inside a quote", () => {
    expect(parseMessage("> a **b**")).toEqual([
      {
        type: "quote",
        children: [
          { type: "text", value: "a " },
          { type: "bold", children: [{ type: "text", value: "b" }] },
        ],
      },
    ]);
  });

  it("does not treat a mid-line > as a quote", () => {
    expect(parseMessage("2 > 1")).toEqual([{ type: "text", value: "2 > 1" }]);
  });

  it("groups consecutive quote lines into one quote token", () => {
    expect(parseMessage("> one\n> two")).toEqual([
      {
        type: "quote",
        children: [{ type: "text", value: "one\ntwo" }],
      },
    ]);
  });

  it("tokenizes a leading @mention", () => {
    expect(parseMessage("@bob hi")).toEqual([
      { type: "mention", value: "bob" },
      { type: "text", value: " hi" },
    ]);
  });

  it("tokenizes an @mention after text", () => {
    expect(parseMessage("hey @bob")).toEqual([
      { type: "text", value: "hey " },
      { type: "mention", value: "bob" },
    ]);
  });

  it("keeps clan-tag characters in a mention", () => {
    expect(parseMessage("@[ABC]bob go")).toEqual([
      { type: "mention", value: "[ABC]bob" },
      { type: "text", value: " go" },
    ]);
  });

  it("does not treat an email local part as a mention", () => {
    expect(parseMessage("mail a@b.com")).toEqual([
      { type: "text", value: "mail a@b.com" },
    ]);
  });

  it("parses a mention inside bold", () => {
    expect(parseMessage("**@bob**")).toEqual([
      { type: "bold", children: [{ type: "mention", value: "bob" }] },
    ]);
  });
});
