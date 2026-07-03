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
});
