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
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vitest";

let preflightResponse: unknown = { blockers: [], review: [], passes: [] };
let changeLedgerResponse: unknown = { units: [], notes: [] };
let compileResponse: unknown = {
  chunks: [],
  files: [],
  notes: [],
  barTweakdefs: null,
};
/** Which archives the fake unitsync says hold a post file, by archive name.
 *  Keyed rather than one shared answer, so a dependency can hold one while the
 *  game's own archive does not. */
let archivesWithPostFile: string[] = [];
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    (_plugin: string, command: string) => async (args: unknown) => {
      if (command === "workshop_preflight") return preflightResponse;
      if (command === "workshop_change_ledger") return changeLedgerResponse;
      if (command === "workshop_compile") return compileResponse;
      if (command === "unitsync_archive_tree") {
        const archive = (args as { archive: string }).archive;
        return {
          files: archivesWithPostFile.includes(archive)
            ? [{ path: "gamedata/unitdefs_post.lua", size: 1755 }]
            : [],
          errors: [],
        };
      }
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
  changeLedgerResponse = { units: [], notes: [] };
  compileResponse = { chunks: [], files: [], notes: [], barTweakdefs: null };
  archivesWithPostFile = [];
});

/** The single toolbar button, whichever state it is asked to render in. */
function renderButton(props: Partial<Parameters<typeof ChecksButton>[0]> = {}) {
  return render(
    <MemoryRouter>
      <ChecksButton
        gameName="Balanced Annihilation V15.9.8"
        gameArchives={[{ name: "balanced_annihilation-v15.9.8.sdz" }]}
        enginePath="/engines/recoil"
        dataDir="/spring"
        diagnosticErrors={[]}
        diagnosticsChecking={false}
        routeOptions={[]}
        routesChecking={false}
        project={undefined}
        compatibility={null}
        onApplyFix={() => {}}
        {...props}
      />
    </MemoryRouter>,
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
      review: ["2 blocks of read-only Lua are not compiled."],
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
    it("orders its sections definitions, compatibility, routes, post-processing, preflight, then the change ledger", async () => {
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
        "Post-processing",
        "Preflight",
        "Change ledger",
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
        review: ["2 blocks of read-only Lua are not compiled."],
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
        screen.getByText("2 blocks of read-only Lua are not compiled."),
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

    /**
     * The post-processing section (issue #2744). `postHook.test.ts` owns the
     * two facts it combines. This is about the one thing a person has to be
     * able to tell apart: a mutator that covers the game's own file, and one
     * that covers nothing.
     */
    describe("post-processing", () => {
      const withPostFile = {
        chunks: [],
        files: [{ path: "gamedata/unitdefs_post.lua", contents: "-- edits" }],
        notes: [],
        barTweakdefs: null,
      };

      it("is silent for a project that writes no post file", async () => {
        archivesWithPostFile = ["balanced_annihilation-v15.9.8.sdz"];
        renderButton({ project });
        fireEvent.click(
          await screen.findByRole("button", { name: "No problems found" }),
        );
        expect(screen.getByText(/the mutator covers nothing of/)).toBeTruthy();
      });

      it("counts a covered post file as a blocker, so no tick hides it", async () => {
        compileResponse = withPostFile;
        archivesWithPostFile = ["balanced_annihilation-v15.9.8.sdz"];
        renderButton({ project });
        expect(
          await screen.findByRole("button", { name: "1 blocker found" }),
        ).toBeTruthy();
      });

      it("names the game's own file and points at the other route", async () => {
        compileResponse = withPostFile;
        archivesWithPostFile = ["balanced_annihilation-v15.9.8.sdz"];
        renderButton({ project });
        fireEvent.click(await screen.findByRole("button", { name: /blocker/ }));
        expect(
          screen.getByText(
            /post-processes its own units in gamedata\/unitdefs_post\.lua/,
          ),
        ).toBeTruthy();
        expect(
          screen.getByText(/Deliver it through the tweak slots instead/),
        ).toBeTruthy();
      });

      it("names the archive it is inherited from when a dependency holds it", async () => {
        compileResponse = withPostFile;
        archivesWithPostFile = ["base.sdz"];
        renderButton({
          project,
          gameArchives: [{ name: "some-mutator.sdz" }, { name: "base.sdz" }],
        });
        fireEvent.click(await screen.findByRole("button", { name: /blocker/ }));
        expect(
          screen.getByText(
            /inherits a gamedata\/unitdefs_post\.lua from base\.sdz/,
          ),
        ).toBeTruthy();
      });

      it("stays a tick when the mutator writes the file and the game has none", async () => {
        compileResponse = withPostFile;
        renderButton({ project });
        fireEvent.click(
          await screen.findByRole("button", { name: "No problems found" }),
        );
        expect(
          screen.getByText(/has no file of its own there for it to cover/),
        ).toBeTruthy();
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

    /**
     * The change ledger (issue #2653). `ledger.rs`'s own Rust tests own
     * whether a trace is right. This is about whether a person reading the
     * drawer can follow it back to the unit it came from.
     */
    describe("change ledger", () => {
      it("says there is nothing to trace when no project is open", () => {
        renderButton({ diagnosticErrors: ["could not read units/armcom.lua"] });
        fireEvent.click(screen.getByRole("button", { name: /to review/ }));
        expect(
          screen.getByText(
            "No project is open yet, so there is nothing to trace.",
          ),
        ).toBeTruthy();
      });

      it("links a traced change back to the unit and field it came from", async () => {
        changeLedgerResponse = {
          units: [
            {
              unit: "armcom",
              changes: [
                {
                  description: "Field change: maxDamage",
                  fieldPath: "maxDamage",
                  files: ["gamedata/unitdefs_post.lua"],
                  barSlot: { kind: "tweakunits", label: "tweakunits" },
                  barMiss: null,
                  uncompiledReason: null,
                },
              ],
            },
          ],
          notes: [],
        };
        renderButton({ project });
        fireEvent.click(
          await screen.findByRole("button", { name: "No problems found" }),
        );
        const link = await screen.findByRole("link", {
          name: "Field change: maxDamage",
        });
        expect(link.getAttribute("href")).toBe(
          "/workshop/p1?unit=armcom&field=maxDamage",
        );
        // The whole destination line, rather than each half on its own: the
        // post-processing section names the same path, so a loose match finds
        // two elements.
        expect(
          screen.getByText("gamedata/unitdefs_post.lua · !bset tweakunits"),
        ).toBeTruthy();
      });

      it("says why a change reached no BAR slot", async () => {
        changeLedgerResponse = {
          units: [
            {
              unit: "armcom",
              changes: [
                {
                  description: "Switched off",
                  fieldPath: null,
                  files: ["gamedata/unitdefs_post.lua"],
                  barSlot: null,
                  barMiss: "oversized",
                  uncompiledReason: null,
                },
              ],
            },
          ],
          notes: [],
        };
        renderButton({ project });
        fireEvent.click(
          await screen.findByRole("button", { name: "No problems found" }),
        );
        expect(
          await screen.findByText(/too big for any BAR slot/),
        ).toBeTruthy();
      });

      /**
       * Issue #2743. A rename reaches the mutator's language file and no
       * numbered slot, so the drawer has to show both: the file it can be
       * read in, and the fact that the lobby export leaves it behind.
       */
      it("shows a rename's language file and says no slot carries it", async () => {
        changeLedgerResponse = {
          units: [
            {
              unit: "armcom",
              changes: [
                {
                  description: "Name (en): Commander",
                  fieldPath: null,
                  files: ["language/en/zz_coilbox.json"],
                  barSlot: null,
                  barMiss: "noSlotForWords",
                  uncompiledReason: null,
                },
              ],
            },
          ],
          notes: [],
        };
        renderButton({ project });
        fireEvent.click(
          await screen.findByRole("button", { name: "No problems found" }),
        );
        expect(
          await screen.findByText(
            /language\/en\/zz_coilbox\.json · no BAR slot can carry words/,
          ),
        ).toBeTruthy();
      });

      it("switches to the by-output view and groups changes under the file that carries them", async () => {
        changeLedgerResponse = {
          units: [
            {
              unit: "armflash",
              changes: [
                {
                  description: "Switched off",
                  fieldPath: null,
                  files: ["gamedata/unitdefs_post.lua"],
                  barSlot: { kind: "tweakdefs", label: "tweakdefs" },
                  barMiss: null,
                  uncompiledReason: null,
                },
              ],
            },
            {
              unit: "armrock",
              changes: [
                {
                  description: "Switched off",
                  fieldPath: null,
                  files: ["gamedata/unitdefs_post.lua"],
                  barSlot: { kind: "tweakdefs", label: "tweakdefs" },
                  barMiss: null,
                  uncompiledReason: null,
                },
              ],
            },
          ],
          notes: [],
        };
        renderButton({ project });
        fireEvent.click(
          await screen.findByRole("button", { name: "No problems found" }),
        );
        await screen.findByText("Change ledger");
        fireEvent.click(screen.getByRole("radio", { name: "By output" }));
        const fileRow = screen.getByText("gamedata/unitdefs_post.lua");
        const container = fileRow.closest("li");
        expect(container?.textContent).toContain("armflash");
        expect(container?.textContent).toContain("armrock");
      });
    });
  });
});
