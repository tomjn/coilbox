// @vitest-environment happy-dom

/**
 * The axis compass in the top right of the viewport: six axis ends that turn
 * the camera to a view, and a middle that resets it.
 */

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as THREE from "three";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AxisCompass, paintCompass } from "./AxisCompass";
import { COMPASS_ENDS } from "./compassLayout";

afterEach(cleanup);

function compass(overrides: Partial<Parameters<typeof AxisCompass>[0]> = {}) {
  const props = {
    compassRef: { current: null },
    view: null,
    onView: vi.fn(),
    onResetView: vi.fn(),
    ...overrides,
  };
  render(<AxisCompass {...props} />);
  return props;
}

function ends() {
  return screen.getAllByRole("button", { name: /perspective/ });
}

describe("the axis ends", () => {
  it("are six buttons, each named for the view it looks from", () => {
    compass();
    expect(ends().map((end) => end.getAttribute("aria-label"))).toEqual([
      "X: look at the side with no perspective (2)",
      "Minus X: look at the other side with no perspective",
      "Y: look at the top with no perspective (3)",
      "Minus Y: look at the bottom with no perspective",
      "Z: look at the front with no perspective (1)",
      "Minus Z: look at the back with no perspective",
    ]);
  });

  it.each(
    COMPASS_ENDS.map((end) => [end.id, end.view] as const),
  )("asks for the %s end's view, %s, when it is pressed", (id, view) => {
    const { onView } = compass();
    fireEvent.click(document.querySelector(`[data-end="${id}"]`) as Element);
    expect(onView).toHaveBeenCalledExactlyOnceWith(view);
  });

  it("can all be reached with Tab, in the order of the axes, before the middle", () => {
    compass();
    for (const end of ends()) {
      expect(end.tagName).toBe("BUTTON");
      expect(end.getAttribute("tabindex")).not.toBe("-1");
      expect(end.hasAttribute("disabled")).toBe(false);
    }
    const all = screen.getAllByRole("button");
    expect(all.at(-1)?.getAttribute("aria-label")).toBe("Reset the view");
    act(() => ends()[0].focus());
    expect(document.activeElement).toBe(ends()[0]);
  });

  it("show a focus ring when focused from the keyboard", () => {
    compass();
    for (const end of ends()) {
      expect(end.className).toContain("focus-visible:");
    }
  });

  it("marks the view the camera is in", () => {
    compass({ view: "bottom" });
    const current = ends().filter((end) => end.hasAttribute("aria-current"));
    expect(current.map((end) => end.getAttribute("data-end"))).toEqual(["y-"]);
  });
});

describe("the middle", () => {
  it("resets the view", () => {
    const { onResetView, onView } = compass();
    fireEvent.click(screen.getByRole("button", { name: "Reset the view" }));
    expect(onResetView).toHaveBeenCalledOnce();
    expect(onView).not.toHaveBeenCalled();
  });
});

describe("paintCompass", () => {
  function painted(position: [number, number, number]) {
    const ref = { current: null as HTMLFieldSetElement | null };
    compass({ compassRef: ref });
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    camera.position.set(...position);
    camera.up.set(0, 1, 0);
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld(true);
    paintCompass(ref.current as HTMLFieldSetElement, camera);
    const at = (id: string) => {
      const button = document.querySelector(
        `[data-end="${id}"]`,
      ) as HTMLElement;
      return [
        Number.parseFloat(button.style.left),
        Number.parseFloat(button.style.top),
      ];
    };
    return at;
  }

  it("puts +x to the right and +y above the middle from the front", () => {
    const at = painted([0, 0, 5]);
    expect(at("x+")[0]).toBeGreaterThan(56);
    expect(at("y+")[1]).toBeLessThan(56);
  });

  it("keeps every end clear of the middle button, even looking along an axis", () => {
    for (const position of [
      [0, 0, 5],
      [0, 0, -5],
      [5, 0, 0],
      [-5, 0, 0],
      [0, 5, 0.0005],
      [0, -5, 0.0005],
    ] as [number, number, number][]) {
      const at = painted(position);
      for (const end of COMPASS_ENDS) {
        const [x, y] = at(end.id);
        expect(Math.hypot(x - 56, y - 56)).toBeGreaterThanOrEqual(24 - 1e-6);
      }
      cleanup();
    }
  });
});
