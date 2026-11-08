// @vitest-environment happy-dom

/**
 * The roster screen (#3239): the form asks for a roster, the units show a row
 * per job, Reroll asks again from the next seed, and Save hands every unit to
 * the page. The roster itself is tested in `roster.test.ts`.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installSettingsStorage,
  memorySettingsStorage,
} from "@/lib/storedSetting";
import { BODY_PLANS } from "../../bodyPlans";
import { GENERATOR_JOBS } from "../../generate";
import type { LegoProject } from "../../model";
import type { RosterRequest } from "../../roster";
import { RosterDrawer } from "./RosterDrawer";

const generateRoster = vi.fn();

vi.mock("@tauri-apps/plugin-dialog", () => ({
  save: vi.fn(),
  open: vi.fn(),
  ask: vi.fn(),
}));
vi.mock("../../bindings", () => ({
  legoWriteTextFile: vi.fn(),
  legoReadTextFile: vi.fn(),
}));
vi.mock("@/notify/notify", () => ({ notify: vi.fn() }));
vi.mock("@picoframe/frame", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@picoframe/frame")>();
  const { useState } = await import("react");
  const stored = await import("@/lib/storedSetting");
  return {
    ...actual,
    useSetting: <T,>(key: string, fallback: T) => {
      const [value, setValue] = useState<T>(() =>
        stored.readStoredSetting(key, fallback),
      );
      return [
        value,
        (next: T) => {
          stored.writeStoredSetting(key, next);
          setValue(next);
        },
      ] as const;
    },
  };
});
vi.mock("../../pack", () => ({
  loadPack: () =>
    Promise.resolve({
      manifest: { id: "lego", version: "1", categories: [] },
      parts: [],
      library: { atlases: [{ tex1: "atlas.png" }] },
    }),
  colourwayLabel: () => "",
}));
vi.mock("../../starterModules", () => ({ starterModules: () => [] }));
vi.mock("../../geometry", () => ({ partMaterial: () => ({}) }));
vi.mock("../../candidatePictures", () => ({
  materialReady: () => true,
  drawUnitPictures: (units: LegoProject[]) =>
    units.map((u) => `data:image/png;base64,${u.id}`),
}));
vi.mock("../../roster", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../roster")>()),
  generateRoster: (...args: unknown[]) => generateRoster(...args),
}));

/** One stand in unit per job and tier, named as the roster names them. */
function units(request: RosterRequest): LegoProject[] {
  return request.jobs.flatMap(
    (job) =>
      Array.from({ length: request.tiers }, (_, i) => ({
        id: `${request.seed}-${job}-${i + 1}`,
        name: `${request.name} ${job} ${i + 1}`,
        unitName: `${request.name.toLowerCase()}_${job}_t${i + 1}`,
        roster: {
          id: request.id,
          name: request.name,
          job,
          tier: i + 1,
          tiers: request.tiers,
        },
      })) as unknown as LegoProject[],
  );
}

const onSaved = vi.fn();

beforeEach(() => {
  installSettingsStorage(memorySettingsStorage());
  generateRoster.mockReset();
  generateRoster.mockImplementation((request: RosterRequest) => ({
    status: "ok",
    units: units(request),
  }));
  onSaved.mockReset();
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function show(saved: LegoProject[] = []) {
  render(
    <RosterDrawer
      open
      onOpenChange={() => {}}
      projects={saved}
      onSaved={onSaved}
    />,
  );
  const button = screen.getByRole("button", { name: "Generate" });
  await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
  return button;
}

function type(label: string, value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: label }), {
    target: { value },
  });
}

describe("RosterDrawer", () => {
  it("generates a roster of the ticked jobs and plans, a row per job", async () => {
    const generate = await show();
    type("Roster name", "Raiders");
    type("Seed", "7");
    fireEvent.click(
      screen.getByRole("checkbox", { name: GENERATOR_JOBS[1].label }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: BODY_PLANS[1].label }),
    );
    fireEvent.click(generate);

    expect(generateRoster).toHaveBeenCalledTimes(1);
    const request = generateRoster.mock.calls[0][0] as RosterRequest;
    expect(request).toMatchObject({
      name: "Raiders",
      seed: 7,
      tiers: 3,
      plans: [BODY_PLANS[0], BODY_PLANS[1]],
      jobs: [GENERATOR_JOBS[0].id, GENERATOR_JOBS[2].id],
    });
    expect(
      [...document.querySelectorAll("section h3")].map((h) => h.textContent),
    ).toEqual([GENERATOR_JOBS[0].label, GENERATOR_JOBS[2].label]);
    expect(document.querySelectorAll("li")).toHaveLength(6);
    expect(screen.getByText(`raiders_${GENERATOR_JOBS[0].id}_t1`)).toBeTruthy();
  });

  it("refuses a roster without a name, or with too many tiers", async () => {
    const generate = await show();
    fireEvent.click(generate);
    expect(screen.getByText("A roster needs a name.")).toBeTruthy();
    type("Roster name", "Raiders");
    type("Tiers", "12");
    fireEvent.click(generate);
    expect(screen.getByText("A roster has from 1 to 9 tiers.")).toBeTruthy();
    expect(generateRoster).not.toHaveBeenCalled();
  });

  it("refuses a name a saved unit already has", async () => {
    const saved = [
      {
        id: "x",
        name: "Other",
        unitName: `raiders_${GENERATOR_JOBS[0].id}_t1`,
      },
    ] as unknown as LegoProject[];
    const generate = await show(saved);
    type("Roster name", "Raiders");
    fireEvent.click(generate);
    expect(screen.getByText(/already called/)).toBeTruthy();
    expect(generateRoster).not.toHaveBeenCalled();
  });

  it("rerolls the same request from the next seed", async () => {
    const generate = await show();
    type("Roster name", "Raiders");
    type("Seed", "4");
    fireEvent.click(generate);
    fireEvent.click(screen.getByRole("button", { name: "Reroll" }));

    const [first, second] = generateRoster.mock.calls.map(
      (call) => call[0] as RosterRequest,
    );
    expect(second).toEqual({ ...first, seed: 5 });
  });

  it("says why when the roster cannot be made", async () => {
    generateRoster.mockReturnValue({
      status: "failed",
      message: "No seed from 1 to 20 made Raiders Scout 3 bigger.",
    });
    const generate = await show();
    type("Roster name", "Raiders");
    fireEvent.click(generate);
    expect(
      screen.getByText("No seed from 1 to 20 made Raiders Scout 3 bigger."),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save roster" })).toBeNull();
  });

  it("forgets the roster when the drawer closes", async () => {
    const view = render(
      <RosterDrawer
        open
        onOpenChange={() => {}}
        projects={[]}
        onSaved={onSaved}
      />,
    );
    const generate = screen.getByRole("button", { name: "Generate" });
    await waitFor(() => expect(generate.hasAttribute("disabled")).toBe(false));
    type("Roster name", "Raiders");
    fireEvent.click(generate);
    expect(screen.getByRole("button", { name: "Save roster" })).toBeTruthy();
    const closed = (open: boolean) => (
      <RosterDrawer
        open={open}
        onOpenChange={() => {}}
        projects={[]}
        onSaved={onSaved}
      />
    );
    view.rerender(closed(false));
    view.rerender(closed(true));
    expect(screen.queryByRole("button", { name: "Save roster" })).toBeNull();
  });

  it("hands every unit to the page to save", async () => {
    const generate = await show();
    type("Roster name", "Raiders");
    type("Seed", "2");
    fireEvent.click(generate);
    fireEvent.click(screen.getByRole("button", { name: "Save roster" }));

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onSaved.mock.calls[0][0]).toEqual(
      units(generateRoster.mock.calls[0][0]),
    );
  });
});
