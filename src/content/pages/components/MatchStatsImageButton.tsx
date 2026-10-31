import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { save } from "@tauri-apps/plugin-dialog";
import { ImageDown, Loader2 } from "lucide-react";
import { useState } from "react";
import { describeError } from "@/i18n/uiError";
import { notify } from "@/notify/notify";
import { savePngBytes } from "../../mapImageExport";
import {
  type MatchStatsImageInput,
  matchStatsImageFileName,
} from "../../matchStatsImage";
import { renderMatchStatsImage } from "../../matchStatsImageExport";

/**
 * "Export image" for the match statistics controls (#3836). It saves the lines
 * the chart is drawing as a PNG with the map, date, players, metric, view, value
 * mode and game id written on it. The picture is drawn from `input` and never
 * from the live chart, so a hover or a selected line does not reach it. Closing
 * the save dialog is a decision, not a failure, so it says nothing.
 */
export function MatchStatsImageButton({
  input,
}: {
  input: MatchStatsImageInput;
}) {
  const { t } = useLingui();
  const [busy, setBusy] = useState(false);

  async function exportImage() {
    setBusy(true);
    try {
      const dest = await save({
        title: t`Export match statistics image`,
        defaultPath: matchStatsImageFileName(
          input.info,
          input.metric,
          input.view,
          input.mode,
        ),
        filters: [{ name: t`PNG image`, extensions: ["png"] }],
      });
      if (!dest) return;
      await savePngBytes(dest, await renderMatchStatsImage(input));
      void notify({
        title: t`Match statistics image exported.`,
        level: "success",
      });
    } catch (e) {
      const reason = describeError(e);
      void notify({
        title: t`Export failed: ${reason}`,
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
      title={t`Saves the chart as a PNG with the map, date, players, metric and game id written on it.`}
      onClick={exportImage}
    >
      {busy ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <ImageDown className="size-4" aria-hidden />
      )}
      <Trans>Export image</Trans>
    </Button>
  );
}
