/**
 * "Import a scenario" (issue #1336): paste a share code, or browse to a `.json`
 * file. Both go through the same decode, because a container decodes from either
 * form, so there is one import path and not two.
 *
 * Import used to be a file dialog and nothing else, which made a scenario the
 * one shareable kind you could not simply paste in. The file route is unchanged
 * and still the second button here.
 *
 * The file is decoded first and stored last, with the shared resolve-content
 * gate in between (issue #822), so a scenario set in a game this machine does
 * not have offers to fetch it rather than landing and failing at launch.
 */

import { open } from "@tauri-apps/plugin-dialog";
import { useState } from "react";
import { ChallengeCodeInput } from "@/challenge/ChallengeCodeInput";
import { identify } from "@/container/container";
import { ResolveContentGate } from "@/content/pages/components/ResolveContentDrawer";
import { usePreferredTarget } from "@/play/config";
import { scenarioImport } from "../../bindings";
import type { Scenario } from "../../model";
import { refreshScenarios } from "../../scenarios";
import { storeScenario } from "../../storage";
import {
  readScenarioExport,
  type ScenarioExport,
  scenarioContentRequirements,
  scenarioImportErrorMessage,
} from "../../transfer";

export function ImportScenarioForm({
  initialCode,
  onImported,
}: {
  /** A confirmed `coilbox://import` code to prefill and run once (issue #388). */
  initialCode?: string;
  /** The stored scenario, once it is on disk and the list has been re-read. */
  onImported: (scenario: Scenario) => void;
}) {
  const [pending, setPending] = useState<ScenarioExport | null>(null);
  const { target, loading: targetLoading } = usePreferredTarget();

  const decode = async (text: string) => {
    const read = readScenarioExport(text);
    if (!read.ok) {
      // Identify the paste so a mystery code gets a specific message, the way a
      // setup pack import does: "that's a campaign, not a scenario" rather than
      // a flat "damaged".
      const id = identify(text);
      if (id.warnings.length > 0) throw new Error(id.warnings[0]);
      if (id.kind !== "unknown" && id.kind !== "scenario") {
        throw new Error(`That code is a coilbox ${id.kind}, not a scenario.`);
      }
      throw new Error(scenarioImportErrorMessage(read.error));
    }
    setPending(read.payload);
  };

  const pickFile = async () => {
    const src = await open({
      title: "Import scenario",
      multiple: false,
      filters: [{ name: "Coilbox scenario", extensions: ["json"] }],
    });
    if (typeof src !== "string") return null;
    const { text } = await scenarioImport({ src });
    return text;
  };

  // Only once the gate says the game and map are installed. Storing mints a
  // fresh id and writes the dialogue clips carried in the file, so importing the
  // scenario you exported gives you a second copy rather than overwriting the
  // first.
  const store = async (exported: ScenarioExport) => {
    const saved = await storeScenario(exported);
    await refreshScenarios();
    setPending(null);
    onImported(saved);
  };

  return (
    <>
      <ChallengeCodeInput
        helpText="Paste a scenario code someone shared, or browse to a scenario file. Either way you get the mission, its dialogue clips, and an offer to download the game and map it needs."
        placeholder="Paste a scenario code…"
        submitLabel="Import scenario"
        busyLabel="Checking…"
        fileButtonLabel="Import from file…"
        initialCode={initialCode}
        onImport={decode}
        onPickFile={pickFile}
      />
      {pending && (
        <ResolveContentGate
          title="Set up this scenario"
          description="This scenario is played on a game or a map you don't have. Download what is missing below, or cancel. Nothing is imported until it is all here."
          requirements={scenarioContentRequirements(pending.scenario)}
          target={target ?? undefined}
          targetLoading={targetLoading}
          onContinue={() => store(pending)}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
