/**
 * "Import a blueprint" (issue #1439): paste a share code, or browse to a `.json`
 * file. Both go through the same decode, because a container decodes from either
 * form, so there is one import path and not two.
 *
 * Reading the code is the first of two steps, and the second one is the point of
 * the whole surface. A layout names units by their internal name, so it belongs
 * to a game, and the person taking it has to be told what it is for and whether
 * their game has the units in it before they take it rather than after, when the
 * first sign of trouble would be a base full of buildings that cannot be placed
 * (issue #1444). {@link blueprintArrival} works that out, `../../arrival.ts`
 * says why, and none of it blocks the import: the library holds layouts for
 * every game at once, so keeping somebody else's is a real thing to want.
 */

import { open } from "@tauri-apps/plugin-dialog";
import { useMemo, useState } from "react";

import { ChallengeCodeInput } from "@/challenge/ChallengeCodeInput";
import { identify } from "@/container/container";
import { useUnitsyncScan } from "@/content/config";
import { ErrorBanner } from "@/content/pages/components/states";
import { useGameUnits } from "@/content/useGameUnits";
import { usePreferredTarget } from "@/play/config";
import {
  arrivingGame,
  blueprintArrival,
  gameToCheckAgainst,
} from "../../arrival";
import { appFileIO } from "../../fileIO";
import type { StoredBlueprint } from "../../library";
import type { BlueprintPayload } from "../../payload";
import { saveBlueprint, useBlueprintLibrary } from "../../store";
import {
  blueprintImportErrorMessage,
  readBlueprintContainer,
} from "../../transfer";
import { knownUnits } from "../../units";
import { ArrivingBlueprint } from "./ArrivingBlueprint";

export function ImportBlueprintForm({
  initialCode,
  onImported,
}: {
  /** A confirmed `coilbox://import` code to prefill and read once (issue #388). */
  initialCode?: string;
  /** The stored layout, once it is on disk and the library has been re-read. */
  onImported: (record: StoredBlueprint) => void;
}) {
  const [payload, setPayload] = useState<BlueprintPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { records } = useBlueprintLibrary();
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  // Null only while the scan is still running. A scan that failed answers with
  // no games, which reads as "you have not got that game" and is the truth as
  // far as coilbox can see it, with the failure itself said out loud below.
  const installed = scan.data?.games ?? (scan.loading ? null : []);

  const game = useMemo(
    () => arrivingGame(payload?.game, installed),
    [payload, installed],
  );
  const { units } = useGameUnits(gameToCheckAgainst(game));

  const arrival = useMemo(
    () =>
      payload
        ? blueprintArrival({
            payload,
            taken: records.map((record) => record.layout.name),
            installed,
            known: units.length > 0 ? knownUnits(units) : undefined,
          })
        : null,
    [payload, records, installed, units],
  );

  const decode = async (text: string) => {
    // Whatever was read last goes now rather than on success, so a code that
    // will not read cannot leave the previous layout on screen under an error
    // about a different one, still offering to be kept.
    setPayload(null);
    setError(null);
    const read = readBlueprintContainer(text);
    if (!read.ok) {
      // Name what the paste actually is, the way a scenario import does: "that
      // is a coilbox campaign, not a blueprint" beats a flat "damaged".
      const id = identify(text);
      if (id.warnings.length > 0) throw new Error(id.warnings[0]);
      if (id.kind !== "unknown" && id.kind !== "blueprint") {
        throw new Error(`That code is a coilbox ${id.kind}, not a blueprint.`);
      }
      throw new Error(blueprintImportErrorMessage(read.error));
    }
    setPayload(read.payload);
  };

  const pickFile = async () => {
    const src = await open({
      title: "Import blueprint",
      multiple: false,
      filters: [{ name: "Coilbox blueprint", extensions: ["json"] }],
    });
    if (typeof src !== "string") return null;
    const text = await appFileIO.read(src);
    if (text === null) throw new Error("There is no file there.");
    return text;
  };

  // Minting the id here rather than taking one from the file is what makes
  // importing the layout you exported give you a second copy instead of
  // overwriting the first.
  const take = async () => {
    if (!payload || !arrival) return;
    setError(null);
    setBusy(true);
    try {
      const saved = await saveBlueprint({
        id: crypto.randomUUID(),
        createdAt: "",
        updatedAt: "",
        layout: { ...payload, name: arrival.name },
      });
      onImported(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col">
      <ChallengeCodeInput
        helpText="Paste a blueprint code someone shared, or browse to a blueprint file. Coilbox reads it first and tells you what it is for before anything is kept."
        placeholder="Paste a blueprint code…"
        submitLabel="Read it"
        busyLabel="Reading…"
        fileButtonLabel="Read a file…"
        initialCode={initialCode}
        onImport={decode}
        onPickFile={pickFile}
      />

      {scan.error && (
        <div className="px-4 pb-4">
          <ErrorBanner
            message={`Your games could not be read, so nothing here has been checked against them: ${scan.error}`}
          />
        </div>
      )}

      {error && (
        <div className="px-4 pb-4">
          <ErrorBanner message={`Not saved: ${error}`} />
        </div>
      )}

      {payload && arrival && (
        <ArrivingBlueprint
          payload={payload}
          arrival={arrival}
          busy={busy}
          onTake={() => void take()}
        />
      )}
    </div>
  );
}
