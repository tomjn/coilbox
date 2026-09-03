import { Button } from "@picoframe/frame";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Trophy, X } from "lucide-react";
import { createPortal } from "react-dom";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
// The one place a side's one-based name is written down, shared with replay
// detail so a Zero-K team 1 and a replay team 1 cannot drift apart.
import { teamLabel } from "@/content/replaySideLabel";
import type { Debriefing, DebriefingPlayer } from "./bindings";
import {
  categoryLabel,
  formatRatingChange,
  headline,
  rankMove,
  rankName,
  teams,
} from "./debriefing";

/**
 * What the Zero-K server said about the game that has just finished (issue
 * #2003): the rating everybody gained or lost, who won, and the awards the game
 * handed out.
 *
 * # Why it is a drawer over the whole app rather than a panel in the room
 *
 * There is no room to put it in on the games that need it most. A matchmaker
 * battle is deleted the moment its game ends, so by the time the debriefing
 * arrives the room the game was played in has gone and the player is back in the
 * lobby. A custom battle survives, but the player may well have walked away from
 * the room already. A drawer mounted with the connection catches both, and
 * matches how coilbox already handles the other things a server pushes at a
 * moment of its own choosing: a found match and a server message box are both
 * mounted beside the provider for the same reason.
 *
 * Zero-K also puts everybody who played into a `debriefing_…` chat channel, and
 * that channel is already in the chat sidebar by the time this opens, joined the
 * ordinary way. So the drawer names it rather than hosting a second copy of a
 * conversation that has a home.
 */
export function DebriefingDrawer({
  open,
  report,
  myUsername,
  onClose,
}: {
  open: boolean;
  report: Debriefing | null;
  myUsername: string | null;
  onClose: () => void;
}) {
  const me = report?.players.find((player) => player.name === myUsername);

  return createPortal(
    <>
      {open && report ? (
        <button
          type="button"
          aria-label="Close the match result"
          className="fixed inset-0 z-40 bg-black/20"
          onClick={onClose}
        />
      ) : null}
      <aside
        aria-label="Match result"
        className={`fixed inset-y-0 right-0 z-50 flex w-[28rem] max-w-full flex-col border-l border-border bg-background shadow-lg transition-transform motion-reduce:transition-none ${
          open && report ? "translate-x-0" : "translate-x-full"
        }`}
        inert={!(open && report)}
      >
        <header className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">Match result</h2>
          <Button className="h-7 px-2" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </Button>
        </header>
        {report ? (
          <div className="flex-1 space-y-4 overflow-auto p-4">
            <p className="text-base font-semibold">{headline(report, me)}</p>
            {report.message ? (
              <Alert>
                <AlertDescription>{report.message}</AlertDescription>
              </Alert>
            ) : null}
            {me ? <YourStanding player={me} report={report} /> : null}
            {report.players.length > 0 ? (
              <Scoreboard report={report} myUsername={myUsername} />
            ) : null}
            {report.chatChannel ? (
              <p className="text-xs text-muted-foreground">
                Talk it over in {report.chatChannel}, which is in your chat
                list.
              </p>
            ) : null}
          </div>
        ) : null}
        {report?.url ? (
          <footer className="border-t border-border p-3">
            <Button
              onClick={() => {
                const url = report.url;
                if (url) openUrl(url).catch(() => {});
              }}
            >
              Open the battle page
            </Button>
          </footer>
        ) : null}
      </aside>
    </>,
    document.body,
  );
}

/**
 * Where the reader stands now: the rating the game left them on, their rank, and
 * the experience they earned.
 *
 * Experience is here even on a game that counted toward no rating, because it
 * goes up for playing rather than for winning and is the only thing that moved.
 */
function YourStanding({
  player,
  report,
}: {
  player: DebriefingPlayer;
  report: Debriefing;
}) {
  const moved = rankMove(player);
  const rank = rankName(player.rank);
  return (
    <dl className="space-y-1 text-sm">
      {player.rating != null ? (
        <Row label={`${categoryLabel(report.ratingCategory)} rating`}>
          {player.rating}
          {player.nextRankRating != null ? (
            <span className="text-muted-foreground">
              {" "}
              (next rank at {player.nextRankRating})
            </span>
          ) : null}
        </Row>
      ) : null}
      {rank ? <Row label="Rank">{rank}</Row> : null}
      {moved ? (
        <Row label="Rank change">
          <Badge variant={player.rankedUp ? "default" : "destructive"}>
            {moved}
          </Badge>
        </Row>
      ) : null}
      {player.xpChange !== 0 ? (
        <Row label="Experience">
          {player.xpChange > 0 ? `+${player.xpChange}` : player.xpChange}
          <span className="text-muted-foreground"> (now {player.xp})</span>
        </Row>
      ) : null}
      {player.awards.length > 0 ? (
        <Row label="Awards">
          <ul className="inline-flex flex-wrap gap-1">
            {player.awards.map((award) => (
              <li key={award.key}>
                <Badge variant="secondary">
                  <Trophy className="size-3" aria-hidden="true" />
                  {award.description || award.key}
                </Badge>
              </li>
            ))}
          </ul>
        </Row>
      ) : null}
    </dl>
  );
}

/** One labelled line of the standing list. */
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2">
      <dt className="w-36 shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/**
 * Everybody who played, by side, with what the game did to each rating.
 *
 * Spectators are absent because the server leaves them out, so this is the
 * people who were in it rather than the people who were watching.
 */
function Scoreboard({
  report,
  myUsername,
}: {
  report: Debriefing;
  myUsername: string | null;
}) {
  return (
    <div className="space-y-3">
      {teams(report.players).map((team) => (
        <section key={team.ally}>
          <h3 className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {teamLabel(team.ally)}
            {team.won ? <Badge variant="secondary">Won</Badge> : null}
          </h3>
          <ul className="divide-y divide-border rounded-md border border-border">
            {team.players.map((player) => {
              const change = formatRatingChange(player.ratingChange);
              return (
                <li
                  key={player.name}
                  className="flex items-center justify-between gap-2 px-2 py-1 text-sm"
                >
                  <span
                    className={
                      player.name === myUsername ? "font-semibold" : undefined
                    }
                  >
                    {player.name}
                  </span>
                  {change ? (
                    <span
                      className={`font-mono text-xs tabular-nums ${
                        (player.ratingChange ?? 0) < 0
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }`}
                    >
                      {change}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
