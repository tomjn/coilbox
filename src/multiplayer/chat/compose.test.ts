import { describe, expect, it } from "vitest";
import { composeDraft, MAX_COMPOSE_LINES } from "./compose";

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => `l${i}`).join("\n");

describe("composeDraft", () => {
  it("sends a single-line draft as one line", () => {
    expect(composeDraft("hello")).toEqual({ kind: "send", lines: ["hello"] });
  });

  it("has nothing to send for a blank draft", () => {
    expect(composeDraft("")).toEqual({ kind: "send", lines: [] });
    expect(composeDraft("  \n \n ")).toEqual({ kind: "send", lines: [] });
  });

  it("splits a multi-line draft into one line each, in order", () => {
    expect(composeDraft("one\ntwo\nthree")).toEqual({
      kind: "send",
      lines: ["one", "two", "three"],
    });
  });

  it("trims each line", () => {
    expect(composeDraft("  one  \n\ttwo\t")).toEqual({
      kind: "send",
      lines: ["one", "two"],
    });
  });

  it("drops interior blank lines", () => {
    expect(composeDraft("one\n\n\ntwo")).toEqual({
      kind: "send",
      lines: ["one", "two"],
    });
  });

  it("ignores a trailing newline", () => {
    expect(composeDraft("one\n")).toEqual({ kind: "send", lines: ["one"] });
  });

  it("accepts exactly the line cap", () => {
    const out = composeDraft(lines(MAX_COMPOSE_LINES));
    expect(out).toMatchObject({ kind: "send" });
    expect(out.kind === "send" && out.lines).toHaveLength(MAX_COMPOSE_LINES);
  });

  it("refuses one line past the cap, with a reason", () => {
    const out = composeDraft(lines(MAX_COMPOSE_LINES + 1));
    expect(out.kind).toBe("error");
    expect(out.kind === "error" && out.reason).toContain(
      String(MAX_COMPOSE_LINES),
    );
  });

  it("counts lines after blanks are dropped", () => {
    // 10 lines of text separated by blanks is still a 10-line message.
    const padded = Array.from({ length: MAX_COMPOSE_LINES }, (_, i) => `l${i}`)
      .join("\n\n")
      .concat("\n\n");
    expect(composeDraft(padded)).toMatchObject({ kind: "send" });
  });

  it("sends an emote as one line without splitting", () => {
    expect(composeDraft("/me waves")).toEqual({
      kind: "send",
      lines: ["/me waves"],
    });
  });

  it("refuses a multi-line emote", () => {
    expect(composeDraft("/me waves\nand grins")).toMatchObject({
      kind: "error",
    });
  });

  it("does not treat a word starting with /me as an emote", () => {
    expect(composeDraft("/method\nfoo")).toEqual({
      kind: "send",
      lines: ["/method", "foo"],
    });
  });

  it("has no character limit unless one is given", () => {
    expect(composeDraft("a".repeat(5000))).toMatchObject({ kind: "send" });
  });

  it("accepts a line exactly at the character limit", () => {
    expect(composeDraft("a".repeat(512), 512)).toEqual({
      kind: "send",
      lines: ["a".repeat(512)],
    });
  });

  it("refuses a line past the character limit, saying by how much", () => {
    const out = composeDraft("a".repeat(513), 512);
    expect(out.kind).toBe("error");
    expect(out.kind === "error" && out.reason).toContain("512");
    expect(out.kind === "error" && out.reason).toContain("513");
  });

  it("counts characters rather than bytes", () => {
    // Four bytes each, so 512 of them is 2048 bytes and still one message.
    expect(composeDraft("🙂".repeat(512), 512)).toMatchObject({ kind: "send" });
    expect(composeDraft("🙂".repeat(513), 512)).toMatchObject({ kind: "error" });
  });

  it("applies the limit per line, because each line is its own message", () => {
    expect(composeDraft(`short\n${"a".repeat(600)}`, 512)).toMatchObject({
      kind: "error",
    });
    expect(composeDraft("short\nalso short", 512)).toMatchObject({
      kind: "send",
    });
  });

  it("refuses an emote past the character limit", () => {
    expect(composeDraft(`/me ${"a".repeat(600)}`, 512)).toMatchObject({
      kind: "error",
    });
  });
});
