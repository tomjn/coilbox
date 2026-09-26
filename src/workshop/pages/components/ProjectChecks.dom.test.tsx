// @vitest-environment happy-dom
/**
 * What the checks say and show (issue #2748): the verdict on the Checks entry
 * in a project's section bar, and the Checks page itself (issue #3111).
 *
 * Four sources, one verdict: unitsync's own diagnostics, the compatibility
 * comparison in `compatibility.ts` (issue #1281), `deliveryRoutes()`, and a
 * `workshop_preflight` report. None of those checks are re-tested here.
 * `deliveryRoutes.test.ts`, `compatibility.test.ts` and the Rust preflight
 * suite own them, and this is about what a person reading the verdict and its
 * page sees.
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
  tweakdefs: null,
};
/** Which archives the fake unitsync says hold a post file, by archive name.
 *  Keyed rather than one shared answer, so a dependency can hold one while the
 *  game's own archive does not. */
let archivesWithPostFile: string[] = [];
/** What `workshop_write_in_place` answers, for the in-place write tests
 *  (issue #3028). Null until a test sets it. */
let writeResponse: unknown = null;
vi.mock("@picoframe/plugin-sdk", () => ({
  defineCommand:
    (_plugin: string, command: string) => async (args: unknown) => {
      if (command === "workshop_preflight") return preflightResponse;
      if (command === "workshop_change_ledger") return changeLedgerResponse;
      if (command === "workshop_compile") return compileResponse;
      if (command === "workshop_in_place_status")
        return { backups: 0, created: 0 };
      if (command === "workshop_write_in_place") return writeResponse;
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

// `InPlaceWrite` checks typed values against the game before a write (issue
// #3093), through these two hooks. This suite does not cover that: it is
// about the drawer's own routing between checks, test, package and write.
vi.mock("@/content/config", () => ({
  useUnitsyncScan: () => ({ data: undefined, loading: false, error: null }),
}));
vi.mock("@/play/config", () => ({
  usePreferredTarget: () => ({ target: undefined, loading: false }),
}));

import type { CompatFinding, CompatState } from "../../compatibility";
import type { ModProject } from "../../project";
import {
  type ChecksInput,
  ChecksPanel,
  useProjectChecks,
} from "./ProjectChecks";
import { ProjectSectionBar } from "./ProjectSectionBar";

const project: ModProject = {
  id: "p1",
  name: "Faster commanders",
  gameName: "Balanced Annihilation V15.9.8",
  edits: { overrides: {}, clones: {}, menus: {}, text: {}, disabled: [] },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

/** A project with a field change to write, for the in-place write tests
 *  (issue #3028). */
const projectWithFieldChange: ModProject = {
  ...project,
  edits: {
    ...project.edits,
    overrides: { armcom: { metalcost: 2 } },
  },
};

afterEach(() => {
  cleanup();
  preflightResponse = { blockers: [], review: [], passes: [] };
  changeLedgerResponse = { units: [], notes: [] };
  compileResponse = { chunks: [], files: [], notes: [], tweakdefs: null };
  archivesWithPostFile = [];
  writeResponse = null;
});

type Props = ChecksInput & {
  onApplyFix: (finding: CompatFinding) => void;
  onInPlaceWrite: () => void;
};

/** The section bar's Checks entry and the Checks page, off one read of the
 *  checks, the way `UnitPage` draws them (issue #3111). */
function Checks({ onApplyFix, onInPlaceWrite, ...input }: Props) {
  const checks = useProjectChecks(input, true);
  return (
    <>
      <ProjectSectionBar
        current="units"
        hrefOf={(s) => `/workshop/p1/${s}`}
        shown={(s) => s === "checks"}
        counts={{}}
        checks={checks}
      />
      <ChecksPanel
        input={input}
        checks={checks}
        onApplyFix={onApplyFix}
        onInPlaceWrite={onInPlaceWrite}
      />
    </>
  );
}

/** The JSX one render is, so a rerender can ask for the same tree with
 *  different props (issue #3028: a rerender that flips `routesChecking` must
 *  not remount the page's contents). */
function checksElement(props: Partial<Props>) {
  return (
    <MemoryRouter>
      <Checks
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
        onInPlaceWrite={() => {}}
        armorClassProblems={[]}
        {...props}
        gameUnits={props.gameUnits ?? {}}
      />
    </MemoryRouter>
  );
}

function renderChecks(props: Partial<Props> = {}) {
  const result = render(checksElement(props));
  return {
    ...result,
    rerenderWith: (next: Partial<Props>) =>
      result.rerender(checksElement({ ...props, ...next })),
  };
}

describe("the Checks entry in the section bar", () => {
  it("says Checking while unitsync's own read is still going", () => {
    renderChecks({ diagnosticsChecking: true });
    expect(
      screen.getByRole("link", { name: "Checks, Checking the project" }),
    ).toBeTruthy();
  });

  it("says Checking while delivery routes are still being read", () => {
    renderChecks({ routesChecking: true, routeOptions: undefined });
    expect(
      screen.getByRole("link", { name: "Checks, Checking the project" }),
    ).toBeTruthy();
  });

  it("is a quiet tick with no count when nothing is wrong", () => {
    renderChecks();
    // `aria-label` is the accessible name a screen reader gets. There is no
    // tooltip in a DOM test (it needs a hover Radix does not simulate), so
    // this is the one proof the verdict is not tooltip-only (issue #2748).
    const link = screen.getByRole("link", {
      name: "Checks, No problems found",
    });
    expect(link.textContent).toBe("Checks");
  });

  it("grows a count and turns amber when unitsync reports a diagnostic", () => {
    renderChecks({ diagnosticErrors: ["could not read units/armcom.lua"] });
    const link = screen.getByRole("link", {
      name: "Checks, 1 to review found",
    });
    expect(link.textContent).toBe("Checks1");
  });

  it("counts an armour class finding as something to review", () => {
    renderChecks({
      armorClassProblems: [
        {
          id: "armcom:gator_laser:damage",
          message:
            "gator_laser's damage table names 4 armour classes this game does not have: bombers, fighters, subs, vtol. The engine uses the default damage for them instead, so these rows have no effect.",
          severity: "warning",
        },
      ],
    });
    expect(
      screen.getByRole("link", { name: "Checks, 1 to review found" }),
    ).toBeTruthy();
  });

  it("counts a blocker and a review item together, blocker first", async () => {
    preflightResponse = {
      blockers: ["supercom is defined by 2 copies (first, second)."],
      review: ["2 blocks of read-only Lua are not compiled."],
      passes: [],
    };
    renderChecks({ project });
    const link = await screen.findByRole("link", {
      name: "Checks, 1 blocker, 1 to review found",
    });
    expect(link.textContent).toBe("Checks2");
  });

  it("reads as attention rather than clean when preflight fails to run", async () => {
    preflightResponse = Promise.reject(new Error("command not found"));
    renderChecks({ project });
    expect(
      await screen.findByRole("link", {
        name: "Checks, Preflight could not run: command not found",
      }),
    ).toBeTruthy();
  });

  describe("the Checks page", () => {
    it("opens on Needs attention, then game definitions, compatibility, routes, post-processing, preflight, then the change ledger", async () => {
      renderChecks({
        diagnosticErrors: ["could not read units/armcom.lua"],
      });
      screen.getByRole("link", { name: /to review/ });
      const headings = (
        await screen.findAllByRole("heading", { level: 3 })
      ).map((h) => h.textContent);
      // "Delivery routes1" is the heading plus its count, a visual-only
      // sibling span the trigger button carries (`aria-hidden`, so it does
      // not touch the accessible name, but it is still part of `textContent`).
      expect(headings).toEqual([
        "Needs attention",
        "Game definitions",
        "Still fits Balanced Annihilation V15.9.8",
        "Delivery routes1",
        "Post-processing",
        "Preflight",
        "Change ledger",
      ]);
    });

    it("puts the blockers and review items first, pulled together from every check", async () => {
      preflightResponse = {
        blockers: ["supercom is defined by 2 copies (first, second)."],
        review: [],
        passes: [],
      };
      renderChecks({ project });
      await screen.findByRole("link", { name: "Checks, 1 blocker found" });
      const headings = await screen.findAllByRole("heading", { level: 3 });
      expect(headings[0].textContent).toBe("Needs attention");
      const attention = headings[0].closest("section");
      expect(
        attention?.textContent?.includes(
          "supercom is defined by 2 copies (first, second).",
        ),
      ).toBe(true);
    });

    it("says nothing needs attention when the project is clean", () => {
      renderChecks();
      screen.getByRole("link", { name: "Checks, No problems found" });
      expect(screen.getByText("Nothing here needs attention.")).toBeTruthy();
    });

    it("lists an armour class finding under Needs attention, without opening the unit it is about", () => {
      renderChecks({
        armorClassProblems: [
          {
            id: "armcom:gator_laser:damage",
            message:
              "gator_laser's damage table names 4 armour classes this game does not have: bombers, fighters, subs, vtol. The engine uses the default damage for them instead, so these rows have no effect.",
            severity: "warning",
          },
        ],
      });
      screen.getByRole("link", { name: /to review/ });
      expect(screen.getByText(/gator_laser's damage table/)).toBeTruthy();
    });

    it("links an armour class finding on a unit back to that unit", () => {
      renderChecks({
        project,
        armorClassProblems: [
          {
            id: "armcom:gator_laser:damage",
            message: "gator_laser's damage table names an unknown class.",
            severity: "warning",
          },
        ],
      });
      const link = screen.getByRole("link", {
        name: "gator_laser's damage table names an unknown class.",
      });
      expect(link.getAttribute("href")).toBe("/workshop/p1?unit=armcom");
    });

    it("puts unitsync's own lines under Game definitions", () => {
      renderChecks({ diagnosticErrors: ["could not read units/armcom.lua"] });
      expect(screen.getByText("could not read units/armcom.lua")).toBeTruthy();
    });

    it("lists both delivery routes, available and not", () => {
      renderChecks({
        routeOptions: [{ key: "tweakdefs", name: "Tweak defs" }],
      });
      screen.getByRole("link", { name: "Checks, No problems found" });
      expect(screen.getByText("Mutator archive")).toBeTruthy();
      expect(screen.getByText("Tweak slots")).toBeTruthy();
    });

    it("offers the in-place write for a loose game in a games folder", async () => {
      renderChecks({
        gameArchives: [{ name: "dev.sdd", path: "/spring/games/dev.sdd" }],
      });
      screen.getByRole("link", { name: "Checks, No problems found" });
      expect(
        await screen.findByRole("button", {
          name: "Write changes into the game",
        }),
      ).toBeTruthy();
    });

    it("offers no in-place write for a packed game", () => {
      renderChecks();
      screen.getByRole("link", { name: "Checks, No problems found" });
      expect(
        screen.queryByRole("button", { name: "Write changes into the game" }),
      ).toBeNull();
    });

    it("keeps the write outcome on screen once routes are re-read afterwards (issue #3028)", async () => {
      writeResponse = {
        written: ["units/armcom.lua"],
        changed: 1,
        unchanged: 0,
        refused: [],
        notCarried: [],
        carried: [{ unit: "armcom", field: "metalcost", undoable: true }],
        copies: [],
        equipped: [],
      };
      const { rerenderWith } = renderChecks({
        gameArchives: [{ name: "dev.sdd", path: "/spring/games/dev.sdd" }],
        project: projectWithFieldChange,
      });
      await screen.findByRole("link", { name: "Checks, No problems found" });
      fireEvent.click(
        await screen.findByRole("button", {
          name: "Write changes into the game",
        }),
      );
      expect(
        await screen.findByText("Wrote 1 change into units/armcom.lua."),
      ).toBeTruthy();

      // The page drops its unitsync reads of the game and asks again once a
      // write lands (issue #2637/#3026), which flips `routesChecking` true
      // then false while the message is still meant to be on screen.
      rerenderWith({
        gameArchives: [{ name: "dev.sdd", path: "/spring/games/dev.sdd" }],
        project: projectWithFieldChange,
        routesChecking: true,
      });
      rerenderWith({
        gameArchives: [{ name: "dev.sdd", path: "/spring/games/dev.sdd" }],
        project: projectWithFieldChange,
        routesChecking: false,
      });

      expect(
        screen.getByText("Wrote 1 change into units/armcom.lua."),
      ).toBeTruthy();
    });

    it("keeps a blocker, a review item and a pass in three separate groups", async () => {
      preflightResponse = {
        blockers: ["supercom is defined by 2 copies (first, second)."],
        review: ["2 blocks of read-only Lua are not compiled."],
        passes: ["2 table chunks compile to a Lua table."],
      };
      renderChecks({ project });
      await screen.findByRole("link", {
        name: "Checks, 1 blocker, 1 to review found",
      });

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
        renderChecks({ project, compatibility: moved([finding()]) });
        expect(
          await screen.findByRole("link", { name: "Checks, 1 blocker found" }),
        ).toBeTruthy();
      });

      it("counts one that still lands as something to review", async () => {
        renderChecks({
          project,
          compatibility: moved([
            finding({ severity: "review", fix: undefined }),
          ]),
        });
        expect(
          await screen.findByRole("link", {
            name: "Checks, 1 to review found",
          }),
        ).toBeTruthy();
      });

      it("shows what an offer costs beside the button that takes it", async () => {
        const onApplyFix = vi.fn();
        renderChecks({
          project,
          compatibility: moved([finding()]),
          onApplyFix,
        });
        await screen.findByRole("link", { name: /blocker/ });
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
        renderChecks({
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
        await screen.findByRole("link", { name: /to review/ });
        expect(screen.queryByText(/^Loses /)).toBeNull();
      });

      it("links a finding scoped to one field to that field, not to a unit named after it (issue #3116)", async () => {
        renderChecks({
          project,
          compatibility: moved([
            finding({
              id: "overrides:armcom:weapons.0.name",
              store: "overrides",
              subject: "armcom.weapons.0.name",
              detail:
                "armcom no longer has weapons.0.name, so this is dead weight.",
              fix: undefined,
            }),
          ]),
        });
        const link = await screen.findByRole("link", {
          name: "armcom no longer has weapons.0.name, so this is dead weight.",
        });
        expect(link.getAttribute("href")).toBe(
          "/workshop/p1?unit=armcom&field=weapons.0.name",
        );
      });

      it("says the game is the same build when the checksums agree", async () => {
        renderChecks({ project, compatibility: { kind: "unmoved" } });
        await screen.findByRole("link", { name: "Checks, No problems found" });
        expect(
          screen.getByText(
            "Balanced Annihilation V15.9.8 is the same build this project was written against.",
          ),
        ).toBeTruthy();
      });

      it("says so when the game moved and nothing in the project did", async () => {
        renderChecks({ project, compatibility: moved([]) });
        await screen.findByRole("link", { name: "Checks, No problems found" });
        expect(
          screen.getByText(/everything the project names is still there/),
        ).toBeTruthy();
      });

      it("does not claim a clean bill of health with no checksum to compare", async () => {
        renderChecks({ project, compatibility: { kind: "unknown" } });
        await screen.findByRole("link", { name: "Checks, No problems found" });
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
        tweakdefs: null,
      };

      it("is silent for a project that writes no post file", async () => {
        archivesWithPostFile = ["balanced_annihilation-v15.9.8.sdz"];
        renderChecks({ project });
        await screen.findByRole("link", { name: "Checks, No problems found" });
        // Nothing to report, so the section starts collapsed to one line
        // (issue #3106).
        fireEvent.click(
          screen.getByRole("button", { name: "Post-processing" }),
        );
        expect(screen.getByText(/the mutator covers nothing of/)).toBeTruthy();
      });

      it("counts a covered post file as a blocker, so no tick hides it", async () => {
        compileResponse = withPostFile;
        archivesWithPostFile = ["balanced_annihilation-v15.9.8.sdz"];
        renderChecks({ project });
        expect(
          await screen.findByRole("link", { name: "Checks, 1 blocker found" }),
        ).toBeTruthy();
      });

      it("names the game's own file and points at the other route", async () => {
        compileResponse = withPostFile;
        archivesWithPostFile = ["balanced_annihilation-v15.9.8.sdz"];
        renderChecks({ project });
        await screen.findByRole("link", { name: /blocker/ });
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
        renderChecks({
          project,
          gameArchives: [{ name: "some-mutator.sdz" }, { name: "base.sdz" }],
        });
        await screen.findByRole("link", { name: /blocker/ });
        expect(
          screen.getByText(
            /inherits a gamedata\/unitdefs_post\.lua from base\.sdz/,
          ),
        ).toBeTruthy();
      });

      it("stays a tick when the mutator writes the file and the game has none", async () => {
        compileResponse = withPostFile;
        renderChecks({ project });
        await screen.findByRole("link", { name: "Checks, No problems found" });
        expect(
          screen.getByText(/has no file of its own there for it to cover/),
        ).toBeTruthy();
      });
    });

    it("says there is nothing compiled to check when no project is open", () => {
      renderChecks({ diagnosticErrors: ["could not read units/armcom.lua"] });
      screen.getByRole("link", { name: /to review/ });
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
        renderChecks({ diagnosticErrors: ["could not read units/armcom.lua"] });
        screen.getByRole("link", { name: /to review/ });
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
                  tweakSlot: { kind: "tweakdefs", label: "tweakdefs" },
                  tweakMiss: null,
                  uncompiledReason: null,
                },
              ],
            },
          ],
          notes: [],
        };
        renderChecks({ project });
        await screen.findByRole("link", { name: "Checks, No problems found" });
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
          screen.getByText("gamedata/unitdefs_post.lua · !bset tweakdefs"),
        ).toBeTruthy();
      });

      it("says why a change reached no tweak slot", async () => {
        changeLedgerResponse = {
          units: [
            {
              unit: "armcom",
              changes: [
                {
                  description: "Switched off",
                  fieldPath: null,
                  files: ["gamedata/unitdefs_post.lua"],
                  tweakSlot: null,
                  tweakMiss: "oversized",
                  uncompiledReason: null,
                },
              ],
            },
          ],
          notes: [],
        };
        renderChecks({ project });
        await screen.findByRole("link", { name: "Checks, No problems found" });
        expect(
          await screen.findByText(/too big for any tweak slot/),
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
                  tweakSlot: null,
                  tweakMiss: "noSlotForWords",
                  uncompiledReason: null,
                },
              ],
            },
          ],
          notes: [],
        };
        renderChecks({ project });
        await screen.findByRole("link", { name: "Checks, No problems found" });
        expect(
          await screen.findByText(
            /language\/en\/zz_coilbox\.json · no tweak slot can carry words/,
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
                  tweakSlot: { kind: "tweakdefs", label: "tweakdefs" },
                  tweakMiss: null,
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
                  tweakSlot: { kind: "tweakdefs", label: "tweakdefs" },
                  tweakMiss: null,
                  uncompiledReason: null,
                },
              ],
            },
          ],
          notes: [],
        };
        renderChecks({ project });
        await screen.findByRole("link", { name: "Checks, No problems found" });
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
