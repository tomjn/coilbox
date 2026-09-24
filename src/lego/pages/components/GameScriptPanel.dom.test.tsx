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
    converted: null,
    compiled: null,
    unitDef: null,
    includes: {},
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
  it("names the file it imports, with no choice to make", () => {
    show(adopted());

    expect(screen.getByText("scripts/armcom.lua")).toBeTruthy();
    expect(screen.getByText("Lua")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

describe("while the script is still being read", () => {
  it("says so rather than leaving the section out", () => {
    render(
      <GameScriptPanel
        adopted={null}
        takeScript={false}
        onTakeScript={onTakeScript}
        taken={new Set()}
        onToggleRole={onToggleRole}
      />,
    );

    expect(screen.getByText("Animation")).toBeTruthy();
    expect(screen.getByText(/Looking for this unit's animation/)).toBeTruthy();
  });
});

describe("a unit whose game ships only compiled bytecode", () => {
  const compiled = adopted({
    script: null,
    kind: "cob",
    member: "scripts/armcom.cob",
    compiled: { member: "scripts/armcom.cob", bytes: [1, 2, 3] },
    findings: null,
  });

  it("names the compiled file it runs, with no choice to make", () => {
    show(compiled);

    expect(screen.getByText("scripts/armcom.cob")).toBeTruthy();
    expect(screen.getByText("Compiled")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
  });

  /** Coilbox can run a `.cob` and cannot write or convert one, and both of
   *  those decide what somebody can do with the unit afterwards. */
  it("says it plays as in the game and cannot be converted", () => {
    show(compiled);

    expect(screen.getByText(/Plays exactly as in the game/)).toBeTruthy();
    expect(screen.getByText(/cannot be converted to Lua/)).toBeTruthy();
  });

  it("offers nothing to read the bytecode with", () => {
    show(compiled);

    expect(screen.queryByRole("button")).toBeNull();
  });
});

/**
 * Two ways in, laid out as two named options. A switch read as "no animation"
 * when off, and neither option is that.
 */
describe("a unit whose game ships the source beside the bytecode", () => {
  const converted = adopted({
    script: "local base = piece 'base' \n",
    kind: "cob",
    member: "scripts/armcom.cob",
    compiled: { member: "scripts/armcom.cob", bytes: [1, 2, 3] },
    findings: null,
    converted: { member: "scripts/armcom.bos" },
    notes: ["could not find sfxtype.h"],
  });

  it("offers the compiled file and the conversion, each naming its file", () => {
    show(converted, undefined, false);

    const compiledOption = screen.getByRole("radio", {
      name: /Run the compiled script/,
    });
    const luaOption = screen.getByRole("radio", { name: /Convert to Lua/ });
    expect(compiledOption.textContent).toContain("scripts/armcom.cob");
    expect(luaOption.textContent).toContain("scripts/armcom.bos");
  });

  it("starts on the option the switch value says", () => {
    show(converted, undefined, false);

    expect(
      screen
        .getByRole("radio", { name: /Run the compiled script/ })
        .getAttribute("aria-checked"),
    ).toBe("true");
  });

  it("asks for the conversion when it is picked", () => {
    show(converted, undefined, false);
    fireEvent.click(screen.getByRole("radio", { name: /Convert to Lua/ }));

    expect(onTakeScript).toHaveBeenCalledWith(true);
  });

  it("lists what the conversion could not carry over", () => {
    show(converted);

    expect(screen.getByText("could not find sfxtype.h")).toBeTruthy();
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

    expect(screen.getByText("Named by the script")).toBeTruthy();
    expect(screen.getByText("Worked out from what moved")).toBeTruthy();
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

    expect(screen.queryByText("Named by the script")).toBeNull();
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
    expect(screen.getByText(/opens with the animation presets/)).toBeTruthy();
  });

  /** A unit not out of a game at all has nothing to report and no panel. */
  it("draws nothing when there is neither a script nor a note", () => {
    const { container } = show(
      adopted({ script: null, member: null, kind: null, findings: null }),
    );

    expect(container.firstChild).toBeNull();
  });
});
