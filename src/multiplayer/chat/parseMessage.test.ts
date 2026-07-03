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
});
