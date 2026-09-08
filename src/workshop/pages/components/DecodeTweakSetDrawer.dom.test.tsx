// @vitest-environment happy-dom
/**
 * The drawer that decodes a stranger's tweak payload (issue #1280). What
 * matters here is the drawer's own wiring: a decode result is shown per
 * slot, and starting a project hands the page exactly what
 * `planProjectFromDecoded` computed rather than something re-derived in the
 * component. The classification and evaluation rules themselves are
 * `decode.rs`'s and `decodeTweakSet.test.ts`'s to cover.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecodedTweakSet } from "../../decodeTweakSet";

const { workshopDecodeTweakSet } = vi.hoisted(() => ({
  workshopDecodeTweakSet: vi.fn(),
}));

vi.mock("../../decodeTweakSet", async () => {
  const actual = await vi.importActual<typeof import("../../decodeTweakSet")>(
    "../../decodeTweakSet",
  );
  return { ...actual, workshopDecodeTweakSet };
});

// A plain <select>, the same stand-in `ProjectsPage.dom.test.tsx` uses: the
// real picker is a Radix popover happy-dom cannot drive.
vi.mock("@/components/OptionSelect", () => ({
  OptionSelect: ({
    value,
    onValueChange,
    options,
    ariaLabel,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    options: { value: string; label: string }[];
    ariaLabel?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onValueChange(e.target.value)}
    >
      <option value="">Pick a game</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const { DecodeTweakSetDrawer } = await import("./DecodeTweakSetDrawer");

const GAMES = [{ name: "Balanced Annihilation V15.9.8" }];

function draw(onStarted = vi.fn()) {
  render(
    <DecodeTweakSetDrawer
      games={GAMES}
      scanning={false}
      onStarted={onStarted}
    />,
  );
  return onStarted;
}

afterEach(() => {
  cleanup();
  workshopDecodeTweakSet.mockReset();
});

describe("DecodeTweakSetDrawer", () => {
  it("decodes a pasted payload and shows what each slot turned out to be", async () => {
    const set: DecodedTweakSet = {
      tweakdefs: [],
      tweakunits: [
        {
          key: "tweakunits",
          kind: "tweakunits",
          slot: 0,
          lua: '{ ["armcom"] = { maxDamage = 9000 } }',
          manifest: null,
          form: "table",
          table: { armcom: { maxDamage: 9000 } },
          error: null,
        },
      ],
      unrecognised: [],
    };
    workshopDecodeTweakSet.mockResolvedValueOnce(set);

    draw();
    fireEvent.click(screen.getByText("Decode"));
    fireEvent.change(screen.getByLabelText("Tweak payload to decode"), {
      target: { value: "eyJhcm1jb20iOnt9fQ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Decode" }));

    await screen.findByText("Data table");
    expect(workshopDecodeTweakSet).toHaveBeenCalledWith({
      entries: { pasted: "eyJhcm1jb20iOnt9fQ" },
    });
  });

  it("starts a project from a decoded data table once a game is picked", async () => {
    const set: DecodedTweakSet = {
      tweakdefs: [],
      tweakunits: [
        {
          key: "tweakunits",
          kind: "tweakunits",
          slot: 0,
          lua: '{ ["armcom"] = { maxDamage = 9000 } }',
          manifest: null,
          form: "table",
          table: { armcom: { maxDamage: 9000 } },
          error: null,
        },
      ],
      unrecognised: [],
    };
    workshopDecodeTweakSet.mockResolvedValueOnce(set);
    const onStarted = draw();

    fireEvent.click(screen.getByText("Decode"));
    fireEvent.change(screen.getByLabelText("Tweak payload to decode"), {
      target: { value: "eyJhcm1jb20iOnt9fQ" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Decode" }));
    await screen.findByText("Data table");

    // Nothing to start until a game is chosen: nothing in a payload names one.
    const startButton = screen
      .getByText("Start a project from this")
      .closest("button");
    expect(startButton?.hasAttribute("disabled")).toBe(true);

    fireEvent.change(screen.getByLabelText("Game for the decoded project"), {
      target: { value: "Balanced Annihilation V15.9.8" },
    });
    fireEvent.click(screen.getByText("Start a project from this"));

    expect(onStarted).toHaveBeenCalledTimes(1);
    const input = onStarted.mock.calls[0][0];
    expect(input.gameName).toBe("Balanced Annihilation V15.9.8");
    expect(input.edits.clones.armcom).toEqual({
      key: "armcom",
      replacesGameUnit: false,
      def: { maxDamage: 9000 },
    });
  });

  it("carries a program slot as read-only Lua and never offers it as a clone", async () => {
    const set: DecodedTweakSet = {
      tweakdefs: [
        {
          key: "tweakdefs",
          kind: "tweakdefs",
          slot: 0,
          lua: "do while true do end end",
          manifest: null,
          form: "block",
          table: null,
          error: null,
        },
      ],
      tweakunits: [],
      unrecognised: [],
    };
    workshopDecodeTweakSet.mockResolvedValueOnce(set);
    const onStarted = draw();

    fireEvent.click(screen.getByText("Decode"));
    fireEvent.change(screen.getByLabelText("Tweak payload to decode"), {
      target: { value: "ZG8gd2hpbGUgdHJ1ZSBkbyBlbmQgZW5k" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Decode" }));
    await screen.findByText("Program, read only");

    fireEvent.change(screen.getByLabelText("Game for the decoded project"), {
      target: { value: "Balanced Annihilation V15.9.8" },
    });
    fireEvent.click(screen.getByText("Start a project from this"));

    const input = onStarted.mock.calls[0][0];
    expect(input.edits).toBeUndefined();
    expect(input.readOnlyLua).toEqual([
      {
        title: "tweakdefs",
        lua: "do while true do end end",
        note: expect.stringContaining("program"),
      },
    ]);
  });
});
