import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { describeError } from "@/i18n/uiError";
import { notify } from "@/notify/notify";
import { contentWriteFile } from "../../bindings";
import {
  type CommandRatesCsvInput,
  commandRatesCsv,
  commandRatesCsvFileName,
} from "../../matchStatsCsv";

/**
 * "Export CSV" for the commands per minute chart (#3875). It writes the lines
 * and sender the chart shows. It is a sibling of `MatchStatsExportButton`, which
 * takes the match chart's metric and rows and would need bending to take these.
 */
export function CommandRateExportButton({
  input,
}: {
  input: CommandRatesCsvInput;
}) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);

  async function exportCsv() {
    setBusy(true);
    try {
      const dest = await save({
        title: t`Export commands per minute`,
        defaultPath: commandRatesCsvFileName(input.info, input.source),
        filters: [{ name: t`CSV`, extensions: ["csv"] }],
      });
      if (!dest) return;
      await contentWriteFile({ dest, text: commandRatesCsv(input) });
      void notify({
        title: t`Commands per minute exported.`,
        level: "success",
      });
    } catch (e) {
      const reason = describeError(e);
      void notify({ title: t`Export failed: ${reason}`, level: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="gap-1.5 self-start"
      disabled={busy || input.series.length === 0}
      onClick={exportCsv}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <Download className="size-4" aria-hidden />
      )}
      <Trans>Export CSV</Trans>
    </Button>
  );
}
