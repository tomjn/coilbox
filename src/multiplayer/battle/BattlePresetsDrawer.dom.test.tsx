// @vitest-environment happy-dom

/**
 * The half of issue #2761 that lives in the UI rather than in `runDelivery`
 * itself: loading a preset into a battle we founded is one batched write with
 * nothing to watch, so the sheet closes the way it always did, but loading one
 * into a SPADS battle is now a paced run over real seconds, and the sheet has
 * to say so rather than close on a load that has barely started.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BattlePresetsDrawer } from "./BattlePresetsDrawer";
import type { BattlePreset } from "./battlePresets";
import type { DeliveryProgress, TweakSlot } from "./tweakDelivery";
import type { TweakDelivery } from "./useTweakDelivery";

afterEach(cleanup);

const preset = (over: Partial<BattlePreset> = {}): BattlePreset => ({
  id: "p1",
  name: "My preset",
  gameName: "Balanced Annihilation V12",
  scriptTags: { "game/modoptions/maxunits": "1000" },
  createdAt: "",
  lastUsedAt: "",
  ...over,
});

const idleDelivery = (): TweakDelivery => ({
  progress: null,
  running: false,
  start: vi.fn(async () => {}),
  cancel: vi.fn(),
  clear: vi.fn(),
});

const slot = (over: Partial<TweakSlot> = {}): TweakSlot => ({
  name: "maxunits",
  value: "1000",
  tagKey: "game/modoptions/maxunits",
  bytes: 20,
  ...over,
});

function renderDrawer(
  over: Partial<Parameters<typeof BattlePresetsDrawer>[0]> = {},
) {
  const onOpenChange = vi.fn();
  const onLoad = vi.fn();
  render(
    <BattlePresetsDrawer
      open={true}
      onOpenChange={onOpenChange}
      gameName="Balanced Annihilation V12"
      presets={[preset()]}
      optionCount={1}
      onSave={vi.fn()}
      onLoad={onLoad}
      onDelete={vi.fn()}
      onSetDefault={vi.fn()}
      isFounder={true}
      delivery={idleDelivery()}
      {...over}
    />,
  );
  return { onOpenChange, onLoad };
}

describe("loading a preset as the founder", () => {
  it("closes the sheet the same as it always did", () => {
    const { onOpenChange, onLoad } = renderDrawer({ isFounder: true });

    fireEvent.click(screen.getByText("My preset"));

    expect(onLoad).toHaveBeenCalledWith(preset());
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("loading a preset into a SPADS battle", () => {
  it("leaves the sheet open rather than closing on a run that just started", () => {
    const { onOpenChange, onLoad } = renderDrawer({ isFounder: false });

    fireEvent.click(screen.getByText("My preset"));

    expect(onLoad).toHaveBeenCalledWith(preset());
    expect(onOpenChange).not.toHaveBeenCalled();
  });

  it("shows the paced run in progress, with a way to stop it", () => {
    const cancel = vi.fn();
    const progress: DeliveryProgress = {
      slots: [{ slot: slot(), state: "confirming" }],
      done: false,
      stoppedAt: null,
    };
    renderDrawer({
      isFounder: false,
      delivery: {
        progress,
        running: true,
        start: vi.fn(async () => {}),
        cancel,
        clear: vi.fn(),
      },
    });

    expect(screen.getByText("waiting for the battle")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    expect(cancel).toHaveBeenCalled();
  });

  it("locks the other controls while a run is in flight", () => {
    const progress: DeliveryProgress = {
      slots: [{ slot: slot(), state: "sending" }],
      done: false,
      stoppedAt: null,
    };
    renderDrawer({
      isFounder: false,
      delivery: {
        progress,
        running: true,
        start: vi.fn(async () => {}),
        cancel: vi.fn(),
        clear: vi.fn(),
      },
    });

    expect(
      screen.getByRole("button", { name: /save current options/i }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: /delete preset/i }),
    ).toHaveProperty("disabled", true);
  });

  it("says which option did not land, and that a second run finishes the set", () => {
    const progress: DeliveryProgress = {
      slots: [{ slot: slot(), state: "failed", reason: "no boss here" }],
      done: true,
      stoppedAt: 0,
    };
    renderDrawer({
      isFounder: false,
      delivery: {
        progress,
        running: false,
        start: vi.fn(async () => {}),
        cancel: vi.fn(),
        clear: vi.fn(),
      },
    });

    expect(screen.getByText("no boss here")).toBeTruthy();
    expect(
      screen.getByText(/a second run only sends what is missing/i),
    ).toBeTruthy();
  });
});
