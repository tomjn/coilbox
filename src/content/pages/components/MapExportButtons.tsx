import { Button } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, ImageDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { HEAT_KIND_OF_LAYER } from "@/lib/heatRamp";
import { notify } from "@/notify/notify";
import { currentVersion } from "../../../updater/updater";
import { contentWriteFile } from "../../bindings";
import {
  type HeatLayerId,
  type LayerAggregate,
  layerLegend,
  type MatchWindow,
  type Normalise,
} from "../../mapAggregate";
import {
  layerCsv,
  layerCsvFileName,
  layerImageFileName,
  type MapExportBasis,
  stampExport,
  startsCsv,
  startsCsvFileName,
} from "../../mapAggregateExport";
import type { MarkPlace } from "../../mapImage";
import { renderMapImage, savePngBytes } from "../../mapImageExport";
import type { StartRecords } from "../../mapRecords";
import type { StartRow } from "../../startNames";

type Kind = "image" | "layer" | "starts";

/**
 * The exports of "How this map is played" (#1165): the picture as a PNG, the
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
  layerSentence,
  drawn,
  normalise,
  window,
  records,
  rows,
  split,
  minimapUrl,
  world,
  dots,
  places,
  showStarts,
}: {
  info: MapExportBasis;
  layer: HeatLayerId | "";
  /** What the layer counts, as the legend names it. */
  layerSentence: string;
  drawn: LayerAggregate | null;
  normalise: Normalise;
  window: MatchWindow;
  records: StartRecords;
  rows: readonly StartRow[];
  /** Whether the start table is split by team. */
  split: boolean;
  minimapUrl: string | undefined;
  world: { worldWidth: number; worldHeight: number };
  dots: readonly MarkPlace[];
  places: readonly MarkPlace[];
  showStarts: boolean;
}) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const stamped = () => stampExport(basis, new Date());

  const field = drawn?.field && drawn.field.peak > 0 ? drawn.field : null;
  const nothing =
    "Nothing in the picture has anything on this layer, so there is nothing to write.";
  const choose = "Choose a density layer first.";
  const layerReason = !layer ? choose : !drawn?.grid ? nothing : null;
  const imageReason = !layer ? choose : !field ? nothing : null;
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

  const exportImage = () => {
    if (!layer || !drawn || !field) return;
    const info = stamped();
    return run(
      "image",
      "Export the picture",
      layerImageFileName(info, layer),
      { name: "PNG image", extensions: ["png"] },
      "Picture exported.",
      async (dest) => {
        const appVersion = await currentVersion().catch(() => null);
        const bytes = await renderMapImage({
          minimapUrl,
          world,
          field,
          kind: HEAT_KIND_OF_LAYER[layer],
          words: {
            info,
            layer,
            layerSentence,
            legend: layerLegend(layer, drawn, normalise, window),
            normalise,
            window,
            contributing: drawn.contributing,
            events: drawn.events,
            appVersion,
            marks: showStarts && (dots.length > 0 || places.length > 0),
          },
          dots: showStarts ? dots : [],
          places: showStarts ? places : [],
        });
        await savePngBytes(dest, bytes);
      },
    );
  };

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
        disabled={busy !== null || imageReason !== null}
        title={
          imageReason ??
          "Saves the map with this layer on it, the legend, and the map, replays, versions, window and filters written under it."
        }
        onClick={exportImage}
      >
        {icon("image", ImageDown)}
        Export picture
      </Button>
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
