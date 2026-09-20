import { Button, useSetting } from "@picoframe/frame";
import { Download, Loader2 } from "lucide-react";
import { useMemo } from "react";
import { engineVersionRequirement } from "@/content/resolveContent";
import { useResolveContent } from "@/content/useResolveContent";
import {
  useDownloadComplete,
  useDownloadQueue,
} from "@/downloads/DownloadQueueProvider";
import { QueueProgress } from "@/downloads/pages/components/ProgressBar";
import type { PlayTarget } from "@/play/config";
import { AUTO_DOWNLOAD_ON_JOIN_KEY, useAutoDownload } from "./autoDownload";
import type { EngineMatch } from "./engineMatch";

/**
 * The host's engine, offered as a download. It is looked up by exact version in
 * the same catalogues a setup pack uses, which publish nothing for some
 * platforms, so "no download" is an ordinary answer and not an error.
 */
function MissingEngine({
  battleId,
  version,
  target,
  onInstalled,
}: {
  battleId: number;
  version: string;
  target: PlayTarget | null;
  onInstalled: () => void;
}) {
  const req = useMemo(() => engineVersionRequirement(version), [version]);
  const requirements = useMemo(() => [req], [req]);
  const resolve = useResolveContent(requirements, target ?? undefined);
  const status = resolve.statusFor(req);
  const item = resolve.itemFor(req);
  const error = resolve.errorFor(req);
  const busy = status === "active" || status === "queued";

  // Joining a battle is asking to play it, so the engine is fetched the same
  // way the game is, under the same setting, once a build is known to exist.
  const { active, queued } = useDownloadQueue();
  const [autoEnabled] = useSetting<boolean>(AUTO_DOWNLOAD_ON_JOIN_KEY, true);
  useAutoDownload({
    key: `${battleId}:engine:${version}`,
    enabled: autoEnabled,
    writeRootReady: resolve.canDownload(req),
    queueIdle: active == null && queued.length === 0,
    inFlight: busy,
    start: () => resolve.download(req),
  });

  // The room holds its own read of the installed engines, so it has to be told
  // to look again before it can resolve the one that just arrived.
  useDownloadComplete((done) => {
    if (done.kind === "engineRecoil" || done.kind === "engineSpring") {
      onInstalled();
    }
  });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2">
      <p className="text-amber-700 dark:text-amber-400">
        You do not have the host's engine, so the host will refuse your
        connection.
      </p>
      {item && status === "active" ? (
        <QueueProgress item={item} />
      ) : resolve.canDownload(req) ? (
        <Button
          size="sm"
          className="self-start"
          disabled={busy}
          onClick={() => resolve.download(req)}
        >
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Download className="size-4" />
          )}
          {status === "queued" ? "Queued…" : `Download ${version}`}
        </Button>
      ) : resolve.noWriteRoot ? (
        <p className="text-xs text-muted-foreground">
          Set a download folder in Downloads settings to download it.
        </p>
      ) : (
        !resolve.loading && (
          <p className="text-xs text-muted-foreground">
            No download was found for this version on this platform. Install it
            yourself in Settings, Engines.
          </p>
        )
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * The engine the host asked for beside the one this machine would launch. The
 * host's engine turns away any other version and says why only in its own log,
 * so both are named here before the game starts.
 */
export function BattleEngineCard({
  battleId,
  match,
  version,
  target,
  onInstalled,
  unreadable,
}: {
  /** The joined battle's id, so the engine is fetched once per battle. */
  battleId: number;
  match: EngineMatch;
  /** The host's version as the lobby gave it, which a download is matched on. */
  version: string;
  target: PlayTarget | null;
  onInstalled: () => void;
  /** The engine was asked for its version and would not say. */
  unreadable: boolean;
}) {
  const { verdict, hostLabel, mineLabel } = match;

  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/50 bg-card p-4 text-sm">
      <span className="font-semibold">Engine</span>
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Host</dt>
        <dd className="break-words">{hostLabel ?? "Not given by the lobby"}</dd>
        <dt className="text-muted-foreground">Yours</dt>
        <dd className="break-words">
          {mineLabel ??
            (verdict !== "unverified"
              ? "None"
              : unreadable
                ? "Unknown"
                : "Checking…")}
        </dd>
      </dl>
      {verdict === "mismatch" && (
        <MissingEngine
          battleId={battleId}
          version={version.trim()}
          target={target}
          onInstalled={onInstalled}
        />
      )}
      {verdict === "unverified" && unreadable && (
        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-700 dark:text-amber-400">
          Your engine would not report its version, so it cannot be checked
          against the host's. Pick another in Settings, Engines.
        </p>
      )}
    </div>
  );
}
