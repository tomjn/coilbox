// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SaveCompoundPopover } from "./SaveCompoundPopover";

afterEach(cleanup);

const CHOICES = [
  { piece: "leg", connector: "+y", label: "leg, top" },
  { piece: "leg", connector: "-y", label: "leg, bottom" },
];

function open(initial: { piece: string; connector: string } | null) {
  const onSave = vi.fn();
  render(
    <SaveCompoundPopover
      disabled={false}
      options={() => ({ choices: CHOICES, initial })}
      onSave={onSave}
    />,
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Save the selection as a compound" }),
  );
  return onSave;
}

describe("SaveCompoundPopover", () => {
  it("saves with the default connector as the mount", () => {
    const onSave = open({ piece: "leg", connector: "-y" });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ piece: "leg", connector: "-y" });
  });

  it("saves with no mount when the module has no default", () => {
    const onSave = open(null);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("does not open for a disabled button", () => {
    render(
      <SaveCompoundPopover disabled options={() => null} onSave={vi.fn()} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Save the selection as a compound" }),
    );
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
