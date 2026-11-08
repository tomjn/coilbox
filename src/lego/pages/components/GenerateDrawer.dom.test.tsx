// @vitest-environment happy-dom

/**
 * The generate screen (#3234): the form asks for a batch from a seed, reroll
 * asks for the next seeds, and opening a candidate hands its unit to the page.
 * The generator itself is tested in `candidates.test.ts`.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BODY_PLANS } from "../../bodyPlans";
import type { CandidateBatch } from "../../candidates";
import { GENERATOR_JOBS } from "../../generate";
import type { LegoProject } from "../../model";
import { CANDIDATE_COUNT, GenerateDrawer } from "./GenerateDrawer";

const generateCandidates = vi.fn();

vi.mock("../../pack", () => ({
  loadPack: () =>
    Promise.resolve({
      manifest: { id: "lego", version: "1" },
      library: { atlases: [{ tex1: "atlas.png" }] },
    }),
}));
vi.mock("../../starterModules", () => ({ starterModules: () => [] }));
vi.mock("../../geometry", () => ({ partMaterial: () => ({}) }));
vi.mock("../../candidatePictures", () => ({
  materialReady: () => true,
  drawUnitPictures: (units: LegoProject[]) =>
    units.map((u) => `data:image/png;base64,${u.id}`),
}));
vi.mock("../../candidates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../candidates")>()),
  generateCandidates: (...args: unknown[]) => generateCandidates(...args),
}));

/** A batch of `count` units from `start`, every seed used. */
function batch(start: number, count: number): CandidateBatch {
  return {
    candidates: Array.from({ length: count }, (_, i) => ({
      seed: start + i,
      unit: {
        id: `unit-${start + i}`,
        generated: {
          seed: start + i,
          plan: BODY_PLANS[0].id,
          job: GENERATOR_JOBS[0].id,
          size: "medium",
          modules: [],
        },
      } as unknown as LegoProject,
    })),
    next: start + count,
    failed: null,
  };
}

const onOpened = vi.fn();

beforeEach(() => {
  generateCandidates.mockReset();
  generateCandidates.mockImplementation(
    (_inputs: unknown, start: number, count: number) => batch(start, count),
  );
  onOpened.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function show() {
  render(<GenerateDrawer open onOpenChange={() => {}} onOpened={onOpened} />);
  const button = screen.getByRole("button", { name: "Generate" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  return button;
}

describe("GenerateDrawer", () => {
  it("generates a batch from the seed typed in", async () => {
    const generate = await show();
    fireEvent.change(screen.getByPlaceholderText("Random"), {
      target: { value: "7" },
    });
    fireEvent.click(generate);

    expect(generateCandidates).toHaveBeenCalledTimes(1);
    const [inputs, start, count] = generateCandidates.mock.calls[0];
    expect(inputs).toMatchObject({
      plan: BODY_PLANS[0],
      job: GENERATOR_JOBS[0].id,
      size: "medium",
    });
    expect(start).toBe(7);
    expect(count).toBe(CANDIDATE_COUNT);
    expect(screen.getByRole("button", { name: "Seed 7" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: `Seed ${7 + CANDIDATE_COUNT - 1}` }),
    ).toBeTruthy();
  });

  it("picks a random seed when the field is blank", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    fireEvent.click(await show());

    expect(generateCandidates.mock.calls[0][1]).toBe(500000);
  });

  it("refuses a seed that is not a whole number", async () => {
    const generate = await show();
    fireEvent.change(screen.getByPlaceholderText("Random"), {
      target: { value: "1.5" },
    });
    fireEvent.click(generate);

    expect(generateCandidates).not.toHaveBeenCalled();
    expect(screen.getByText("A seed is a whole number.")).toBeTruthy();
  });

  it("rerolls into the seeds after the last batch", async () => {
    const generate = await show();
    fireEvent.change(screen.getByPlaceholderText("Random"), {
      target: { value: "1" },
    });
    fireEvent.click(generate);
    fireEvent.click(screen.getByRole("button", { name: "Reroll" }));

    expect(generateCandidates.mock.calls[1][1]).toBe(1 + CANDIDATE_COUNT);
    expect(screen.queryByRole("button", { name: "Seed 1" })).toBeNull();
    expect(
      screen.getByRole("button", { name: `Seed ${1 + CANDIDATE_COUNT}` }),
    ).toBeTruthy();
  });

  it("rerolls with the choices that made the grid", async () => {
    const generate = await show();
    fireEvent.click(generate);
    fireEvent.click(screen.getByRole("combobox", { name: "Size" }));
    fireEvent.click(await screen.findByRole("option", { name: "Large" }));
    fireEvent.click(screen.getByRole("button", { name: "Reroll" }));

    expect(generateCandidates.mock.calls[1][0]).toMatchObject({
      size: "medium",
    });
  });

  it("shows each candidate's picture", async () => {
    const generate = await show();
    fireEvent.change(screen.getByPlaceholderText("Random"), {
      target: { value: "9" },
    });
    fireEvent.click(generate);

    const images = document.querySelectorAll("img");
    expect(images).toHaveLength(CANDIDATE_COUNT);
    expect(images[0].getAttribute("src")).toBe("data:image/png;base64,unit-9");
  });

  it("hands the opened candidate's unit to the page", async () => {
    const generate = await show();
    fireEvent.change(screen.getByPlaceholderText("Random"), {
      target: { value: "3" },
    });
    fireEvent.click(generate);
    fireEvent.click(screen.getByRole("button", { name: "Seed 4" }));

    expect(onOpened).toHaveBeenCalledTimes(1);
    expect(onOpened.mock.calls[0][0]).toMatchObject({
      id: "unit-4",
      generated: { seed: 4 },
    });
  });

  it("says why when no seed makes a unit", async () => {
    generateCandidates.mockReturnValue({
      candidates: [],
      next: 21,
      failed: "No seed from 1 to 20 made a unit that passes the checks.",
    });
    fireEvent.click(await show());

    expect(
      screen.getByText(
        "No seed from 1 to 20 made a unit that passes the checks.",
      ),
    ).toBeTruthy();
  });
});
