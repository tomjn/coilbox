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
import type { InstalledGameInfo } from "@/container/gameIdentity";
import { ErrorBanner } from "@/content/pages/components/states";
import { scenarioExport } from "../../bindings";
import type { Scenario } from "../../model";
import {
  type GatheredScenario,
  gatherScenarioExport,
} from "../../scenarioMedia";
import { encodeScenarioCode, encodeScenarioExport } from "../../transfer";

export function ShareScenarioForm({
  scenario,
  installed,
}: {
  scenario: Scenario;
  /** This machine's games, read only for the modinfo shortname the payload
   * records beside the archive name (issue #1335). The code and the file are
   * built from the same payload, so both carry it or neither does. */
  installed: readonly InstalledGameInfo[];
}) {
  const [gathered, setGathered] = useState<GatheredScenario | null>(null);
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
    await scenarioExport({
      text: encodeScenarioExport(gathered.exported, installed),
      dest,
    });
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

  const result = encodeScenarioCode(gathered.exported, installed);
  return (
    <>
      <MissingClips files={gathered.missing} />
      {result.ok ? (
        <ChallengeCodeView
          code={result.code}
          helpText="Anyone who pastes this into Scenarios → Import gets this mission, its dialogue clips and an offer to download the game and map it is played on."
          onExportFile={saveFile}
        />
      ) : (
        <TooLargeToShare message={result.message} onExportFile={saveFile} />
      )}
    </>
  );
}

/**
 * What the export is short of, said before either route is offered.
 *
 * A share that quietly drops a clip hands somebody a mission whose radio
 * messages have lost their picture and their voice, and nothing on their end
 * can tell that from a mission that never had any (issue #2235). It warns
 * rather than refuses: one unreadable portrait is not a reason to withhold the
 * other ninety per cent of somebody's mission, as long as they know.
 */
function MissingClips({ files }: { files: readonly string[] }) {
  if (files.length === 0) return null;
  return (
    <div className="border-amber-500/40 border-b bg-amber-500/10 p-4 text-amber-200 text-sm">
      <p>
        {files.length === 1
          ? "One dialogue clip could not be read, so it is not in this share:"
          : `${files.length} dialogue clips could not be read, so they are not in this share:`}
      </p>
      <ul className="mt-1 font-mono text-[11px]">
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
      <p className="mt-2">
        Whoever imports it gets those lines with no portrait and no voice.
      </p>
    </div>
  );
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
