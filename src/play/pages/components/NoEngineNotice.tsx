import { Button } from "@picoframe/frame";
import { Download, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { useWriteRoot } from "@/downloads/config";
import { fetchNewestRecoil } from "@/downloads/engineInstall";
import { skirmishEngineOffer } from "../../engineOffer";
import { useLaunchContent } from "../../LaunchContentProvider";
import { launchRequirements } from "../../launchContent";

const boxClass =
  "rounded-md border border-border/50 bg-card p-3 text-sm text-muted-foreground";

/**
 * Shown by the skirmish page when it has no engine to run. Offers to download
 * one through the shared launch check (issue #3365), or points at the content
 * folders setting when nothing can be downloaded.
 *
 * `refresh` reads the page's installed engines again. The page holds its own
 * read, so it cannot see the engine this downloads until told to look.
 */
export function NoEngineNotice({
  targetLoading,
  refresh,
}: {
  targetLoading: boolean;
  refresh: () => Promise<void>;
}) {
  const writeRoot = useWriteRoot();
  const { ensureContent } = useLaunchContent();
  const [newest, setNewest] = useState<{
    loaded: boolean;
    version: string | null;
  }>({ loaded: false, version: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchNewestRecoil()
      .then(({ release }) => {
        if (!cancelled)
          setNewest({ loaded: true, version: release?.version ?? null });
      })
      .catch(() => {
        if (!cancelled) setNewest({ loaded: true, version: null });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const offer = skirmishEngineOffer({
    hasTarget: false,
    targetLoading,
    writeRoot,
    newestEngine: newest,
  });

  async function download(version: string) {
    setBusy(true);
    try {
      const check = await ensureContent({
        requirements: launchRequirements({ engineVersion: version }),
        title: "Download an engine to play",
      });
      if (check.ready) await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (offer.kind === "download") {
    return (
      <div className={`${boxClass} flex flex-col items-start gap-2`}>
        <p>
          No engine is installed. Download engine {offer.version} to play a
          skirmish.
        </p>
        <Button
          size="sm"
          disabled={busy}
          onClick={() => download(offer.version)}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          Download engine
        </Button>
      </div>
    );
  }

  if (offer.kind === "settings") {
    return (
      <p className={boxClass}>
        No engine found. Add a content folder with an engine in{" "}
        <Link
          className="font-medium underline underline-offset-4"
          to="/settings/content-folders"
        >
          Settings → Content folders
        </Link>{" "}
        first.
      </p>
    );
  }

  return null;
}
