import { Button } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { notify } from "@/notify/notify";
import { contentWriteFile } from "../../bindings";
import type {
  HeatLayerId,
  LayerAggregate,
  MatchWindow,
  Normalise,
} from "../../mapAggregate";
import {
  layerCsv,
  layerCsvFileName,
  type MapExportBasis,
  stampExport,
  startsCsv,
  startsCsvFileName,
} from "../../mapAggregateExport";
import type { StartRecords } from "../../mapRecords";
import type { StartRow } from "../../startNames";

type Kind = "layer" | "starts";

/**
 * The exports of "How this map is played" (#1165): the
 * layer on screen as a CSV of its cells, and the start positions as a second
 * CSV. Each is disabled with its reason as the tooltip when there is nothing to
 * write. Closing the save dialog is a decision and says nothing.
 *
 * `drawn` carries the layer's grid as a property that is not enumerable, so it
 * can travel as a prop without the development build walking every cell.
 */
export function MapExportButtons({
  info: basis,
  layer,
  drawn,
  normalise,
  window,
  records,
  rows,
  split,
}: {
  info: MapExportBasis;
  layer: HeatLayerId | "";
  drawn: LayerAggregate | null;
  normalise: Normalise;
  window: MatchWindow;
  records: StartRecords;
  rows: readonly StartRow[];
  /** Whether the start table is split by team. */
  split: boolean;
}) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const stamped = () => stampExport(basis, new Date());

  const layerReason = !layer
    ? "Choose a density layer first."
    : !drawn?.grid
      ? "Nothing in the picture has anything on this layer, so there is nothing to write."
      : null;
  const startsReason =
    rows.length === 0
      ? "No start position is counted for these matches."
      : null;

  async function run(
    kind: Kind,
    title: string,
    defaultPath: string,
    filter: { name: string; extensions: string[] },
    done: string,
    write: (dest: string) => Promise<void>,
  ) {
    setBusy(kind);
    try {
      const dest = await save({ title, defaultPath, filters: [filter] });
      if (!dest) return;
      await write(dest);
      void notify({ title: done, level: "success" });
    } catch (e) {
      void notify({
        title: `Export failed: ${e instanceof Error ? e.message : e}`,
        level: "error",
      });
    } finally {
      setBusy(null);
    }
  }

  const csv = { name: "CSV", extensions: ["csv"] };

  const exportLayer = () => {
    if (!layer || !drawn?.grid) return;
    const info = stamped();
    const grid = drawn.grid;
    return run(
      "layer",
      "Export the layer as CSV",
      layerCsvFileName(info, layer),
      csv,
      "Layer exported.",
      (dest) =>
        contentWriteFile({
          dest,
          text: layerCsv({
            info,
            layer,
            normalise,
            window,
            contributing: drawn.contributing,
            grid,
          }),
        }).then(() => undefined),
    );
  };

  const exportStarts = () => {
    const info = stamped();
    return run(
      "starts",
      "Export the start positions as CSV",
      startsCsvFileName(info),
      csv,
      "Start positions exported.",
      (dest) =>
        contentWriteFile({
          dest,
          text: startsCsv({ info, records, rows, split }),
        }).then(() => undefined),
    );
  };

  const icon = (kind: Kind, plain: typeof Download) => {
    const Icon = busy === kind ? Loader2 : plain;
    return (
      <Icon
        className={`size-4${busy === kind ? " animate-spin" : ""}`}
        aria-hidden
      />
    );
  };

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="map-export">
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={busy !== null || layerReason !== null}
        title={
          layerReason ??
          "Writes this layer's cells before smoothing, one row each, with the numbers behind them. A cell that is not in the file holds nothing."
        }
        onClick={exportLayer}
      >
        {icon("layer", Download)}
        Export layer CSV
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={busy !== null || startsReason !== null}
        title={
          startsReason ??
          "Writes each start position with how many times it was taken and how many of those won."
        }
        onClick={exportStarts}
      >
        {icon("starts", Download)}
        Export start positions CSV
      </Button>
    </div>
  );
}
