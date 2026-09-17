import { Button, NavGate } from "@picoframe/frame";
import { Loader2, Swords, Users } from "lucide-react";
import { useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  type MatchQueue,
  mpMatchmakingCancel,
  mpMatchmakingList,
  mpMatchmakingQueue,
} from "../bindings";
import { describeQueue, searchingIn } from "../matchmaking";
import { useMpMatchmaking } from "../navPredicates";
import { liveTachyonKeys } from "../protocol";
import {
  initialMirror,
  serverNameFor,
  useConnection,
  useMultiplayer,
  useProtocolServers,
  usernameFromKey,
} from "../store";

/**
 * The matchmaking screen: the queues this server offers, and the search you have
 * running in one of them.
 *
 * Tachyon only, so the nav item and the route are gated on any connection
 * speaking it (issue #2845). With two or more Tachyon connections open, each
 * gets its own section naming it and its own search, the same pattern the
 * Battles page uses for hosting (issue #2844). With one connection it reads
 * exactly as it did before servers were told apart. What you see while
 * searching is deliberately thin. `matchmaking/queueUpdate` is the only thing
 * that would say how many people are searching or how long it usually takes,
 * and Teiserver has not built it, so the screen says the server does not
 * report it rather than showing a progress bar with nothing behind it. The
 * countdown on a found match is a real number, so that one is shown, in the
 * panel that follows you around the app.
 */
function MatchmakingPage() {
  const { connections, activeKey, openLoginPopover } = useMultiplayer();
  const servers = useProtocolServers();
  const keys = liveTachyonKeys(connections, servers, activeKey);

  if (keys.length === 0) {
    return (
      <main className="flex flex-col items-center justify-center gap-4 p-10 text-center">
        <h1 className="text-lg font-semibold">Matchmaking</h1>
        <p className="text-sm text-muted-foreground">
          You are not connected to a lobby server.
        </p>
        <Button onClick={openLoginPopover}>Connect…</Button>
      </main>
    );
  }

  if (keys.length === 1) {
    return <QueueSection serverKey={keys[0]} layout="page" />;
  }

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border p-4">
        <h1 className="text-lg font-semibold">Matchmaking</h1>
        <span className="text-sm text-muted-foreground">
          The server puts a match together and picks where it runs.
        </span>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {keys.map((key) => (
          <QueueSection key={key} serverKey={key} layout="section" />
        ))}
      </div>
    </main>
  );
}

/**
 * One connection's queues and search (issue #2845). `layout="page"` is the
 * whole page for a single connection, as it was before servers were told
 * apart. `layout="section"` is one server's part of the page when two or more
 * are open, under a heading naming it.
 */
function QueueSection({
  serverKey,
  layout,
}: {
  serverKey: string;
  layout: "page" | "section";
}) {
  const mirror = useConnection(serverKey)?.mirror ?? initialMirror;
  const servers = useProtocolServers();
  const matchmaking = mirror.state?.matchmaking;
  const party = mirror.state?.party ?? null;

  // The connection asks as it comes up, so this only covers arriving on the
  // screen after a refusal or a reconnect that lost the answer.
  useEffect(() => {
    if (matchmaking?.queues.length) return;
    mpMatchmakingList({ serverKey }).catch(() => {});
  }, [serverKey, matchmaking?.queues.length]);

  // The keys this is rendered for are already live Tachyon connections, so
  // this only guards a connection that dropped between the parent's read and
  // this render.
  if (!matchmaking) return null;

  const searching = searchingIn(matchmaking);

  const body = (
    <div
      className={
        layout === "page"
          ? "flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4"
          : "flex flex-col gap-4 px-4 pb-4"
      }
    >
      {!matchmaking.supported && (
        <p className="text-sm text-muted-foreground">
          This server has not built matchmaking yet, so there is nothing to
          search in.
        </p>
      )}

      {matchmaking.supported && searching.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Loader2 className="size-4 animate-spin" />
              Searching in {searching.join(", ")}
            </CardTitle>
            <CardDescription>
              This server does not report how many other players are searching,
              so coilbox cannot say how long this will take. Leave it running
              and accept the match when it appears.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex items-center gap-3">
            <Button
              variant="secondary"
              onClick={() => mpMatchmakingCancel({ serverKey }).catch(() => {})}
            >
              Stop searching
            </Button>
            {party && party.members.length > 1 && (
              <span className="flex items-center gap-2 text-sm text-muted-foreground">
                <Users className="size-4" />
                Searching with {party.members.join(", ")}
              </span>
            )}
          </CardContent>
        </Card>
      )}

      {matchmaking.supported && searching.length === 0 && (
        <>
          {party && party.members.length > 1 && (
            <p className="text-sm text-muted-foreground">
              Your party searches as one, so this puts{" "}
              {party.members.join(", ")} in the queue together.
            </p>
          )}
          {matchmaking.queues.length === 0 && (
            <p className="text-sm text-muted-foreground">
              The server has not sent its queues yet.
            </p>
          )}
          <ul className="grid gap-3 md:grid-cols-2">
            {matchmaking.queues.map((queue) => (
              <li key={queue.id}>
                <QueueCard
                  queue={queue}
                  onSearch={() =>
                    mpMatchmakingQueue({
                      serverKey,
                      queueId: queue.id,
                    }).catch(() => {})
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );

  if (layout === "section") {
    return (
      <section className="border-b border-border">
        <h2 className="px-4 pt-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {usernameFromKey(serverKey)} on {serverNameFor(serverKey, servers)}
        </h2>
        {body}
      </section>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-2 border-b border-border p-4">
        <h1 className="text-lg font-semibold">Matchmaking</h1>
        <span className="text-sm text-muted-foreground">
          The server puts a match together and picks where it runs.
        </span>
      </header>
      {body}
    </main>
  );
}

/** One queue on offer, with what it plays and the button that searches in it. */
function QueueCard({
  queue,
  onSearch,
}: {
  queue: MatchQueue;
  onSearch: () => void;
}) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {queue.name}
          {queue.ranked && <Badge variant="secondary">Ranked</Badge>}
        </CardTitle>
        <CardDescription>{describeQueue(queue)}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <span
          className="truncate text-sm text-muted-foreground"
          title={queue.maps.join("\n")}
        >
          {queue.maps.length === 1
            ? queue.maps[0]
            : `${queue.maps.length} maps`}
        </span>
        <Button onClick={onSearch} className="gap-2">
          <Swords className="size-4" />
          Search
        </Button>
      </CardContent>
    </Card>
  );
}

/** Route entry: gated on any connection speaking Tachyon, the only protocol
 * with matchmaking. */
export default function MatchmakingRoute() {
  return (
    <NavGate use={useMpMatchmaking} redirectTo="/lobby">
      <MatchmakingPage />
    </NavGate>
  );
}
