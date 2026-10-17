// @vitest-environment happy-dom

/**
 * The module update offer (issue #3304). `../../moduleUpdates.test.ts` covers
 * what counts as out of date.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModuleUpdate } from "../../moduleUpdates";
import { ModuleUpdateBanner } from "./ModuleUpdateBanner";

function update(name: string, edited = 0): ModuleUpdate {
  return {
    instance: name,
    moduleId: "wheel",
    moduleName: "Wheel",
    stamp: "s",
    name,
    rootPieceId: name,
    edited,
  };
}

afterEach(cleanup);

describe("the module update banner", () => {
  it("shows nothing when nothing is out of date", () => {
    const { container } = render(
      <ModuleUpdateBanner
        updates={[]}
        onUpdate={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(container.textContent).toBe("");
  });

  it("names each instance and says how many edited pieces an update resets", () => {
    render(
      <ModuleUpdateBanner
        updates={[update("front", 2), update("back")]}
        onUpdate={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(
      screen.getByText(/2 parts of this unit use an older module/),
    ).toBeTruthy();
    expect(
      screen.getByText(
        /front uses an older Wheel. Update resets 2 edited pieces./,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/back uses an older Wheel\.$/)).toBeTruthy();
  });

  it("updates only the instance whose button is pressed", () => {
    const onUpdate = vi.fn();
    render(
      <ModuleUpdateBanner
        updates={[update("front"), update("back")]}
        onUpdate={onUpdate}
        onDismiss={vi.fn()}
      />,
    );
    expect(onUpdate).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: "Update" })[1]);
    expect(onUpdate).toHaveBeenCalledTimes(1);
    expect(onUpdate.mock.calls[0][0].name).toBe("back");
  });

  it("dismisses without updating", () => {
    const onUpdate = vi.fn();
    const onDismiss = vi.fn();
    render(
      <ModuleUpdateBanner
        updates={[update("front")]}
        onUpdate={onUpdate}
        onDismiss={onDismiss}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(onDismiss).toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
