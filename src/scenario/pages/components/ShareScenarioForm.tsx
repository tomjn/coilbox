/**
 * "Share this scenario" (issue #1336): a pasteable code, a `coilbox://` link and
 * a `.json` file, the three routes every other shareable kind already offers.
 *
 * Before this a scenario could only leave coilbox as a file, so sharing one in
 * chat meant attaching it. The file export is still here and still writes the
 * same container text, it is now one of three buttons rather than the only one.
 *
 * A scenario is the only shareable kind with no upper bound on size, because its
 * dialogue portraits and voice clips travel inside the export. When they push it
 * past what a code can carry, this says so and offers the file alone, rather
 * than handing out a code that fails to inflate on the far side. See
 * `encodeScenarioCode`.
 */

import { Button } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ChallengeCodeView } from "@/challenge/ChallengeCodeView";
import { ErrorBanner } from "@/content/pages/components/states";
import { scenarioExport } from "../../bindings";
import type { Scenario } from "../../model";
import { gatherScenarioExport } from "../../storage";
import {
  encodeScenarioCode,
  encodeScenarioExport,
  type ScenarioExport,
} from "../../transfer";

export function ShareScenarioForm({ scenario }: { scenario: Scenario }) {
  const [gathered, setGathered] = useState<ScenarioExport | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Reading the clips off disk is the slow part, so it happens once when the
  // drawer opens and both share routes use the result.
  useEffect(() => {
    let live = true;
    gatherScenarioExport(scenario)
      .then((value) => live && setGathered(value))
      .catch(
        (e) => live && setError(e instanceof Error ? e.message : String(e)),
      );
    return () => {
      live = false;
    };
  }, [scenario]);

  const saveFile = async () => {
    if (!gathered) return;
    const dest = await save({
      title: "Export scenario",
      defaultPath: `${scenario.name || "scenario"}.json`,
      filters: [{ name: "Coilbox scenario", extensions: ["json"] }],
    });
    if (!dest) return;
    await scenarioExport({ text: encodeScenarioExport(gathered), dest });
  };

  if (error) {
    return (
      <div className="p-4">
        <ErrorBanner message={error} />
      </div>
    );
  }

  if (!gathered) {
    return (
      <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" aria-hidden /> Gathering the
        scenario and its dialogue clips…
      </p>
    );
  }

  const result = encodeScenarioCode(gathered);
  if (result.ok) {
    return (
      <ChallengeCodeView
        code={result.code}
        helpText="Anyone who pastes this into Scenarios → Import gets this mission, its dialogue clips and an offer to download the game and map it is played on."
        onExportFile={saveFile}
      />
    );
  }

  return <TooLargeToShare message={result.message} onExportFile={saveFile} />;
}

/**
 * The refusal. Shown instead of a code, never alongside one: a code that cannot
 * be inflated on the far side must not be copyable at all, or it ends up pasted
 * somewhere nobody can take it back from.
 */
function TooLargeToShare({
  message,
  onExportFile,
}: {
  message: string;
  onExportFile: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      await onExportFile();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-muted-foreground">{message}</p>
      {error && <ErrorBanner message={error} />}
      <Button onClick={run} disabled={busy}>
        <Download className="mr-1.5 size-4" aria-hidden />
        {busy ? "Exporting…" : "Export as file"}
      </Button>
    </div>
  );
}
