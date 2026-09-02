/**
 * `WheelCoalescer` in isolation from three.js and the DOM (issue #2341): a
 * burst of pushes should fold into one summed sample, schedule exactly one
 * flush per frame, and remember the latest pointer position rather than the
 * first.
 */

import { describe, expect, it } from "vitest";

import { WheelCoalescer } from "./wheelCoalescer";

describe("WheelCoalescer", () => {
  it("says nothing is pending before any push", () => {
    const c = new WheelCoalescer();
    expect(c.take()).toBeNull();
  });

  it("asks the caller to schedule a flush on the first push into an empty frame", () => {
    const c = new WheelCoalescer();
    expect(
      c.push({
        deltaY: 10,
        deltaMode: 0,
        clientX: 1,
        clientY: 2,
        ctrlKey: false,
      }),
    ).toBe(true);
  });

  it("does not ask again while a flush is already pending", () => {
    const c = new WheelCoalescer();
    c.push({
      deltaY: 10,
      deltaMode: 0,
      clientX: 1,
      clientY: 2,
      ctrlKey: false,
    });
    expect(
      c.push({
        deltaY: 5,
        deltaMode: 0,
        clientX: 3,
        clientY: 4,
        ctrlKey: false,
      }),
    ).toBe(false);
  });

  it("sums deltaY across every push folded into the frame", () => {
    const c = new WheelCoalescer();
    c.push({
      deltaY: 10,
      deltaMode: 0,
      clientX: 1,
      clientY: 2,
      ctrlKey: false,
    });
    c.push({ deltaY: 5, deltaMode: 0, clientX: 3, clientY: 4, ctrlKey: false });
    c.push({
      deltaY: -2,
      deltaMode: 0,
      clientX: 5,
      clientY: 6,
      ctrlKey: false,
    });
    expect(c.take()?.deltaY).toBe(13);
  });

  it("keeps the latest pointer position and modifier state, not the first", () => {
    const c = new WheelCoalescer();
    c.push({
      deltaY: 10,
      deltaMode: 0,
      clientX: 1,
      clientY: 2,
      ctrlKey: false,
    });
    c.push({
      deltaY: 5,
      deltaMode: 1,
      clientX: 30,
      clientY: 40,
      ctrlKey: true,
    });
    expect(c.take()).toEqual({
      deltaY: 15,
      deltaMode: 1,
      clientX: 30,
      clientY: 40,
      ctrlKey: true,
    });
  });

  it("clears on take, so a second take without a push returns null", () => {
    const c = new WheelCoalescer();
    c.push({
      deltaY: 10,
      deltaMode: 0,
      clientX: 1,
      clientY: 2,
      ctrlKey: false,
    });
    c.take();
    expect(c.take()).toBeNull();
  });

  it("asks to schedule again after a take empties the frame", () => {
    const c = new WheelCoalescer();
    c.push({
      deltaY: 10,
      deltaMode: 0,
      clientX: 1,
      clientY: 2,
      ctrlKey: false,
    });
    c.take();
    expect(
      c.push({
        deltaY: 3,
        deltaMode: 0,
        clientX: 9,
        clientY: 9,
        ctrlKey: false,
      }),
    ).toBe(true);
  });
});
