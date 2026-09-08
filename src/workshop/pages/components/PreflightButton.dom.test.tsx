// @vitest-environment happy-dom
/**
 * What the preflight button says and shows (issue #1276).
 *
 * The checks themselves are Rust, tested in
 * `crates/tauri-plugin-coilbox-workshop/src/preflight.rs`. What is left here
 * is what a person sees: the button carries a count that says which of the
 * three lists matters most, and the drawer keeps them apart rather than
 * folding a blocker and a review item into one undifferentiated list.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let response: unknown = { blockers: [], review: [], passes: [] };
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    (_plugin: string, command: string) => async (_args: unknown) => {
      if (command === "workshop_preflight") return response;
      throw new Error(`unexpected command ${command}`);
    },
}));

import type { ModProject } from "../../project";
import { PreflightButton } from "./PreflightButton";

const project: ModProject = {
  id: "p1",
  name: "Faster commanders",
  gameName: "Balanced Annihilation V15.9.8",
  edits: { overrides: {}, clones: {}, menus: {}, text: {}, disabled: [] },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

afterEach(cleanup);

describe("the preflight button", () => {
  it("opens on a click and shows a clean report", async () => {
    response = {
      blockers: [],
      review: [],
      passes: ["2 table chunks compile to a Lua table."],
    };
    render(<PreflightButton project={project} />);
    fireEvent.click(screen.getByRole("button", { name: /preflight/i }));
    expect(
      await screen.findByText("2 table chunks compile to a Lua table."),
    ).toBeTruthy();
  });

  it("counts blockers on the button and keeps them out of the passes group", async () => {
    response = {
      blockers: ["supercom is defined by 2 copies (first, second)."],
      review: [],
      passes: [
        "Every copy names a unit none of the project's other copies claim (1 checked).",
      ],
    };
    render(<PreflightButton project={project} />);
    fireEvent.click(screen.getByRole("button", { name: /preflight/i }));
    expect(
      await screen.findByText(
        "supercom is defined by 2 copies (first, second).",
      ),
    ).toBeTruthy();
    // The pass line is real Lua/rust output shape, present, and not confused
    // with the blocker: the whole reason the three lists stay apart.
    expect(screen.getByText(/Every copy names/)).toBeTruthy();
    // Now the button itself says what was found, for the next time it is
    // seen shut. `hidden: true` because Radix marks the trigger
    // `aria-hidden` while its own dialog is open.
    expect(
      screen.getByRole("button", { name: /1 blocker/i, hidden: true }),
    ).toBeTruthy();
  });

  it("keeps a review item out of the blockers group", async () => {
    response = {
      blockers: [],
      review: ["2 name and description edits are not compiled."],
      passes: [],
    };
    render(<PreflightButton project={project} />);
    fireEvent.click(screen.getByRole("button", { name: /preflight/i }));
    expect(
      await screen.findByText("2 name and description edits are not compiled."),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /1 to review/i, hidden: true }),
    ).toBeTruthy();
  });

  it("says so rather than showing an empty drawer for a project with no edits", async () => {
    response = { blockers: [], review: [], passes: [] };
    render(<PreflightButton project={project} />);
    fireEvent.click(screen.getByRole("button", { name: /preflight/i }));
    expect(
      await screen.findByText(
        "This project changes nothing yet, so there is nothing to check.",
      ),
    ).toBeTruthy();
  });

  it("reports a preflight check that could not run", async () => {
    response = Promise.reject(new Error("command not found"));
    render(<PreflightButton project={project} />);
    fireEvent.click(screen.getByRole("button", { name: /preflight/i }));
    expect(
      await screen.findByText(
        /The preflight check could not run: command not found/,
      ),
    ).toBeTruthy();
  });
});
