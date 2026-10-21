import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { notify } from "@/notify/notify";
import { content3doInstallStatus, contentUndo3doInstall } from "../../bindings";

/**
 * Says so when a `.sdd` game holds a `.3do` conversion written before #4174
 * (issue #4196), which counted each sheet's rows from the bottom, so every face
 * draws from the wrong part of its sheet.
 *
 * Converting again is the fix. When the game still has its `.3do` files that is
 * the drawer. After an install they are moved aside, so the button first undoes
 * the install, which brings them back and shows the convert button.
 */
export function OldConversionNotice({
  gameDir,
  hasOriginals,
  onConvert,
  onRestored,
}: {
  gameDir: string | null;
  /** The game's listing still holds `.3do` files to convert. */
  hasOriginals: boolean;
  onConvert: () => void;
  onRestored: () => void;
}) {
  const [oldSheets, setOldSheets] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameDir) return;
    let live = true;
    content3doInstallStatus({ gameDir })
      .then((res) => live && setOldSheets(res.oldSheets))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [gameDir]);

  if (!gameDir || oldSheets === 0) return null;

  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      await contentUndo3doInstall({ gameDir });
      onRestored();
      void notify({
        title: t`Restored the original models. Convert them again.`,
        level: "success",
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/50 p-2 text-xs">
      <span>
        <Trans>
          The converted models were made by an older coilbox and draw the wrong
          colours.
        </Trans>
      </span>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="ml-auto gap-1.5"
        disabled={busy}
        onClick={hasOriginals ? onConvert : restore}
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
        {hasOriginals ? (
          <Trans>Convert again</Trans>
        ) : (
          <Trans>Restore originals</Trans>
        )}
      </Button>
      {error && <span className="w-full text-destructive">{error}</span>}
    </div>
  );
}
