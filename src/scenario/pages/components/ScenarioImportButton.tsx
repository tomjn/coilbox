/**
 * Import a scenario someone shared, from a code or a file.
 *
 * On both scenario surfaces, because getting hold of a scenario is not an
 * authoring step (issue #861). Import used to live on the Scenario Builder
 * alone, which is advanced-only, so a player handed a `.json` had to turn on
 * Advanced mode to open a file dialog and then never used the editor.
 *
 * The button only opens the drawer. {@link ImportScenarioForm} owns the decode,
 * the content gate and the error state, the way the setup pack import does.
 *
 * What happens afterwards is the page's, since the two readers want different
 * things: the builder opens the editor on the new scenario, and the Scenarios
 * page stays where it is and says the scenario landed.
 */

import { Button, useDrawer } from "@picoframe/frame";
import { Download } from "lucide-react";
import { useEffect } from "react";
import type { Scenario } from "../../model";

export function ScenarioImportButton({
  initialCode,
  onImported,
}: {
  /** A confirmed `coilbox://import` code, which opens the drawer with it
   * prefilled and runs it once (issue #388). */
  initialCode?: string;
  /** The stored scenario, once it is on disk and the list has been re-read. */
  onImported: (scenario: Scenario) => void;
}) {
  const drawer = useDrawer();

  const openImport = async (code?: string) => {
    const { ImportScenarioForm } = await import("./ImportScenarioForm");
    drawer.open({
      title: "Import a scenario",
      width: "28rem",
      content: (
        <ImportScenarioForm
          initialCode={code}
          onImported={(scenario) => {
            drawer.close();
            onImported(scenario);
          }}
        />
      ),
    });
  };

  // biome-ignore lint/correctness/useExhaustiveDependencies: run once when the deep-link code arrives, not on every drawer identity change
  useEffect(() => {
    if (initialCode) void openImport(initialCode);
  }, [initialCode]);

  return (
    <Button
      variant="outline"
      className="gap-1.5"
      onClick={() => void openImport()}
    >
      <Download className="size-4" /> Import
    </Button>
  );
}
