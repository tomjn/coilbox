import { describe, expect, it } from "vitest";
import { isDuplicateKey, isTestKey, modeDigit } from "./shortcuts";

const key = (
  k: string,
  mods: Partial<Pick<KeyboardEvent, "metaKey" | "ctrlKey" | "shiftKey">> = {},
) => ({ key: k, metaKey: false, ctrlKey: false, shiftKey: false, ...mods });

describe("isTestKey", () => {
  it("fires on Cmd Enter and Ctrl Enter", () => {
    expect(isTestKey(key("Enter", { metaKey: true }))).toBe(true);
    expect(isTestKey(key("Enter", { ctrlKey: true }))).toBe(true);
  });

  it("does not fire without the modifier, or with Shift added", () => {
    expect(isTestKey(key("Enter"))).toBe(false);
    expect(isTestKey(key("Enter", { metaKey: true, shiftKey: true }))).toBe(
      false,
    );
  });

  it("does not fire on a different key", () => {
    expect(isTestKey(key("d", { metaKey: true }))).toBe(false);
  });
});

describe("isDuplicateKey", () => {
  it("fires on Cmd D and Ctrl D", () => {
    expect(isDuplicateKey(key("d", { metaKey: true }))).toBe(true);
    expect(isDuplicateKey(key("D", { ctrlKey: true }))).toBe(true);
  });

  it("does not fire without the modifier, or with Shift added", () => {
    expect(isDuplicateKey(key("d"))).toBe(false);
    expect(isDuplicateKey(key("d", { metaKey: true, shiftKey: true }))).toBe(
      false,
    );
  });
});

describe("modeDigit", () => {
  it("reads 1 to 9 as mode indexes 0 to 8", () => {
    expect(modeDigit(key("1"))).toBe(0);
    expect(modeDigit(key("9"))).toBe(8);
    expect(modeDigit(key("3"))).toBe(2);
  });

  /**
   * Every digit there is, rather than as many as the rail currently holds. The
   * caller drops an index past the end of the mode list, so a mode added to the
   * rail works from its key without this being edited too. Adding a seventh is
   * what found the old cap of six.
   */
  it("is null outside 1 to 9, and for anything that is not a digit", () => {
    expect(modeDigit(key("0"))).toBeNull();
    expect(modeDigit(key("a"))).toBeNull();
    expect(modeDigit(key("Enter"))).toBeNull();
  });

  it("declines a digit carrying Cmd or Ctrl, so that combination is left alone", () => {
    expect(modeDigit(key("1", { metaKey: true }))).toBeNull();
    expect(modeDigit(key("1", { ctrlKey: true }))).toBeNull();
  });

  it("reads a shifted digit the same as an unshifted one", () => {
    // On a layout where Shift is what produces the digit, `event.key` already
    // reads as the digit itself (mapKeys.ts takes "." and its shifted ">" the
    // same way), so this is not declined the way a Cmd or Ctrl combination is.
    expect(modeDigit(key("1", { shiftKey: true }))).toBe(0);
  });
});
