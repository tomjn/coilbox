// @vitest-environment happy-dom
/**
 * What the checks button says and shows (issue #2748).
 *
 * Four sources, one verdict: unitsync's own diagnostics, the compatibility
 * comparison in `compatibility.ts` (issue #1281), `deliveryRoutes()`, and a
 * `workshop_preflight` report. None of those checks are re-tested here.
 * `deliveryRoutes.test.ts`, `compatibility.test.ts` and the Rust preflight
 * suite own them, and this is about what a person reading the button and its
 * drawer sees.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

let preflightResponse: unknown = { blockers: [], review: [], passes: [] };
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    (_plugin: string, command: string) => async (_args: unknown) => {
      if (command === "workshop_preflight") return preflightResponse;
      throw new Error(`unexpected command ${command}`);
    },
}));

import type { CompatFinding, CompatState } from "../../compatibility";
import type { ModProject } from "../../project";
import { ChecksButton } from "./ChecksButton";

const project: ModProject = {
  id: "p1",
  name: "Faster commanders",
  gameName: "Balanced Annihilation V15.9.8",
  edits: { overrides: {}, clones: {}, menus: {}, text: {}, disabled: [] },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  preflightResponse = { blockers: [], review: [], passes: [] };
});

/** The single toolbar button, whichever state it is asked to render in. */
function renderButton(props: Partial<Parameters<typeof ChecksButton>[0]> = {}) {
  return render(
    <ChecksButton
      gameName="Balanced Annihilation V15.9.8"
      diagnosticErrors={[]}
      diagnosticsChecking={false}
      routeOptions={[]}
      routesChecking={false}
      project={undefined}
      compatibility={null}
      onApplyFix={() => {}}
      {...props}
    />,
  );
}

describe("the checks button", () => {
  it("is disabled and says Checking while unitsync's own read is still going", () => {
    renderButton({ diagnosticsChecking: true });
    const button = screen.getByRole("button", { name: "Checking the project" });
    expect(button.hasAttribute("disabled")).toBe(true);
    expect(button.textContent).toContain("Checking");
  });

  it("is disabled while delivery routes are still being read", () => {
    renderButton({ routesChecking: true, routeOptions: undefined });
    const button = screen.getByRole("button", { name: "Checking the project" });
    expect(button.hasAttribute("disabled")).toBe(true);
  });

  it("is a quiet tick with no visible label when nothing is wrong", () => {
    renderButton();
    // `aria-label` is the accessible name a screen reader gets. There is no
    // tooltip in a DOM test (it needs a hover Radix does not simulate), so
    // this is the one proof the verdict is not tooltip-only (issue #2748).
    const button = screen.getByRole("button", { name: "No problems found" });
    expect(button.hasAttribute("disabled")).toBe(false);
    expect(button.textContent).toBe("");
  });

  it("grows a visible label and turns amber when unitsync reports a diagnostic", () => {
    renderButton({ diagnosticErrors: ["could not read units/armcom.lua"] });
    const button = screen.getByRole("button", { name: "1 to review found" });
    expect(button.textContent).toBe("1 to review");
  });

  it("counts a blocker and a review item together, blocker first", async () => {
    preflightResponse = {
      blockers: ["supercom is defined by 2 copies (first, second)."],
      review: ["2 name and description edits are not compiled."],
      passes: [],
    };
    renderButton({ project });
    const button = await screen.findByRole("button", {
      name: "1 blocker, 1 to review found",
    });
    expect(button.textContent).toBe("1 blocker, 1 to review");
  });

  it("reads as attention rather than clean when preflight fails to run", async () => {
    preflightResponse = Promise.reject(new Error("command not found"));
    renderButton({ project });
    expect(
      await screen.findByRole("button", {
        name: "Preflight could not run: command not found",
      }),
    ).toBeTruthy();
  });

  describe("the drawer", () => {
    it("orders its sections definitions, compatibility, routes, then preflight", async () => {
      renderButton({
        diagnosticErrors: ["could not read units/armcom.lua"],
      });
      fireEvent.click(screen.getByRole("button", { name: /to review/ }));
      const headings = (
        await screen.findAllByRole("heading", { level: 3 })
      ).map((h) => h.textContent);
      expect(headings).toEqual([
        "Game definitions",
        "Still fits Balanced Annihilation V15.9.8",
        "Delivery routes",
        "Preflight",
      ]);
    });

    it("puts unitsync's own lines under Game definitions without showing them on the button", () => {
      renderButton({ diagnosticErrors: ["could not read units/armcom.lua"] });
      expect(screen.queryByText("could not read units/armcom.lua")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /to review/ }));
      expect(screen.getByText("could not read units/armcom.lua")).toBeTruthy();
    });

    it("lists both delivery routes, available and not", () => {
      renderButton({
        routeOptions: [{ key: "tweakdefs", name: "Tweak defs" }],
      });
      fireEvent.click(
        screen.getByRole("button", { name: "No problems found" }),
      );
      expect(screen.getByText("Mutator archive")).toBeTruthy();
      expect(screen.getByText("BAR tweak slots")).toBeTruthy();
    });

    it("keeps a blocker, a review item and a pass in three separate groups", async () => {
      preflightResponse = {
        blockers: ["supercom is defined by 2 copies (first, second)."],
        review: ["2 name and description edits are not compiled."],
        passes: ["2 table chunks compile to a Lua table."],
      };
      renderButton({ project });
      const button = await screen.findByRole("button", {
        name: "1 blocker, 1 to review found",
      });
      fireEvent.click(button);

      expect(await screen.findByText("Blockers")).toBeTruthy();
      expect(screen.getByText("Worth a look")).toBeTruthy();
      expect(screen.getByText("Passed")).toBeTruthy();
      expect(
        screen.getByText("supercom is defined by 2 copies (first, second)."),
      ).toBeTruthy();
      expect(
        screen.getByText("2 name and description edits are not compiled."),
      ).toBeTruthy();
      expect(
        screen.getByText("2 table chunks compile to a Lua table."),
      ).toBeTruthy();
    });

    /**
     * The compatibility section (issue #1281). `compatibility.test.ts` owns
     * whether the comparison is right. This is about whether a person can act
     * on it, which means the cost of an offer being on screen next to the
     * button that takes it.
     */
    describe("compatibility", () => {
      const finding = (over: Partial<CompatFinding> = {}): CompatFinding => ({
        id: "disabled:corak",
        store: "disabled",
        severity: "broken",
        subject: "corak",
        detail: "BA has no unit called corak any more.",
        fix: {
          label: "Remove this mark",
          cost: "nothing, a mark is not an edit",
          apply: (edits) => edits,
        },
        ...over,
      });
      const moved = (findings: CompatFinding[]): CompatState => ({
        kind: "moved",
        report: {
          findings,
          broken: findings.filter((f) => f.severity === "broken").length,
          review: findings.filter((f) => f.severity === "review").length,
        },
      });

      it("counts a broken reference as a blocker, so no tick hides it", async () => {
        renderButton({ project, compatibility: moved([finding()]) });
        expect(
          await screen.findByRole("button", { name: "1 blocker found" }),
        ).toBeTruthy();
      });

      it("counts one that still lands as something to review", async () => {
        renderButton({
          project,
          compatibility: moved([
            finding({ severity: "review", fix: undefined }),
          ]),
        });
        expect(
          await screen.findByRole("button", { name: "1 to review found" }),
        ).toBeTruthy();
      });

      it("shows what an offer costs beside the button that takes it", async () => {
        const onApplyFix = vi.fn();
        renderButton({
          project,
          compatibility: moved([finding()]),
          onApplyFix,
        });
        fireEvent.click(await screen.findByRole("button", { name: /blocker/ }));
        expect(
          screen.getByText("Loses nothing, a mark is not an edit"),
        ).toBeTruthy();
        fireEvent.click(
          screen.getByRole("button", { name: "Remove this mark" }),
        );
        expect(onApplyFix).toHaveBeenCalledTimes(1);
        expect(onApplyFix.mock.calls[0][0].id).toBe("disabled:corak");
      });

      it("offers nothing on a finding coilbox cannot safely act on", async () => {
        renderButton({
          project,
          compatibility: moved([
            finding({
              id: "clones:supercom:source",
              severity: "review",
              detail:
                "supercom was copied from armcom, which BA no longer has.",
              fix: undefined,
            }),
          ]),
        });
        fireEvent.click(
          await screen.findByRole("button", { name: /to review/ }),
        );
        expect(screen.queryByText(/^Loses /)).toBeNull();
      });

      it("says the game is the same build when the checksums agree", async () => {
        renderButton({ project, compatibility: { kind: "unmoved" } });
        fireEvent.click(
          await screen.findByRole("button", { name: "No problems found" }),
        );
        expect(
          screen.getByText(
            "Balanced Annihilation V15.9.8 is the same build this project was written against.",
          ),
        ).toBeTruthy();
      });

      it("says so when the game moved and nothing in the project did", async () => {
        renderButton({ project, compatibility: moved([]) });
        fireEvent.click(
          await screen.findByRole("button", { name: "No problems found" }),
        );
        expect(
          screen.getByText(/everything the project names is still there/),
        ).toBeTruthy();
      });

      it("does not claim a clean bill of health with no checksum to compare", async () => {
        renderButton({ project, compatibility: { kind: "unknown" } });
        fireEvent.click(
          await screen.findByRole("button", { name: "No problems found" }),
        );
        expect(screen.getByText(/could not be checksummed/)).toBeTruthy();
      });
    });

    it("says there is nothing compiled to check when no project is open", () => {
      renderButton({ diagnosticErrors: ["could not read units/armcom.lua"] });
      fireEvent.click(screen.getByRole("button", { name: /to review/ }));
      expect(
        screen.getByText(
          "No project is open yet, so there is nothing compiled to check.",
        ),
      ).toBeTruthy();
    });
  });
});
