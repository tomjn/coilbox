import { Button } from "@picoframe/frame";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import type { SkirmishDraft } from "@/play/drafts";
import { useScanTargetSelection } from "../../content/config";
import {
  directRoomStatus,
  directStartRoom,
  directStopRoom,
} from "../../direct/bindings";
import {
  HostRoomControl,
  type StartRoomArgs,
} from "../../direct/HostRoomControl";
import {
  readHostedRoom,
  setHostedRoom,
  useHostedRoom,
} from "../../direct/hostedRoom";
import { type JoinRoomArgs, LanRooms } from "../../direct/LanRooms";
import { LinkedRoomJoin } from "../../direct/LinkedRoomJoin";
import {
  joinBlockedReason,
  joinRoomFailure,
  noRoomBattleFailure,
  otherRooms,
  ownRoomHeard,
  roomBattle,
} from "../../direct/lan";
import { directClosePorts } from "../../direct/reachability";
import {
  battleOpened,
  isDirectKey,
  noBattleFailure,
  roomStopReason,
  startRoomFailure,
} from "../../direct/room";
import { useLanRooms } from "../../direct/useLanRooms";
import { useLastLogin } from "../../lobby-servers/config";
import { notify } from "../../notify/notify";
import { getGameMatcher } from "../../profile/profile";
import { BattleFilterPopover } from "../battles/BattleFilterPopover";
import { BattleList } from "../battles/BattleList";
import { filterSortBattles } from "../battles/battleFilters";
import {
  type CreateLobbyArgs,
  CreateLobbyPopover,
} from "../battles/CreateLobbyPopover";
import {
  HostBattlePopover,
  type OpenBattleArgs,
} from "../battles/HostBattlePopover";
import { useBattleFilters } from "../battles/useBattleFilters";
import {
  type Battle,
  mpCreateLobby,
  mpJoinBattle,
  mpLeaveBattle,
  mpOpenBattle,
  mpSnapshot,
} from "../bindings";
import { newScriptPassword } from "../scriptPassword";
import { serverAddressFromKey, useMultiplayer } from "../store";

/**
 * The Battles hub: search + filter/sort controls over the live battle list, with
 * in-place join. Battles come from the mirror snapshot (kept fresh by the store's
 * delta→snapshot rule); joining is reflected by the joined banner rather than
 * navigating away. Connection lives on the Login page; disconnected shows a prompt.
 * Reachable with no connection, because this is also where a room is hosted with
 * no server at all.
 */
function BattlesPage() {
  const {
    mirror,
    activeKey,
    protocol,
    busy,
    lastJoinError,
    clearJoinError,
    openLoginPopover,
    connectDirect,
    disconnect,
  } = useMultiplayer();

  // The room this client hosts, off the shared source that outlives this page.
  // Who is in it and whether it wants a password are the room's to know and the
  // direct plugin emits no events, so it is polled, but by one reader rather
  // than by every page that wants it (issue #1600).
  const room = useHostedRoom();
  const [roomBusy, setRoomBusy] = useState(false);
  const [stopError, setStopError] = useState<string | null>(null);
  const [lastLogin] = useLastLogin();
  // The rooms other people on this network are announcing. Polled for as long as
  // this page is open and stopped when it is not, so nothing holds the beacon
  // port open behind a page nobody is looking at.
  const lan = useLanRooms();
  // Under Tachyon the server allocates a dedicated autohost and a client cannot
  // host a battle at all. What it can do is create a lobby, which is a different
  // thing with its own popover, so the two swap rather than one being hidden.
  // See `docs/tachyon-protocol.md`.
  const canHost = protocol !== "tachyon";
  const [filters, setFilters] = useBattleFilters();

  const all = useMemo(
    () => Object.values(mirror.state?.battles ?? {}),
    [mirror.state?.battles],
  );
  // A distribution profile can preset a game filter; when set, the battle list is
  // hard-scoped to that game (matched on modname) — the bundled build only ever
  // shows its own game's battles. No profile => no scoping.
  const gameMatch = useMemo(() => getGameMatcher(), []);
  const scoped = useMemo(
    () => (gameMatch ? all.filter((b) => gameMatch(b.modname)) : all),
    [all, gameMatch],
  );
  const shown = useMemo(
    () => filterSortBattles(scoped, filters),
    [scoped, filters],
  );

  // Selected engine + content root for rendering local minimaps in the rows.
  const { selected } = useScanTargetSelection();

  // A content map detail's "Host a battle here" navigates here with the map name,
  // preselecting it in the host popover and opening it on arrival.
  const location = useLocation();
  const hostMap = (location.state as { hostMap?: string } | null)?.hostMap;

  // A Singleplayer preset's "Host as battle" (issue #373) navigates here with the
  // draft to host and a title. Preselect its game/map/title and, once the room
  // opens, forward the same draft to the battle room so it can seed the room's
  // options, start boxes, host seat and bots (see `BattleRoomPage`'s apply effect).
  const hostState = location.state as {
    hostDraft?: SkirmishDraft;
    hostTitle?: string;
  } | null;
  const hostDraft = hostState?.hostDraft;

  // A confirmed coilbox://join deep link (issue #388) navigates here with the
  // target server and battle id. Join only when already connected to a server
  // and the battle is open. Cross-server auto-connect is out of scope, so an
  // unconnected or missing target is reported rather than acted on silently.
  const deeplinkJoin = (
    location.state as {
      deeplinkJoin?: { server: string; battle: string; password?: string };
    } | null
  )?.deeplinkJoin;
  const deeplinkJoinHandledRef = useRef(false);

  // A confirmed coilbox://room deep link (issue #1612) navigates here with the
  // address and port of a room somebody is hosting themselves. Unlike the join
  // above it needs no connection and no battle list, because a room is one
  // machine and one battle, so it opens the join form filled in rather than
  // acting: the person still has to put their name in and press Join, and a room
  // that has stopped since the link was written is reported there.
  const deeplinkRoom =
    (
      location.state as {
        deeplinkRoom?: { address: string; port: number };
      } | null
    )?.deeplinkRoom ?? null;

  const navigate = useNavigate();
  const ready = mirror.phase === "ready";
  const joinedId = mirror.state?.currentBattle ?? null;
  const canJoin = ready && !busy && joinedId == null;

  // After a user-initiated join lands (the ack sets `currentBattle`), go straight
  // to the battle room. Gated on `joiningRef` so merely revisiting this page while
  // already in a battle doesn't redirect. `hostingFromDraftRef` distinguishes
  // "we just opened this from a preset's Host as battle" from an ordinary join
  // (including a join of someone *else's* battle made while a hostDraft happens
  // to be sitting in this page's state), so the draft is only ever forwarded to
  // the room we actually hosted from it.
  const joiningRef = useRef(false);
  const hostingFromDraftRef = useRef(false);
  useEffect(() => {
    if (joinedId != null && joiningRef.current) {
      joiningRef.current = false;
      const seeded = hostingFromDraftRef.current;
      hostingFromDraftRef.current = false;
      navigate(
        "/battle",
        seeded && hostDraft ? { state: { hostDraft } } : undefined,
      );
    }
  }, [joinedId, navigate, hostDraft]);
  const joinedBattle =
    joinedId != null ? mirror.state?.battles[String(joinedId)] : undefined;

  // Carry out a deep-link join once the connection is ready. Fires at most once
  // per arrival (the ref guard), and reports rather than acts when it cannot.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onJoin is a stable hoisted handler, re-adding it would loop the join
  useEffect(() => {
    if (!deeplinkJoin || deeplinkJoinHandledRef.current) return;
    if (!ready || !activeKey) {
      deeplinkJoinHandledRef.current = true;
      notify({
        title: "Connect first to join",
        body: `Log in to ${deeplinkJoin.server}, then open the link again.`,
        level: "error",
      });
      return;
    }
    const target = all.find((b) => String(b.id) === deeplinkJoin.battle);
    if (!target) {
      deeplinkJoinHandledRef.current = true;
      notify({
        title: "Battle not found",
        body: `Battle "${deeplinkJoin.battle}" is not open on this server.`,
        level: "error",
      });
      return;
    }
    deeplinkJoinHandledRef.current = true;
    void onJoin(target, deeplinkJoin.password);
  }, [deeplinkJoin, ready, activeKey, all]);

  // A battle is "in progress" when the server says so on the lobby, which is what
  // Tachyon does, or when its host is in-game, which is all TASServer gives us.
  // BattleList groups on this (open first, in-progress last). The joined battle is
  // pinned separately so its Leave button is always reachable even inside a
  // collapsed group.
  const users = mirror.state?.users;
  const inProgressIds = useMemo(() => {
    const ids = new Set<number>();
    for (const b of all) {
      if (b.inProgress || users?.[b.host]?.status.ingame) ids.add(b.id);
    }
    return ids;
  }, [all, users]);

  // `key` is supplied by the row's password popover for passworded battles. A
  // battle in progress is joined the same way — the server places a late joiner as
  // a spectator, and the room auto-launches the engine to watch the running game.
  // Wrapped so the identity is stable: it reaches every row, and a new function
  // each render would re-render all of them (see `BattleRow`'s memo).
  const onJoin = useCallback(
    async (b: Battle, key?: string) => {
      if (!activeKey) return;
      clearJoinError();
      hostingFromDraftRef.current = false;
      joiningRef.current = true;
      try {
        await mpJoinBattle({
          serverKey: activeKey,
          id: b.id,
          key,
          scriptPassword: newScriptPassword(),
        });
      } catch {
        // Wire-level failures surface via lastJoinError or a disconnect.
        joiningRef.current = false;
      }
    },
    [activeKey, clearJoinError],
  );

  // Open a battle we host. The OPENBATTLE ack sets `currentBattle`, which the join
  // effect above turns into navigation to the room (same path as joining).
  async function onHost(args: OpenBattleArgs) {
    if (!activeKey) return;
    clearJoinError();
    hostingFromDraftRef.current = !!hostDraft;
    joiningRef.current = true;
    try {
      await mpOpenBattle({ serverKey: activeKey, ...args });
    } catch (e) {
      joiningRef.current = false;
      hostingFromDraftRef.current = false;
      // Thrown on rather than dropped. A refusal that never reached the wire has
      // no join error and no disconnect behind it, so the popover the host
      // pressed in is the only place it can be read (issue #1591).
      throw e;
    }
  }

  // Create a lobby on a Tachyon server. The response is the whole lobby and it
  // puts us in it, so it sets `currentBattle` exactly as a join does and the
  // effect above takes us to the room. Nothing here hosts anything.
  async function onCreate(args: CreateLobbyArgs) {
    if (!activeKey) return;
    clearJoinError();
    hostingFromDraftRef.current = false;
    joiningRef.current = true;
    try {
      await mpCreateLobby({ serverKey: activeKey, ...args });
    } catch {
      joiningRef.current = false;
    }
  }

  const leave = useCallback(async () => {
    if (!activeKey) return;
    await mpLeaveBattle({ serverKey: activeKey }).catch(() => {});
  }, [activeKey]);

  // Start a room of our own: bind the port, dial it over loopback like any other
  // server, then open the battle in it. Landing in the battle room is the join
  // effect above doing what it does for every other battle.
  //
  // Failures are thrown rather than stored, because the only place a host can read
  // one is the drawer they pressed Start in, and the drawer holds the element it
  // was opened with. So the form asking is the form told.
  async function onStartRoom(args: StartRoomArgs) {
    setRoomBusy(true);
    let port: number;
    try {
      ({ port } = await directStartRoom({
        host: args.host,
        port: args.port,
        advertise: args.advertise,
        approveJoins: args.approveJoins,
      }));
    } catch (e) {
      setRoomBusy(false);
      throw new Error(startRoomFailure(e, args.port));
    }
    try {
      const key = await connectDirect(port, args.host);
      clearJoinError();
      hostingFromDraftRef.current = false;
      joiningRef.current = true;
      await mpOpenBattle({ serverKey: key, ...args.battle });
      // Sending the line is not opening the battle. Everything that can swallow
      // it leaves a room listening with nobody able to join and nothing on
      // screen to say so, so the room is asked whether it actually has one
      // (issue #1587). A start that has not produced a battle by now is a
      // failure, and the catch below takes the room down with it.
      const opened = await battleOpened(
        () => directRoomStatus({}).then((r) => r.room),
        (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      );
      if (!opened) throw new Error(noBattleFailure());
      setStopError(null);
      setHostedRoom(opened);
    } catch (e) {
      // The room is up but we are not in it, which is a room nobody can host.
      // Take it down rather than leave a listener with no owner behind.
      joiningRef.current = false;
      await directStopRoom({
        reason: "the host could not join their own room",
      }).catch(() => {});
      throw e;
    } finally {
      setRoomBusy(false);
    }
  }

  // Stop hosting. Our own client goes first and on purpose, so its drop is not
  // read as a server that fell over and does not start a reconnect loop against
  // a port that is about to close.
  async function onStopRoom() {
    setRoomBusy(true);
    setStopError(null);
    try {
      const reason = roomStopReason(room?.host ?? "");
      await disconnect();
      await directStopRoom({ reason });
      // The room is what wanted the ports open, so the room ending is what hands
      // them back. Leaving a mapping on somebody's router after the thing that
      // asked for it has gone is rude, and the hour-long lease only limits the
      // damage when this never runs, which is a host whose machine was killed.
      await directClosePorts({}).catch(() => {});
      setHostedRoom(null);
    } catch (e) {
      // The room is still there, so let a fresh reading speak for it again.
      void readHostedRoom();
      setStopError(e instanceof Error ? e.message : String(e));
    } finally {
      setRoomBusy(false);
    }
  }

  // Join somebody else's room: dial it exactly as the host's own client dials
  // theirs, then join the battle in it through the ordinary client path. Nothing
  // here is a second way to join a battle.
  //
  // Failures are thrown rather than stored, for the same reason a failed start
  // is: the only place they can be read is the drawer they were asked for in.
  async function onJoinRoom(args: JoinRoomArgs) {
    let key: string;
    try {
      key = await connectDirect(args.port, args.name, args.address);
    } catch (e) {
      throw new Error(joinRoomFailure(e, args.address, args.port));
    }
    try {
      // Connected is not joinable. The battle arrives as a message behind the
      // login that has only just been accepted, so there is a gap in which the
      // room holds a battle this client has not been told about yet.
      const battle = await roomBattle(
        () =>
          mpSnapshot({ serverKey: key }).then((s) =>
            Object.values(s.state.battles),
          ),
        (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      );
      if (!battle) throw new Error(noRoomBattleFailure());
      clearJoinError();
      hostingFromDraftRef.current = false;
      joiningRef.current = true;
      await mpJoinBattle({
        serverKey: key,
        id: battle.id,
        key: args.password || undefined,
        scriptPassword: newScriptPassword(),
      });
    } catch (e) {
      // Connected to a room with nothing to join in it is worse than not
      // connected: it holds the one lobby connection and shows an empty lobby.
      joiningRef.current = false;
      await disconnect().catch(() => {});
      throw e;
    }
  }

  // The list is everybody else's rooms. A host is already in their own, so it
  // sits in the battle list below with the way back into it, and listing it here
  // as well was the same room twice (issue #1608). What the host's own beacon
  // proves is said on the host's own line instead.
  const lanSection = (
    <>
      <LanRooms
        rooms={otherRooms(lan.rooms)}
        error={lan.error}
        blocked={joinBlockedReason(activeKey, room !== null)}
        defaultName={lastLogin?.username}
        enginePath={selected?.enginePath}
        dataDir={selected?.rootPath}
        onJoin={onJoinRoom}
      />
      <LinkedRoomJoin
        target={deeplinkRoom}
        blocked={joinBlockedReason(activeKey, room !== null)}
        defaultName={lastLogin?.username}
        onJoin={onJoinRoom}
      />
    </>
  );

  const hostControl = (
    <HostRoomControl
      room={room}
      heardOnNetwork={ownRoomHeard(lan.rooms)}
      connectedToServer={activeKey != null && !isDirectKey(activeKey)}
      defaultName={lastLogin?.username}
      busy={roomBusy || busy}
      error={stopError}
      onStart={onStartRoom}
      onStop={onStopRoom}
    />
  );

  // Logged out. The page is reachable with no connection (issue #1580), so this
  // has to read as "there is no server here" rather than as a server with nobody
  // on it, which is what an empty list would have said.
  if (!activeKey) {
    return (
      <main className="flex h-full min-h-0 flex-col">
        <header className="flex items-center justify-between gap-2 border-b border-border p-4">
          <h1 className="text-lg font-semibold">Battles</h1>
        </header>
        {/* Scrolls rather than centres once the rooms on the network push it
            past the window, which a LAN party will. */}
        <div className="flex flex-1 flex-col items-center overflow-y-auto p-10">
          <div className="my-auto flex w-full max-w-xl flex-col items-center gap-3 text-center">
            <h2 className="text-base font-semibold">
              Not connected to a server
            </h2>
            <p className="text-sm text-muted-foreground">
              Server battles are listed here once you log in. This list is empty
              because coilbox has no lobby connection, not because nobody is
              playing.
            </p>
            <Button onClick={openLoginPopover}>Log in</Button>
            <p className="text-sm text-muted-foreground">
              Or host a room of your own. It needs no server and no account.
            </p>
            {hostControl}
            <div className="mt-4 w-full border-t border-border pt-4 text-left">
              {lanSection}
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Battles</h1>
          <span className="text-sm text-muted-foreground">
            {shown.length === scoped.length
              ? `(${scoped.length})`
              : `(${shown.length} of ${scoped.length})`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {canHost ? (
            <HostBattlePopover
              disabled={!canJoin}
              onHost={onHost}
              initialMap={hostDraft?.mapName ?? hostMap}
              initialGame={hostDraft?.gameName}
              initialTitle={hostState?.hostTitle}
              autoOpen={!!hostMap || !!hostDraft}
            />
          ) : (
            <CreateLobbyPopover
              disabled={!canJoin}
              onCreate={onCreate}
              initialMap={hostDraft?.mapName ?? hostMap}
              autoOpen={!!hostMap || !!hostDraft}
            />
          )}
          {hostControl}
          <BattleFilterPopover filters={filters} setFilters={setFilters} />
        </div>
      </header>

      {lastJoinError && (
        <div
          role="alert"
          className="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive"
        >
          Join failed: {lastJoinError}
        </div>
      )}

      <div className="border-b border-border px-4 py-3">{lanSection}</div>

      <BattleList
        battles={shown}
        totalCount={scoped.length}
        joinedBattle={joinedBattle}
        joinedId={joinedId}
        inProgressIds={inProgressIds}
        canJoin={canJoin}
        onJoin={onJoin}
        onLeave={leave}
        enginePath={selected?.enginePath}
        dataDir={selected?.rootPath}
        serverAddress={activeKey ? serverAddressFromKey(activeKey) : undefined}
      />
    </main>
  );
}

/**
 * Route entry. Ungated: the page is where a room is hosted with no server at all,
 * so redirecting a logged-out visitor to Login would close the only door to it.
 */
export default function BattlesRoute() {
  return <BattlesPage />;
}
