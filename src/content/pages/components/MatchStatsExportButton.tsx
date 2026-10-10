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
 * Closing the save dialog is a decision, not a failure, so it says nothing.
 */
export function MatchStatsExportButton({
  input,
}: {
  input: MatchStatsCsvInput;
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
      disabled={busy}
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
