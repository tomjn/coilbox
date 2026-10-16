import { describe, expect, it } from "vitest";
import {
  clampHeight,
  GAP,
  KEY_STEP,
  maxHeight,
  stepHeight,
  TABLE_MIN,
} from "./splitLimits";

const CHAT = 352;
const TALL = 1000;

describe("maxHeight", () => {
  it("leaves the chat its minimum and the gap", () => {
    expect(maxHeight(TALL, CHAT)).toBe(TALL - GAP - CHAT);
  });

  it("never drops below the table minimum in a short window", () => {
    expect(maxHeight(400, CHAT)).toBe(TABLE_MIN);
  });
});

describe("clampHeight", () => {
  it("raises a height below the minimum", () => {
    expect(clampHeight(10, TALL, CHAT)).toBe(TABLE_MIN);
  });

  it("lowers a height that would push the chat below its minimum", () => {
    expect(clampHeight(5000, TALL, CHAT)).toBe(maxHeight(TALL, CHAT));
  });

  it("leaves a height inside the range alone", () => {
    expect(clampHeight(300, TALL, CHAT)).toBe(300);
  });

  it("brings a stored height inside a window that is now shorter", () => {
    expect(clampHeight(600, 700, CHAT)).toBe(maxHeight(700, CHAT));
  });

  it("applies only the minimum before the column is measured", () => {
    expect(clampHeight(5000, 0, CHAT)).toBe(5000);
    expect(clampHeight(10, 0, CHAT)).toBe(TABLE_MIN);
  });

  it("gives the minimum for a value that is not a number", () => {
    expect(clampHeight(Number.NaN, TALL, CHAT)).toBe(TABLE_MIN);
  });
});

describe("stepHeight", () => {
  it("shortens the table on the up arrow and lengthens it on the down arrow", () => {
    expect(stepHeight(300, "ArrowUp", TALL, CHAT)).toBe(300 - KEY_STEP);
    expect(stepHeight(300, "ArrowDown", TALL, CHAT)).toBe(300 + KEY_STEP);
  });

  it("stops at the minimum", () => {
    expect(stepHeight(TABLE_MIN + 5, "ArrowUp", TALL, CHAT)).toBe(TABLE_MIN);
  });

  it("stops at the maximum", () => {
    const max = maxHeight(TALL, CHAT);
    expect(stepHeight(max - 5, "ArrowDown", TALL, CHAT)).toBe(max);
  });

  it("jumps to either end on Home and End", () => {
    expect(stepHeight(300, "Home", TALL, CHAT)).toBe(TABLE_MIN);
    expect(stepHeight(300, "End", TALL, CHAT)).toBe(maxHeight(TALL, CHAT));
  });

  it("ignores other keys", () => {
    expect(stepHeight(300, "a", TALL, CHAT)).toBeNull();
  });
});
