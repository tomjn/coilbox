// @vitest-environment happy-dom
/**
 * A base's own team pointing at a participant the setup no longer has (issue
 * #2307, extending #2287's pattern from the Triggers panel). The issue here
 * comes from the real validator (`missionProblemsIn`), not a hand-built one,
 * so this is pinned against what the drawer would say too.
 *
 * The compiled mission spells a base "prefabs" (see `PART` in `validate.ts`),
 * which is what `entryFieldProblem` is asked about in `BaseControls`. This is
 * the one place that spelling is exercised end to end, through the real
 * validator rather than a hand-built issue naming the compiled key directly.
 */

import { cleanup, render, screen } from "@testing-library/react";
import { useMemo, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { newScenario } from "../../create";
import { baseBuildings, type Scenario } from "../../model";
import { BaseControls } from "./BaseControls";
import { missionProblemsIn } from "./useMissionProblems";

// The drawer is the app shell's, so it is stubbed for the conversion panel
// this pulls in. Nothing here opens it.
vi.mock("@picoframe/frame", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("@picoframe/frame")),
  useDrawer: () => ({ open: () => {}, close: () => {}, isOpen: false }),
}));

afterEach(cleanup);

function withGhostTeam(): Scenario {
  const base = newScenario("Demo");
  return {
    ...base,
    setup: { ...base.setup, participants: [] },
    blueprints: [
      {
        id: "layout",
        name: "Outpost",
        buildings: [{ def: "armllt", offset: { x: 0, z: 0 }, facing: 0 }],
      },
    ],
    bases: [
      {
        id: "outpost",
        blueprint: "layout",
        team: "ghost",
        origin: { x: 300, z: 300 },
        buildings: [],
      },
    ],
  };
}

function BaseHarness() {
  const [document, setDocument] = useState<Scenario>(withGhostTeam);
  const issues = useMemo(() => {
    const found = missionProblemsIn(document);
    return [...found.blocking, ...found.warnings];
  }, [document]);
  const base = document.bases[0];

  return (
    <BaseControls
      base={base}
      buildings={baseBuildings(document.blueprints, base)}
      index={0}
      layoutName="Outpost"
      ordered={false}
      sharedWith={0}
      sharedEdit={false}
      overlaps={[]}
      unstable={[]}
      tooDeep={[]}
      tooShallow={[]}
      absent={[]}
      onMap=""
      participants={document.setup.participants}
      units={[]}
      unitsLoading={false}
      sides={[]}
      gameArchive={undefined}
      moving={false}
      issues={issues}
      onEdit={(patch) =>
        setDocument((doc) => ({
          ...doc,
          bases: [{ ...doc.bases[0], ...patch }],
        }))
      }
      onRename={() => {}}
      onOrdered={() => {}}
      onMoveBuilding={() => {}}
      onPlay={() => {}}
      onSharedEdit={() => {}}
      onQueue={() => {}}
      onMove={() => {}}
      onSnapToGrid={() => {}}
      onSubstitute={() => {}}
      onDelete={() => {}}
    />
  );
}

describe("a base's own team the validator has flagged", () => {
  it("marks the team field invalid and says why, next to it", () => {
    render(<BaseHarness />);

    const field = screen.getByLabelText("Team");
    const message = screen.getByText('no team called "ghost"');

    expect(field.getAttribute("aria-invalid")).toBe("true");
    expect(field.getAttribute("aria-describedby")).toBe(message.id);
  });
});
