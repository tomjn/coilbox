// @vitest-environment happy-dom

/**
 * The frame rate label (issue #4071) counts display frames in which a view
 * drew, not render calls, and leaves the host as it found it.
 *
 * Animation frames are driven by hand so each test says exactly how many
 * frames passed and how long they took.
 */

import type * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { showFrameRates } from "./frameRate";
import { registerCanvas3D } from "./renderStats";

let queued: FrameRequestCallback | null = null;
let clock = 0;

/** Run one animation frame `ms` after the last. */
function frame(ms: number) {
  clock += ms;
  const run = queued;
  queued = null;
  run?.(clock);
}

function fakeView() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const info = { render: { frame: 0 } };
  const renderer = { info } as unknown as THREE.WebGLRenderer;
  const stop = registerCanvas3D({ renderer, render: () => {}, host });
  return { host, info, stop };
}

const label = (host: HTMLElement) => host.lastElementChild?.textContent;

beforeEach(() => {
  clock = 0;
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    queued = cb;
    return 1;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    queued = null;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("showFrameRates", () => {
  it("counts a frame with many render calls in it once", () => {
    const view = fakeView();
    const hide = showFrameRates();
    frame(0);
    // Ten display frames a second, each with five render calls.
    for (let i = 0; i < 10; i++) {
      view.info.render.frame += 5;
      frame(100);
    }
    expect(label(view.host)).toBe("10fps");
    hide();
    view.stop();
  });

  it("reads 0fps for a view that did not draw", () => {
    const view = fakeView();
    const hide = showFrameRates();
    frame(0);
    for (let i = 0; i < 10; i++) frame(100);
    expect(label(view.host)).toBe("0fps");
    hide();
    view.stop();
  });

  it("removes the label and puts the host's position back", () => {
    // happy-dom leaves `position` empty where a browser answers "static".
    vi.stubGlobal("getComputedStyle", () => ({ position: "static" }));
    const view = fakeView();
    const hide = showFrameRates();
    frame(0);
    frame(1000);
    expect(view.host.style.position).toBe("relative");
    expect(view.host.childElementCount).toBe(1);
    hide();
    expect(view.host.style.position).toBe("");
    expect(view.host.childElementCount).toBe(0);
    view.stop();
  });

  it("drops the label of a view that closed", () => {
    const view = fakeView();
    const hide = showFrameRates();
    frame(0);
    frame(1000);
    view.stop();
    frame(16);
    expect(view.host.childElementCount).toBe(0);
    hide();
  });
});
