import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import type { GameRef } from "../../../conquest/model";
import { type GameDownload, gameRequirement } from "../../gameOffer";
import { useLaunchContent } from "../../LaunchContentProvider";

/**
 * Download the game a galaxy names, through the shared launch check (issue
 * #3368). The check opens the download drawer and resolves once the game is
 * installed, or when the player closes the drawer.
 *
 * `onReady` runs after an install. The page holds its own read of what is
 * installed, so it cannot see the game this downloads until told to look again.
 * The button stays disabled while the check is open.
 */
export function DownloadGameButton({
  game,
  download,
  onReady,
  variant,
  className,
}: {
  game: GameRef;
  download: GameDownload;
  onReady: () => void | Promise<void>;
  variant?: "default" | "outline";
  className?: string;
}) {
  const { t } = useLingui();
  const { ensureContent } = useLaunchContent();
  const gameLabel = download.label;
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const check = await ensureContent({
        requirements: [gameRequirement(game, download)],
        title: t`Download ${gameLabel}`,
      });
      // The queue forgot the scans when the download finished.
      if (check.ready) await onReady();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      variant={variant}
      className={className}
      disabled={busy}
      onClick={onClick}
    >
      {busy ? (
        <Loader2 className="mr-1.5 size-4 animate-spin" aria-hidden />
      ) : (
        <Download className="mr-1.5 size-4" aria-hidden />
      )}
      <Trans>Download {gameLabel}</Trans>
    </Button>
  );
}
