// @vitest-environment happy-dom

/**
 * What the panel says about a game's own script, and what it lets somebody
 * decide.
 *
 * The thing worth holding onto is that the two kinds of proposal stay apart. A
 * script naming a piece and a piece having moved are different claims, and
 * somebody choosing whether to take one deserves to know which they are being
 * shown.
 */

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdoptedScript } from "../../adoptGameScript";
import type { RoleProposal } from "../../inferRoles";
import {
  defaultTakenRoles,
  defaultTakeScript,
  GameScriptPanel,
} from "./GameScriptPanel";

const onTakeScript = vi.fn();
const onToggleRole = vi.fn();

function adopted(over: Partial<AdoptedScript> = {}): AdoptedScript {
  return {
    script: "-- the game's own\n",
    member: "scripts/armcom.lua",
    kind: "lua",
    declared: "armcom.cob",
    findings: { proposals: [], notes: [], error: null },
    listing: null,
    converted: null,
    compiled: null,
    notes: [],
    ...over,
  };
}

function proposal(over: Partial<RoleProposal> = {}): RoleProposal {
  return {
    pieceName: "turret",
    role: "turret",
    evidence: "observed",
    callin: "AimWeapon1",
    ...over,
  };
}

function show(
  value: AdoptedScript,
  taken = defaultTakenRoles(value),
  takeScript = true,
) {
  return render(
    <GameScriptPanel
      adopted={value}
      takeScript={takeScript}
      onTakeScript={onTakeScript}
      taken={taken}
      onToggleRole={onToggleRole}
    />,
  );
}

afterEach(() => {
  cleanup();
  onTakeScript.mockClear();
  onToggleRole.mockClear();
});

describe("a unit whose game ships Lua for it", () => {
  it("names the file and offers to keep it", () => {
    show(adopted());

    expect(screen.getByText("scripts/armcom.lua")).toBeTruthy();
    expect(screen.getByLabelText("Keep the game's script")).toBeTruthy();
  });

  /** Taking a script over means the presets stop applying, which is a thing
   *  somebody should be told before they land on a panel that looks empty. */
  it("says the presets stop applying, and that it can be handed back", () => {
    show(adopted());

    expect(screen.getByText(/presets do not apply/)).toBeTruthy();
    expect(screen.getByText(/hand it back later/)).toBeTruthy();
  });

  it("asks before changing whether the script is kept", () => {
    show(adopted());
    fireEvent.click(screen.getByLabelText("Keep the game's script"));

    expect(onTakeScript).toHaveBeenCalledWith(false);
  });
});

describe("a unit whose game ships compiled bytecode", () => {
  const compiled = adopted({
    script: null,
    kind: "cob",
    member: "scripts/armcom.cob",
    listing: "; COB v4\n; 3 scripts\n",
    findings: null,
    notes: ["That file is compiled bytecode rather than Lua."],
  });

  it("offers no way to keep a script that cannot be written back", () => {
    show(compiled);

    expect(screen.queryByLabelText("Keep the game's script")).toBeNull();
    expect(screen.getByText(/compiled rather than Lua/)).toBeTruthy();
  });

  /** Coilbox cannot write a `.cob` and can run one, and those are different
   *  things. The panel used to say only the first. */
  it("says the unit still animates, because the file is run", () => {
    show(compiled);

    expect(screen.getByText(/Coilbox runs it/)).toBeTruthy();
  });

  it("still lets it be read, and says the file is untouched", () => {
    show(compiled);
    fireEvent.click(screen.getByRole("button", { name: "Read it anyway" }));

    expect(screen.getByText(/; COB v4/)).toBeTruthy();
    expect(screen.getByText(/the file itself is untouched/)).toBeTruthy();
  });
});

/**
 * The case the compiled-script note used to end at. What matters is that the
 * offer never reads as the game's own file: the converter is a set of text
 * substitutions, and a unit animating subtly wrongly with nobody warned is
 * worse than one standing still.
 */
describe("a unit whose game ships the source beside the bytecode", () => {
  const converted = adopted({
    script: "local base = piece 'base' \n",
    kind: "cob",
    member: "scripts/armcom.cob",
    listing: "; COB v4\n",
    findings: null,
    converted: { member: "scripts/armcom.bos" },
    notes: [],
  });

  it("names the source it converted, not only the compiled file", () => {
    show(converted);

    expect(screen.getByText("scripts/armcom.bos")).toBeTruthy();
    expect(screen.getByText("scripts/armcom.cob")).toBeTruthy();
  });

  it("says outright that this is a conversion rather than the game's file", () => {
    show(converted);

    expect(screen.getByText(/not the game's own file/)).toBeTruthy();
    expect(screen.getByText(/needs checking/)).toBeTruthy();
  });

  it("offers it, and asks before taking it", () => {
    show(converted, undefined, false);
    fireEvent.click(screen.getByLabelText("Use the converted script"));

    expect(onTakeScript).toHaveBeenCalledWith(true);
  });

  /** The compiled file is still what the game runs, so the faithful reading of
   *  it stays available beside the conversion. */
  it("still lets the compiled file be read", () => {
    show(converted);
    fireEvent.click(screen.getByRole("button", { name: "Read it anyway" }));

    expect(screen.getByText(/; COB v4/)).toBeTruthy();
  });
});

describe("what the panel starts with the script switch set to", () => {
  it("keeps a game's own Lua, which is exactly what it ships", () => {
    expect(defaultTakeScript(adopted())).toBe(true);
  });

  /** Off, because a conversion needs reading before it is trusted and an
   *  accept is one click away. */
  it("leaves a conversion off until somebody asks for it", () => {
    expect(
      defaultTakeScript(
        adopted({
          kind: "cob",
          script: "local base = piece 'base' \n",
          converted: { member: "scripts/armcom.bos" },
        }),
      ),
    ).toBe(false);
  });

  it("is off for a unit with no script to take at all", () => {
    expect(
      defaultTakeScript(adopted({ script: null, member: null, kind: null })),
    ).toBe(false);
  });
});

/**
 * The distinction the whole panel exists to keep. Mixing them would present a
 * script's own answer and a reading of behaviour as the same kind of claim.
 */
describe("the two kinds of proposal", () => {
  const both = adopted({
    findings: {
      proposals: [
        proposal({
          pieceName: "nano1",
          role: "buildarm.nano",
          evidence: "stated",
          callin: "QueryNanoPiece",
        }),
        proposal(),
      ],
      notes: [],
      error: null,
    },
  });

  it("keeps them under separate headings", () => {
    show(both);

    expect(screen.getByText("The script named these")).toBeTruthy();
    expect(
      screen.getByText("These moved when the unit was asked to work"),
    ).toBeTruthy();
  });

  it("names the call-in each one came from, as the reason", () => {
    show(both);

    expect(screen.getByText("QueryNanoPiece")).toBeTruthy();
    expect(screen.getByText("AimWeapon1")).toBeTruthy();
  });

  it("says what each piece would become in words, not role ids", () => {
    show(both);

    expect(screen.getByText(/nano1 is nano emit point/)).toBeTruthy();
    expect(screen.getByText(/turret is turret/)).toBeTruthy();
  });

  it("shows only the heading that has proposals under it", () => {
    show(
      adopted({
        findings: { proposals: [proposal()], notes: [], error: null },
      }),
    );

    expect(screen.queryByText("The script named these")).toBeNull();
  });

  it("hands back the piece whose box was clicked", () => {
    show(both);
    fireEvent.click(screen.getByLabelText(/nano1 is/));

    expect(onToggleRole).toHaveBeenCalledWith("nano1");
  });
});

describe("what the panel starts with taken", () => {
  /** All of them, because nothing is applied until the unit is accepted and
   *  every one is on screen before that. */
  it("takes every proposal, so accepting straight through does the obvious thing", () => {
    const value = adopted({
      findings: {
        proposals: [proposal(), proposal({ pieceName: "nano1" })],
        notes: [],
        error: null,
      },
    });

    expect(defaultTakenRoles(value)).toEqual(new Set(["turret", "nano1"]));
  });

  it("takes nothing when a script proposed nothing", () => {
    expect(defaultTakenRoles(adopted())).toEqual(new Set());
  });

  it("leaves a box clear when its piece is not in the taken set", () => {
    const value = adopted({
      findings: { proposals: [proposal()], notes: [], error: null },
    });
    show(value, new Set());

    // The attribute, not the property: the checkbox is a Radix button rather
    // than an `<input type=checkbox>`.
    expect(
      screen.getByLabelText(/turret is/).getAttribute("aria-checked"),
    ).toBe("false");
  });
});

describe("when there is little to say", () => {
  it("passes on the notes, which are usually why nothing was found", () => {
    show(
      adopted({
        script: null,
        member: null,
        kind: null,
        findings: null,
        notes: ["armcom has no animation script in Beyond All Reason."],
      }),
    );

    expect(screen.getByText(/no animation script/)).toBeTruthy();
  });

  /** A unit not out of a game at all has nothing to report and no panel. */
  it("draws nothing when there is neither a script nor a note", () => {
    const { container } = show(
      adopted({ script: null, member: null, kind: null, findings: null }),
    );

    expect(container.firstChild).toBeNull();
  });
});
