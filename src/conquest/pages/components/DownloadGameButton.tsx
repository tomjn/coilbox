import { Button } from "@picoframe/frame";
import { Download, Loader2 } from "lucide-react";
import { useState } from "react";
import { invalidateScans } from "../../../content/config";
import { useLaunchContent } from "../../../play/LaunchContentProvider";
import { type GameDownload, gameRequirement } from "../../gameOffer";
import type { GameRef } from "../../model";

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
  const { ensureContent } = useLaunchContent();
  const [busy, setBusy] = useState(false);

  async function onClick() {
    setBusy(true);
    try {
      const check = await ensureContent({
        requirements: [gameRequirement(game, download)],
        title: `Download ${download.label}`,
      });
      if (check.ready) {
        invalidateScans();
        await onReady();
      }
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
      Download {download.label}
    </Button>
  );
}
