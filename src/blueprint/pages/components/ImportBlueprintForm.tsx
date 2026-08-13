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
 *
 * The side conversion is offered here too (issue #1467), and it is the one thing
 * on this screen that is not a check. Both sides of a game live in one game, so
 * an Armada layout has every unit a Cortex player has installed and nothing
 * above finds anything wrong with it. What can be said is whose buildings it is
 * made of, which needs the game's sides rather than its unit list, and it is
 * said only where that can be worked out at all.
 *
 * What the kept copy records about where it came from depends on which of the
 * three doors it walked through, because they know different amounts (issue
 * #1473). A file names itself. A hub import names the item and, when the screen
 * that started it had read one, the author. A pasted code names nothing, and
 * the record says so rather than inventing a provenance.
 */

import { open } from "@tauri-apps/plugin-dialog";
import { useMemo, useRef, useState } from "react";

import { ChallengeCodeInput } from "@/challenge/ChallengeCodeInput";
import { identify } from "@/container/container";
import { useUnitsyncScan } from "@/content/config";
import { ErrorBanner } from "@/content/pages/components/states";
import { useGameUnits } from "@/content/useGameUnits";
import { notedHubItem } from "@/hub/importRecord";
import { usePreferredTarget } from "@/play/config";
import {
  arrivingGame,
  blueprintArrival,
  gameToCheckAgainst,
} from "../../arrival";
import { useEquivalents } from "../../equivalentsStore";
import { appFileIO } from "../../fileIO";
import { buildingFootprints } from "../../footprint";
import {
  type BlueprintSource,
  codeSource,
  fileSource,
  hubSource,
  type StoredBlueprint,
} from "../../library";
import type { BlueprintPayload } from "../../payload";
import { saveBlueprint, useBlueprintLibrary } from "../../store";
import {
  planForSide,
  sideOffer,
  substitutePayload,
  substitutionNotes,
} from "../../substitution";
import {
  blueprintImportErrorMessage,
  readBlueprintContainer,
} from "../../transfer";
import { knownUnits } from "../../units";
import { useGameSides } from "../../useGameSides";
import { ArrivingBlueprint } from "./ArrivingBlueprint";

/**
 * Which of the three doors this copy came through (issue #1473).
 *
 * The hub first, because a hub import is also a code and also arrives here: it
 * is the one that knows the most, so it wins. The author is whatever the screen
 * that started the import had already read off the hub, and its absence is not
 * worth a fetch: the id is the fact worth keeping and the hub keeps the rest.
 */
function arrivedBy(
  hubItemId: string | undefined,
  file: string | null,
  wasCalled?: string,
): BlueprintSource {
  if (hubItemId) {
    const noted = notedHubItem(hubItemId);
    return hubSource({ item: hubItemId, author: noted?.author }, wasCalled);
  }
  return file ? fileSource(file, wasCalled) : codeSource(wasCalled);
}

export function ImportBlueprintForm({
  initialCode,
  hubItemId,
  onImported,
}: {
  /** A confirmed `coilbox://import` code to prefill and read once (issue #388). */
  initialCode?: string;
  /** The hub item this code came off, when the hub started the import. */
  hubItemId?: string;
  /** The stored layout, once it is on disk and the library has been re-read. */
  onImported: (record: StoredBlueprint) => void;
}) {
  const [payload, setPayload] = useState<BlueprintPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The file the next read is coming out of, set by the browse button and
  // taken by the read that follows it. A pasted code sets nothing, so what is
  // here is the difference between a file import and a code import: the two
  // share one decode, and the paste box does not know which of them ran.
  const cameFromFile = useRef<string | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  /** The side the layout is being taken as, empty for the one it was drawn in
   *  (issue #1467). */
  const [takingAs, setTakingAs] = useState("");

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
  const { units, archive } = useGameUnits(gameToCheckAgainst(game));
  const sides = useGameSides(archive);
  // What somebody already said about this game's sides (issue #1468). Read only:
  // an import offers whole sides rather than rows, so there is no answer here
  // that was not already in the table or read off a name.
  const { table } = useEquivalents(archive);
  const known = useMemo(() => knownUnits(units), [units]);
  const footprintOf = useMemo(
    () => (units.length > 0 ? buildingFootprints(units) : undefined),
    [units],
  );

  // Which side the layout is written in and which sides this game has it in,
  // both read off the layout as it arrived rather than off the converted one,
  // so the choice below stays the same choice after it has been made.
  const offer = useMemo(
    () =>
      payload
        ? sideOffer(
            payload.buildings.map((building) => building.def),
            sides,
            known,
            table,
          )
        : undefined,
    [payload, sides, known, table],
  );

  // The layout as it will be kept: converted where a side has been picked, and
  // exactly as it arrived otherwise. Everything below reads this, so the
  // drawing, the missing-unit check and the save are all about the same layout.
  const converted = useMemo(
    () =>
      payload && takingAs
        ? substitutePayload(
            payload,
            planForSide(
              payload.buildings.map((building) => building.def),
              takingAs,
              sides,
              known,
              table,
            ),
            footprintOf,
          )
        : null,
    [payload, takingAs, sides, known, footprintOf, table],
  );
  const keeping = converted?.payload ?? payload;

  const arrival = useMemo(
    () =>
      keeping
        ? blueprintArrival({
            payload: keeping,
            taken: records.map((record) => record.layout.name),
            installed,
            known: units.length > 0 ? known : undefined,
          })
        : null,
    [keeping, records, installed, units, known],
  );

  const decode = async (text: string) => {
    // Whatever was read last goes now rather than on success, so a code that
    // will not read cannot leave the previous layout on screen under an error
    // about a different one, still offering to be kept.
    setPayload(null);
    setError(null);
    // A side picked for the last layout says nothing about this one, and the
    // sides a game has are not the sides the next game has.
    setTakingAs("");
    const file = cameFromFile.current;
    cameFromFile.current = null;
    setFrom(file);
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
    cameFromFile.current = src;
    return text;
  };

  // Minting the id here rather than taking one from the file is what makes
  // importing the layout you exported give you a second copy instead of
  // overwriting the first.
  const take = async () => {
    if (!keeping || !arrival) return;
    setError(null);
    setBusy(true);
    try {
      const saved = await saveBlueprint({
        id: crypto.randomUUID(),
        createdAt: "",
        updatedAt: "",
        layout: { ...keeping, name: arrival.name },
        source: arrivedBy(hubItemId, from, arrival.wasCalled),
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

      {keeping && arrival && (
        <ArrivingBlueprint
          payload={keeping}
          arrival={arrival}
          busy={busy}
          onTake={() => void take()}
          conversion={
            offer && {
              offer,
              takingAs,
              notes: converted ? substitutionNotes(converted.report) : [],
              onTakeAs: setTakingAs,
            }
          }
        />
      )}
    </div>
  );
}
