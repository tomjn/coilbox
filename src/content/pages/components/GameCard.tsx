import { Button, cn } from "@picoframe/frame";
import { Download, Loader2, Play, RefreshCw, X } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Badge } from "@/components/ui/badge";
import {
  type ProgressSource,
  QueueProgress,
  StartingBar,
} from "@/downloads/pages/components/ProgressBar";
import { assetCdnBase } from "@/hub/assets/tier";
import { useTrustedHubUrl } from "@/hub/config";
import { hubIconUrl } from "@/hub/gameIcons";
import { generatedGameNote } from "@/lib/generatedGames";
import { versionLabel } from "@/lib/utils";
import {
  useBrandingEntry,
  useBrandingImage,
  useCachedImage,
} from "../../branding";
import { isSdd } from "../../format";
import { missingDependencyNotes } from "../../gameDependencies";
import type { LibraryGame } from "../../library";
import { sourceKinds } from "../../libraryGames";
import { GameCardShell } from "./GameCardShell";

const BADGE_TONES = {
  installed: "bg-emerald-600 text-white",
  update: "bg-amber-500 text-amber-950",
  downloading: "bg-sky-600 text-white",
  queued: "bg-sky-600 text-white",
  local: "bg-slate-600 text-white",
} as const;

function StateBadge({ game }: { game: LibraryGame }) {
  const { state } = game;
  if (state === "available" || state === "noSource") return null;
  const label =
    state === "installed"
      ? "Installed"
      : state === "update"
        ? game.update?.version
          ? `Update ${game.update.version}`
          : "Update"
        : state === "downloading"
          ? "Downloading"
          : state === "queued"
            ? "Queued"
            : "Local";
  return (
    <Badge className={cn("rounded-sm shadow-sm", BADGE_TONES[state])}>
      {label}
    </Badge>
  );
}

/** The caption's second line: the version on disk, or where it comes from. */
function subtitleOf(game: LibraryGame, hubRead: boolean): ReactNode {
  if (game.state === "noSource") {
    return <span className="text-xs text-destructive">no download source</span>;
  }
  const version = game.installed[0]?.info.version;
  const shown = version ? versionLabel(version) : null;
  const parts =
    game.state === "update"
      ? [shown ? `${shown} installed` : "installed"]
      : game.state === "local"
        ? [shown, hubRead && "not on the hub"]
        : game.state === "installed"
          ? [shown, ...sourceKinds(game)]
          : sourceKinds(game);
  const text = parts.filter(Boolean).join(" · ");
  return text ? (
    <span className="truncate text-xs text-muted-foreground" title={text}>
      {text}
    </span>
  ) : null;
}

/** Sits above the card's stretched detail link so it takes its own clicks. */
const RAISED = "pointer-events-auto relative z-10";

/**
 * A card on the Games grid for one library record: the art, the title, the
 * installed version or the source kinds, a state badge, and the action the
 * state calls for. Art is the hub's card, then the hub's banner, then the
 * branding banner, then the game's own loading screen.
 *
 * An installed card links to the game's detail page through a stretched
 * overlay, with the buttons raised above it so a `<button>` never sits inside
 * an `<a>`.
 */
export function GameCard({
  game,
  headerUrl,
  loading,
  playDisabled,
  canDownload,
  resolving,
  failure,
  progress,
  hubRead = true,
  onPlay,
  onInstall,
  onUpdate,
  onCancel,
}: {
  game: LibraryGame;
  /** The installed game's loading screen, from the batch header loader. */
  headerUrl?: string;
  /** The header batch is still in flight and this game has no art yet. */
  loading?: boolean;
  /** The list is a saved scan not yet checked, so the game may be gone. */
  playDisabled?: boolean;
  /** A download folder is set. */
  canDownload: boolean;
  /** The hub's sources are being turned into a download. */
  resolving?: boolean;
  /** Why the last download attempt failed. */
  failure?: string | null;
  /** The running download, for its progress bar. */
  progress?: ProgressSource | null;
  /** The hub's list was read, so a game missing from it is not on the hub. */
  hubRead?: boolean;
  onPlay: () => void;
  onInstall: () => void;
  onUpdate: () => void;
  onCancel: () => void;
}) {
  const installed = game.installed[0];
  const brand = useBrandingEntry(installed);
  const brandBanner = useBrandingImage(brand?.banner, true);
  const hubUrl = useTrustedHubUrl();
  const cardUrl = hubUrl
    ? hubIconUrl(game.hub?.card, hubUrl, assetCdnBase())
    : null;
  const hubCard = useCachedImage(cardUrl ? [cardUrl] : undefined);
  const bannerUrl = hubUrl
    ? hubIconUrl(game.hub?.banner, hubUrl, assetCdnBase())
    : null;
  const hubBanner = useCachedImage(bannerUrl ? [bannerUrl] : undefined);
  const art = hubCard ?? hubBanner ?? brandBanner ?? headerUrl;
  const title = brand?.title ?? game.title;
  const { state } = game;
  const running = state === "downloading" || state === "queued";
  const playable = !!installed && !running;

  const actions: ReactNode[] = [];
  if (running) {
    actions.push(
      <Button
        key="cancel"
        size="sm"
        variant="ghost"
        className={RAISED}
        onClick={onCancel}
      >
        <X className="size-4" />
        Cancel
      </Button>,
    );
  }
  if (state === "update") {
    actions.push(
      <Button
        key="update"
        size="sm"
        variant="outline"
        className={RAISED}
        disabled={!canDownload || resolving}
        onClick={onUpdate}
      >
        {resolving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RefreshCw className="size-4" />
        )}
        Update
      </Button>,
    );
  }
  if (state === "available") {
    actions.push(
      <Button
        key="install"
        size="sm"
        variant="outline"
        className={RAISED}
        disabled={!canDownload || resolving}
        onClick={onInstall}
      >
        {resolving ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Download className="size-4" />
        )}
        Install
      </Button>,
    );
  }
  if (playable) {
    actions.push(
      <Button
        key="play"
        size="sm"
        className={RAISED}
        onClick={onPlay}
        disabled={playDisabled}
      >
        <Play className="size-4 fill-current" />
        Play
      </Button>,
    );
  }

  return (
    <GameCardShell
      name={installed?.name ?? game.title}
      title={title}
      artUrl={art}
      alt={`${title} art`}
      sdd={installed ? isSdd(installed.primaryArchive) : false}
      generated={
        installed ? generatedGameNote(installed.primaryArchive.name) : null
      }
      warnings={
        installed
          ? [
              ...(installed.warnings ?? []),
              ...missingDependencyNotes(installed),
            ]
          : null
      }
      loading={loading}
      className="h-full"
      badge={<StateBadge game={game} />}
      subtitle={subtitleOf(game, hubRead)}
      footer={
        <div className="flex flex-col gap-2">
          {state === "downloading" &&
            (progress?.progress ? (
              <QueueProgress item={progress} />
            ) : (
              <StartingBar />
            ))}
          {failure && !running && (
            <p className="break-words text-xs text-destructive">{failure}</p>
          )}
          {actions.length > 0 && (
            <div className="flex items-center justify-end gap-1.5">
              {actions}
            </div>
          )}
        </div>
      }
    >
      {installed && (
        <Link
          to={`/library/games/${encodeURIComponent(installed.name)}`}
          aria-label={title}
          className="absolute inset-0 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
        />
      )}
    </GameCardShell>
  );
}
