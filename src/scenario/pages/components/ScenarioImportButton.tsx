/**
 * Import a scenario file someone shared.
 *
 * On both scenario surfaces, because getting hold of a scenario is not an
 * authoring step (issue #861). Import used to live on the Scenario Builder
 * alone, which is advanced-only, so a player handed a `.json` had to turn on
 * Advanced mode to open a file dialog and then never used the editor.
 *
 * What happens afterwards is the page's, since the two readers want different
 * things: the builder opens the editor on the new scenario, and the Scenarios
 * page stays where it is and says the scenario landed.
 */

import { Button } from "@picoframe/frame";
import { open } from "@tauri-apps/plugin-dialog";
import { Download } from "lucide-react";
import { useState } from "react";
import { scenarioImport } from "../../bindings";
import type { Scenario } from "../../model";
import { refreshScenarios } from "../../scenarios";
import { importScenario } from "../../storage";
import { scenarioImportErrorMessage } from "../../transfer";

export function ScenarioImportButton({
  onImported,
  onError,
}: {
  /** The stored scenario, once it is on disk and the list has been re-read. */
  onImported: (scenario: Scenario) => void;
  /** Cleared when a fresh attempt starts, so a stale refusal does not linger. */
  onError: (message: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);

  // Import mints a fresh id and writes the dialogue clips carried in the file,
  // so importing the scenario you exported gives you a second copy rather than
  // overwriting the first.
  const run = async () => {
    onError(null);
    try {
      const src = await open({
        title: "Import scenario",
        multiple: false,
        filters: [{ name: "Coilbox scenario", extensions: ["json"] }],
      });
      if (typeof src !== "string") return;
      setBusy(true);
      const { text } = await scenarioImport({ src });
      const result = await importScenario(text);
      if (!result.ok) {
        onError(scenarioImportErrorMessage(result.error));
        return;
      }
      await refreshScenarios();
      onImported(result.payload);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      variant="outline"
      className="gap-1.5"
      onClick={() => void run()}
      disabled={busy}
    >
      <Download className="size-4" /> Import
    </Button>
  );
}
