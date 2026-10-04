import { Button } from "@picoframe/frame";
import { ChevronRight, Download, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { EngineRelease } from "../../../downloads/bindings";
import { useWriteRoot } from "../../../downloads/config";
import { fetchNewestRecoil } from "../../../downloads/engineInstall";
import { QueueProgress } from "../../../downloads/pages/components/ProgressBar";
import { useQueuedDownload } from "../../../downloads/useQueuedDownload";
import { type MissionNeed, needNotice } from "../../missionNeeds";
import type { CampaignMission } from "../../model";
import { PhaseCard } from "./PhaseCard";

const KIND_LABEL = { engine: "Engine", game: "Game", map: "Map" } as const;

/** The newest Recoil release, which is what a campaign gets when it names no
 *  engine, or why there is none to offer. */
function useNewestEngine(wanted: boolean) {
  const [release, setRelease] = useState<EngineRelease | null | undefined>();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    fetchNewestRecoil()
      .then((r) => !cancelled && setRelease(r.release))
      .catch((e) => !cancelled && setError(String(e?.message ?? e)));
    return () => {
      cancelled = true;
    };
  }, [wanted]);
  return { release, error };
}

/**
 * One thing the mission is short of, with its own download button and its own
 * progress, so the engine, the game and the map all look and behave the same.
 */
function NeedRow({
  mission,
  need,
  onInstalled,
}: {
  mission: CampaignMission;
  need: MissionNeed;
  onInstalled: (need: MissionNeed) => Promise<void>;
}) {
  const writeRoot = useWriteRoot();
  const writePath = writeRoot.path;
  const newest = useNewestEngine(need.kind === "engine");
  const input =
    need.kind === "map"
      ? ({
          kind: "map",
          label: `Map: ${need.name}`,
          args: {
            springName: mission.mapDownload?.springName ?? need.name,
            searchUrl: mission.mapDownload?.searchUrl,
            writePath,
          },
        } as const)
      : need.kind === "game"
        ? ({
            kind: "game",
            label: `Game: ${need.name}`,
            args: { gameName: need.name, writePath },
          } as const)
        : writePath && newest.release
          ? ({
              kind: "engineRecoil",
              label: `Engine ${newest.release.version}`,
              args: {
                version: newest.release.version,
                assetUrl: newest.release.assetUrl,
                writePath,
              },
            } as const)
          : null;
  const dl = useQueuedDownload(input);

  const notice = needNotice({
    need,
    failure: dl.error ?? newest.error,
    engineRelease:
      newest.release === undefined || newest.error
        ? "pending"
        : newest.release === null
          ? "none"
          : "found",
    // Only an engine cannot be fetched without a folder to put it in. A game or
    // map can still go to the default place, as the map download always could.
    noWriteRoot: need.kind === "engine" && !writeRoot.loading && !writePath,
  });

  const download = async () => {
    const settled = await dl.start();
    if (settled?.status !== "done") return;
    await onInstalled(need);
  };

  return (
    <li className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        {KIND_LABEL[need.kind]}
        {need.name && (
          <>
            {": "}
            <span className="font-medium text-foreground">{need.name}</span>
          </>
        )}
      </p>
      {need.kind === "engine" && (
        <p className="text-xs text-muted-foreground">
          This mission does not name an engine, so the newest one is offered.
        </p>
      )}
      {notice.message && (
        <Alert variant="destructive" className="p-3">
          <AlertDescription className="text-destructive">
            {notice.message}
          </AlertDescription>
        </Alert>
      )}
      <Button
        onClick={download}
        disabled={dl.busy || !notice.canDownload || !input}
        className="w-fit"
      >
        {dl.busy ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Download className="size-4" />
        )}
        {dl.status === "queued"
          ? "Waiting for a slot…"
          : dl.busy
            ? "Downloading…"
            : "Download & Install"}
      </Button>
      {dl.busy && <QueueProgress item={dl} />}
      {/* Best-effort by name can miss content whose name differs, so the
          Downloads page stays as the fallback. There is no page for an engine
          offer: its notice sends the player to Settings. */}
      {need.kind !== "engine" && (
        <Link
          to={need.kind === "map" ? "/downloads/maps" : "/downloads/games"}
          className="inline-flex w-fit items-center gap-1 text-xs text-muted-foreground hover:underline"
        >
          Find it in Downloads <ChevronRight className="size-3.5" />
        </Link>
      )}
    </li>
  );
}

/**
 * Shown in place of the briefing while the mission is short of an engine, its
 * game or its map (issue #3366). One card for all three, each with the same
 * inline download and progress the map always had, so the player is never sent
 * to the Downloads screen to find the right game and come back.
 *
 * `onInstalled` is the page's: it rescans, so the card clears and the briefing
 * takes over without a reload.
 */
export function MissionNeedsPanel({
  mission,
  needs,
  onInstalled,
}: {
  mission: CampaignMission;
  needs: MissionNeed[];
  onInstalled: (need: MissionNeed) => Promise<void>;
}) {
  return (
    <PhaseCard>
      <div className="flex items-center gap-2">
        <Download className="size-5 text-muted-foreground" />
        <h2 className="text-lg font-semibold">
          {needs.length === 1
            ? `${KIND_LABEL[needs[0].kind]} required`
            : "Content required"}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">
        This mission needs the following installed before you can play it.
      </p>
      <ul className="flex flex-col gap-4">
        {needs.map((need) => (
          <NeedRow
            key={`${need.kind}:${need.name}`}
            mission={mission}
            need={need}
            onInstalled={onInstalled}
          />
        ))}
      </ul>
    </PhaseCard>
  );
}
