import { Button, useDrawer } from "@picoframe/frame";
import { Loader2, Play, Swords, Trash2 } from "lucide-react";
import { useNavigate } from "react-router";
import { FactionLogo } from "@/factions/FactionLogo";
import type { FactionLogoSrc } from "@/factions/fallback";
import { useFactionLogo } from "@/factions/logos";
import { resolveGameByShortname } from "../../conquest/model";
import { useUnitsyncScan } from "../../content/config";
import { EmptyState } from "../../content/pages/components/states";
import { usePreferredTarget } from "../../play/config";
import { useRun } from "../runs";
import { RunSetupForm } from "./components/RunSetupForm";

/**
 * The Run hub: the active run (resume/abandon) plus a "New run" button that
 * opens the setup in a right-hand drawer — mirroring the Conquest list + its
 * "Generate a galaxy" drawer.
 */
export default function RunListPage() {
  const navigate = useNavigate();
  const drawer = useDrawer();
  const { target } = usePreferredTarget();
  const scan = useUnitsyncScan(target?.enginePath, target?.dataDir);
  const { run: activeRun, save } = useRun();

  const hasGames = (scan.data?.games.length ?? 0) > 0;

  // The active run's chosen faction emblem (by its in-game side), shown on the card.
  const runGame = activeRun
    ? resolveGameByShortname(activeRun.settings.game, scan.data?.games ?? [])
    : null;
  const runLogo = useFactionLogo(
    {
      game: runGame ?? undefined,
      enginePath: target?.enginePath,
      dataDir: target?.dataDir,
      gameArchive: runGame?.primaryArchive.name,
      size: 32,
    },
    activeRun?.settings.side,
  );

  const openSetup = () =>
    drawer.open({
      title: "New warpath",
      width: "30rem",
      content: (
        <RunSetupForm
          onStarted={() => {
            drawer.close();
            navigate("/warpath/active");
          }}
        />
      ),
    });

  return (
    <div className="flex flex-col gap-4 p-4">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="flex items-center gap-2 text-lg font-semibold">
            <Swords className="size-5 text-primary" aria-hidden /> Warpath
          </h1>
          <p className="max-w-xl text-sm text-muted-foreground">
            Cross a forward-only map once — fight, take rewards, grow your
            build, and reach the warlord before your health runs out. Win or
            die, then set out again.
          </p>
        </div>
        {hasGames && (
          <Button onClick={openSetup} className="shrink-0">
            <Swords className="mr-1.5 size-4" aria-hidden /> New warpath
          </Button>
        )}
      </header>

      {!scan.data ? (
        target ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Scanning installed games…
          </div>
        ) : (
          <EmptyState label="Install an engine first (Content → Engines)." />
        )
      ) : !hasGames ? (
        <EmptyState label="No games installed. Add one from Content → Games." />
      ) : activeRun ? (
        <ActiveRunCard
          game={activeRun.settings.game.shortname}
          side={activeRun.settings.side}
          logo={runLogo}
          health={`${activeRun.progress.hull}/${activeRun.progress.maxHull}`}
          status={activeRun.progress.status}
          onResume={() => navigate("/warpath/active")}
          onAbandon={() => save(null)}
        />
      ) : (
        <EmptyState label="No warpath in progress. Start a new warpath to begin." />
      )}
    </div>
  );
}

function ActiveRunCard({
  game,
  side,
  logo,
  health,
  status,
  onResume,
  onAbandon,
}: {
  game: string;
  side?: string;
  logo?: FactionLogoSrc;
  health: string;
  status: "active" | "won" | "lost";
  onResume: () => void;
  onAbandon: () => void;
}) {
  const label =
    status === "won"
      ? "Warpath complete"
      : status === "lost"
        ? "Warpath ended"
        : "Warpath in progress";
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/40 bg-primary/5 p-4">
      <div className="flex items-center gap-3">
        {logo && (
          <FactionLogo
            logo={logo}
            sideName={side}
            size={32}
            className="text-primary"
          />
        )}
        <div>
          <div className="font-medium">{label}</div>
          <div className="text-xs text-muted-foreground">
            {game} · health {health}
          </div>
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={onResume}>
          <Play className="mr-1.5 size-4" aria-hidden />
          {status === "active" ? "Resume" : "View"}
        </Button>
        <Button variant="outline" onClick={onAbandon}>
          <Trash2 className="mr-1.5 size-4" aria-hidden /> Abandon
        </Button>
      </div>
    </div>
  );
}
