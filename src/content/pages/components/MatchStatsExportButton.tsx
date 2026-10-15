import { Button } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { notify } from "@/notify/notify";
import { contentWriteFile } from "../../bindings";
import {
  type MatchStatsCsvInput,
  matchStatsCsv,
  matchStatsCsvFileName,
} from "../../matchStatsCsv";

/**
 * "Export CSV" for the match statistics controls (#1172). It writes the lines the
 * chart is drawing, in the value mode on screen, to a path the reader picks.
 * Lines unchecked in the roster are not drawn, so they are not in the file
 * either, and the tooltip says how many were left out. Closing the save dialog
 * is a decision, not a failure, so it says nothing.
 */
export function MatchStatsExportButton({
  input,
  hiddenCount = 0,
}: {
  input: MatchStatsCsvInput;
  /** Lines the roster has unchecked, which the file leaves out. */
  hiddenCount?: number;
}) {
  const [busy, setBusy] = useState(false);

  async function exportCsv() {
    setBusy(true);
    try {
      const dest = await save({
        title: "Export match statistics",
        defaultPath: matchStatsCsvFileName(input.info, input.metric),
        filters: [{ name: "CSV", extensions: ["csv"] }],
      });
      if (!dest) return;
      await contentWriteFile({ dest, text: matchStatsCsv(input) });
      void notify({ title: "Match statistics exported.", level: "success" });
    } catch (e) {
      void notify({
        title: `Export failed: ${e instanceof Error ? e.message : e}`,
        level: "error",
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5"
      disabled={busy || input.series.length === 0}
      title={
        hiddenCount > 0
          ? `Writes the lines on the chart. ${hiddenCount} unchecked in the roster ${hiddenCount === 1 ? "is" : "are"} left out.`
          : "Writes every line on the chart. Nothing is hidden."
      }
      onClick={exportCsv}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Download className="size-4" aria-hidden />
      )}
      Export CSV
    </Button>
  );
}
