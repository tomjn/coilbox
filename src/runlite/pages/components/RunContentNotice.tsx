import { Link } from "react-router";
import type { GameRef } from "../../../conquest/model";
import { HUD_CARD_CLASS } from "../../../conquest/pages/components/hudChrome";
import { DownloadGameButton } from "../../../play/pages/components/DownloadGameButton";
import { NoEngineNotice } from "../../../play/pages/components/NoEngineNotice";
import type { RunGameNotice } from "../../runContent";

const linkClass = "font-medium underline underline-offset-4";

/**
 * What the run page says when the run cannot be played as it stands: no engine,
 * or its game is not installed (issue #3369). Each answer carries the way to
 * fix it where there is one. The map a battle needs is checked by that battle's
 * own briefing.
 *
 * `refreshTarget` reads the installed engines again and `refreshScan` reads the
 * installed games again. The page holds its own read of both, so it sees neither
 * download until told to look.
 */
export function RunContentNotice({
  notice,
  game,
  targetLoading,
  refreshTarget,
  refreshScan,
}: {
  notice: RunGameNotice;
  game: GameRef;
  targetLoading: boolean;
  refreshTarget: () => Promise<void>;
  refreshScan: () => Promise<void>;
}) {
  if (notice.kind === "none") return null;
  if (notice.kind === "no-engine") {
    return (
      <div className="pointer-events-auto max-w-xl">
        <NoEngineNotice
          targetLoading={targetLoading}
          refresh={refreshTarget}
          playing="this warpath"
        />
      </div>
    );
  }

  const name = game.pinnedName ?? game.shortname;
  return (
    <div
      className={`pointer-events-auto flex max-w-xl flex-col items-start gap-2 p-3 text-sm ${HUD_CARD_CLASS}`}
    >
      {notice.kind === "download" ? (
        <>
          <p>
            This warpath needs the game{" "}
            <span className="font-medium">{name}</span>, which is not installed.
          </p>
          <DownloadGameButton
            game={game}
            download={notice.download}
            onReady={refreshScan}
          />
        </>
      ) : notice.kind === "unreadable" ? (
        <p>
          The engine could not read your games, so this warpath cannot check for{" "}
          <span className="font-medium">{name}</span>. Open{" "}
          <Link className={linkClass} to="/library/games">
            Content &gt; Games
          </Link>{" "}
          to see what it did find, or pick another engine in Settings.
          {notice.reason && <> unitsync said: {notice.reason}</>}
        </p>
      ) : (
        <p>
          This warpath needs the game{" "}
          <span className="font-medium">{name}</span>, which is not installed
          and has no download coilbox knows about. Add it in{" "}
          <Link className={linkClass} to="/library/games">
            Content &gt; Games
          </Link>
          .
        </p>
      )}
    </div>
  );
}
