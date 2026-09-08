// @vitest-environment happy-dom

/**
 * The two calls this section makes for itself, as opposed to the ones
 * `runDelivery` makes (issue #1279).
 *
 * The first is which route this game has at all. A game with no tweak slots
 * cannot be handed a project over the wire, and the honest answer is to say so
 * rather than offer a button that would set an option the game does not read.
 *
 * The second is what to do with a pack that did not fit. `bar_pack` reports
 * what it left out instead of failing, which is right for an export somebody
 * reads. It is wrong for a live room, because half a set is the exact failure
 * this issue exists to prevent, so nothing is sent at all.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConfigOption } from "@/content/bindings";
import { TweakProjectSection } from "./TweakProjectSection";

const packBarSlots = vi.hoisted(() => vi.fn());
const start = vi.hoisted(() =>
  vi.fn(async (_slots: { name: string; value: string }[]) => {}),
);

// The picker is a radix `Select` behind `OptionSelect`, which a headless DOM
// cannot open. Stand a native one in its place, as the other room dom tests do,
// so a test can pick a project and get on with what it is actually checking.
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
    ariaLabel,
  }: {
    value: string;
    onValueChange: (v: string) => void;
    options: { value: string; label: string }[];
    ariaLabel?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="">none</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("@/workshop/barPack", async (orig) => ({
  ...(await orig<typeof import("@/workshop/barPack")>()),
  workshopPackBarSlots: packBarSlots,
}));
vi.mock("@/workshop/changeLedger", () => ({
  useChangeLedger: () => ({ ledger: null, loading: false, error: null }),
  ledgerByOutput: () => [],
}));
vi.mock("@/workshop/project", () => ({
  useModProjects: () => ({
    projects: [
      {
        id: "p1",
        name: "Faster peewees",
        gameName: "Balanced Annihilation V12",
        edits: {},
        createdAt: "",
        updatedAt: "",
      },
    ],
  }),
}));
vi.mock("./useTweakDelivery", () => ({
  useTweakDelivery: () => ({
    progress: null,
    running: false,
    start,
    cancel: vi.fn(),
    clear: vi.fn(),
  }),
}));

const slotOptions: ConfigOption[] = [
  { key: "tweakdefs", name: "Tweak defs", default: "", type: "string" },
  { key: "tweakdefs1", name: "Tweak defs 1", default: "", type: "string" },
  { key: "tweakunits", name: "Tweak units", default: "", type: "string" },
];

const render1 = (options: ConfigOption[]) =>
  render(
    <TweakProjectSection
      gameName="Balanced Annihilation V12"
      modOptionsSchema={options}
      scriptTags={{}}
      battleId={7}
      isFounder={false}
      canEdit={true}
    />,
  );

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TweakProjectSection", () => {
  it("offers no send at all for a game with no tweak slots", () => {
    render1([
      { key: "maxunits", name: "Max units", default: "1000", type: "number" },
    ]);

    expect(screen.getByText(/mutator archive/i)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /send to this battle/i })).toBe(
      null,
    );
  });

  it("sends nothing when the pack left an edit out", async () => {
    packBarSlots.mockResolvedValue({
      tweakdefs: ["!bset tweakdefs QUJD"],
      tweakunits: [],
      oversized: ["armpw weapons"],
      unplaced: [],
    });
    render1(slotOptions);

    fireEvent.change(screen.getByLabelText("Which project to send"), {
      target: { value: "p1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /send to this battle/i }),
    );

    await waitFor(() =>
      expect(screen.getByText(/none of it was sent/i)).toBeTruthy(),
    );
    expect(start).not.toHaveBeenCalled();
  });

  it("sends a pack that fits", async () => {
    packBarSlots.mockResolvedValue({
      tweakdefs: ["!bset tweakdefs QUJD"],
      tweakunits: [],
      oversized: [],
      unplaced: [],
    });
    render1(slotOptions);

    fireEvent.change(screen.getByLabelText("Which project to send"), {
      target: { value: "p1" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /send to this battle/i }),
    );

    await waitFor(() => expect(start).toHaveBeenCalledTimes(1));
    expect(start.mock.calls[0][0]).toEqual([
      {
        name: "tweakdefs",
        value: "QUJD",
        tagKey: "game/modoptions/tweakdefs",
        bytes: "!bset tweakdefs QUJD".length,
      },
    ]);
  });
});
