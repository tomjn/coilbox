import { Button } from "@picoframe/frame";
import {
  type MutableRefObject,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
import { setHostedRoom, useHostedRoom } from "../../direct/hostedRoom";
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
import {
  battleOpened,
  hostBlockedReason,
  noBattleFailure,
  startRoomFailure,
} from "../../direct/room";
import { stopHostedRoom } from "../../direct/stopRoom";
import { useLanRooms } from "../../direct/useLanRooms";
import { VpnWarning } from "../../direct/VpnWarning";
import { useLastLogin } from "../../lobby-servers/config";
import { notify } from "../../notify/notify";
import { getGameMatcher } from "../../profile/profile";
import { battleRoomHref } from "../battle/battleRoomKey";
import { leaveBattle } from "../battle/leaveBattle";
import { BattleFilterPopover } from "../battles/BattleFilterPopover";
import { BattleList } from "../battles/BattleList";
import { filterSortBattles } from "../battles/battleFilters";
import {
  type CreateLobbyArgs,
  CreateLobbyPopover,
} from "../battles/CreateLobbyPopover";
import { HostBattleButton } from "../battles/HostBattleButton";
import type { OpenBattleArgs } from "../battles/HostBattleForm";
import {
  HostZerokBattlePopover,
  type ZerokOpenBattleArgs,
} from "../battles/HostZerokBattlePopover";
import { useOneBattleRule } from "../battles/oneBattle";
import { useBattleFilters } from "../battles/useBattleFilters";
import {
  type Battle,
  mpCreateLobby,
  mpJoinBattle,
  mpOpenBattle,
  mpSnapshot,
  mpZerokOpenBattle,
} from "../bindings";
import { protocolForKey, relayHostingAvailable } from "../protocol";
import { newScriptPassword } from "../scriptPassword";
import {
  initialMirror,
  serverAddressFromKey,
  serverNameFor,
  useConnection,
  useMultiplayer,
  useProtocolServers,
  usernameFromKey,
} from "../store";

/**
 * A join or host this page is waiting to see land, and on which connection.
 * When that connection's `currentBattle` is set, its list sends the player to
 * the battle room. `seeded` forwards a "Host as battle" draft to the room.
 */
type PendingEntry = { serverKey: string; seeded: boolean } | null;

type DeeplinkJoin = { server: string; battle: string; password?: string };

/**
 * One connection's battles, with in-place join and that server's own way to
 * open a battle (issue #2844). Battles come from the connection's mirror
 * snapshot (kept fresh by the store's delta->snapshot rule).
 *
 * `layout="page"` is the whole page for a single connection, laid out as it
 * was before servers were told apart. `layout="section"` is one server's part
 * of the page when two or more are open, under a heading naming it.
 */
function ServerBattles({
  serverKey,
  layout,
  battles: shown,
  totalCount,
  pending,
  hostDraft,
  hostMap,
  hostTitle,
  deeplinkJoin,
  deeplinkHandled,
  pageControls,
  lanSection,
}: {
  serverKey: string;
  layout: "page" | "section";
  /** This connection's battles, scoped and filtered. */
  battles: Battle[];
  /** This connection's battles, scoped but not filtered. */
  totalCount: number;
  pending: MutableRefObject<PendingEntry>;
  /** Only the connection `SkirmishPage` resolved hosting to (issue #2847,
   * `hostTargetKey` above) is handed a "Host as battle" draft and title. */
  hostDraft?: SkirmishDraft;
  /** Only the focused connection is handed a map jump. */
  hostMap?: string;
  hostTitle?: string;
  /** Only the focused connection is handed a deep link to join. */
  deeplinkJoin?: DeeplinkJoin;
  deeplinkHandled: MutableRefObject<boolean>;
  /** The page's own header controls, drawn beside this server's in `page`. */
  pageControls?: ReactNode;
  /** The rooms on this network, drawn above the list in `page`. */
  lanSection?: ReactNode;
}) {
  const { busy, clearJoinError, directKey } = useMultiplayer();
  const mirror = useConnection(serverKey)?.mirror ?? initialMirror;
  const servers = useProtocolServers();
  const protocol = protocolForKey(serverKey, servers);
  const directRoom = serverKey === directKey;
  const all = useMemo(
    () => Object.values(mirror.state?.battles ?? {}),
    [mirror.state?.battles],
  );
  // Selected engine + content root for rendering local minimaps in the rows.
  const { selected } = useScanTargetSelection();
  const rule = useOneBattleRule(serverKey);

  const navigate = useNavigate();
  const ready = mirror.phase === "ready";
  const joinedId = mirror.state?.currentBattle ?? null;
  const canJoin = ready && !busy && joinedId == null;

  // After a user-initiated join lands (the ack sets `currentBattle`), go straight
  // to the battle room. Gated on `pending` naming this connection so merely
  // revisiting this page while already in a battle doesn't redirect. `seeded`
  // distinguishes "we just opened this from a preset's Host as battle" from an
  // ordinary join (including a join of someone *else's* battle made while a
  // hostDraft happens to be sitting in this page's state), so the draft is only
  // ever forwarded to the room we actually hosted from it.
  useEffect(() => {
    const entry = pending.current;
    if (joinedId == null || entry?.serverKey !== serverKey) return;
    pending.current = null;
    navigate(
      battleRoomHref(serverKey),
      entry.seeded && hostDraft ? { state: { hostDraft } } : undefined,
    );
  }, [joinedId, navigate, hostDraft, serverKey, pending]);
  const joinedBattle =
    joinedId != null ? mirror.state?.battles[String(joinedId)] : undefined;

  const awaitLanding = useCallback(
    (seeded: boolean) => {
      clearJoinError(serverKey);
      pending.current = { serverKey, seeded };
    },
    [clearJoinError, serverKey, pending],
  );
  const giveUp = useCallback(() => {
    if (pending.current?.serverKey === serverKey) pending.current = null;
  }, [serverKey, pending]);

  // `key` is supplied by the row's password popover for passworded battles. A
  // battle in progress is joined the same way — the server places a late joiner as
  // a spectator, and the room auto-launches the engine to watch the running game.
  // Wrapped so the identity is stable: it reaches every row, and a new function
  // each render would re-render all of them (see `BattleRow`'s memo).
  //
  // A row only calls this once the player has agreed to leave a battle on
  // another server, if joining would (issue #2844), so the leave goes first.
  const { leaveOther } = rule;
  const onJoin = useCallback(
    async (b: Battle, key?: string) => {
      try {
        await leaveOther();
      } catch (e) {
        void notify({
          title: "You are still in your other battle",
          body: `Coilbox could not leave it: ${e instanceof Error ? e.message : String(e)}.`,
          level: "error",
        });
        return;
      }
      awaitLanding(false);
      try {
        await mpJoinBattle({
          serverKey,
          id: b.id,
          key,
          scriptPassword: newScriptPassword(),
        });
      } catch {
        // Wire-level failures surface via lastJoinError or a disconnect.
        giveUp();
      }
    },
    [serverKey, awaitLanding, giveUp, leaveOther],
  );

  // Carry out a deep-link join once the connection is ready. Fires at most once
  // per arrival (the ref guard), and reports rather than acts when it cannot.
  // biome-ignore lint/correctness/useExhaustiveDependencies: onJoin changes with the one-battle rule, re-adding it would loop the join
  useEffect(() => {
    if (!deeplinkJoin || deeplinkHandled.current) return;
    if (!ready) {
      deeplinkHandled.current = true;
      notify({
        title: "Connect first to join",
        body: `Log in to ${deeplinkJoin.server}, then open the link again.`,
        level: "error",
      });
      return;
    }
    const target = all.find((b) => String(b.id) === deeplinkJoin.battle);
    if (!target) {
      deeplinkHandled.current = true;
      notify({
        title: "Battle not found",
        body: `Battle "${deeplinkJoin.battle}" is not open on this server.`,
        level: "error",
      });
      return;
    }
    deeplinkHandled.current = true;
    void onJoin(target, deeplinkJoin.password);
  }, [deeplinkJoin, ready, all]);

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

  // Every way of opening a battle below leaves a battle on another server
  // first, once the form has said so (issue #2844). A failed leave is thrown,
  // so the form that asked shows it.
  //
  // Open a battle we host. The OPENBATTLE ack sets `currentBattle`, which the join
  // effect above turns into navigation to the room (same path as joining).
  async function onHost(args: OpenBattleArgs) {
    await leaveOther();
    awaitLanding(!!hostDraft);
    try {
      await mpOpenBattle({ serverKey, ...args });
    } catch (e) {
      giveUp();
      // Thrown on rather than dropped. A refusal that never reached the wire has
      // no join error and no disconnect behind it, so the popover the host
      // pressed in is the only place it can be read (issue #1591).
      throw e;
    }
  }

  // Open a room on a Zero-K server. The server founds it in our name and puts us
  // in it, so `currentBattle` is set by the same `JoinBattleSuccess` a join
  // produces and the effect above takes us to the room. Nothing runs here, so a
  // draft's bots and options have nowhere to go and the draft is not carried.
  //
  // Held stable across renders so the form it belongs to can be, which is what
  // keeps an open map picker from being rebuilt every time a battle changes in
  // the list behind it.
  const onZerokHost = useCallback(
    async (args: ZerokOpenBattleArgs) => {
      await leaveOther();
      awaitLanding(false);
      try {
        await mpZerokOpenBattle({ serverKey, ...args });
      } catch (e) {
        giveUp();
        // Thrown on rather than dropped, for the same reason `onHost` throws: a
        // refusal that never reached the wire has no join error behind it.
        throw e;
      }
    },
    [serverKey, awaitLanding, giveUp, leaveOther],
  );

  // Create a lobby on a Tachyon server. The response is the whole lobby and it
  // puts us in it, so it sets `currentBattle` exactly as a join does and the
  // effect above takes us to the room. Nothing here hosts anything.
  async function onCreate(args: CreateLobbyArgs) {
    try {
      await leaveOther();
    } catch {
      return;
    }
    awaitLanding(false);
    try {
      await mpCreateLobby({ serverKey, ...args });
    } catch {
      giveUp();
    }
  }

  const leave = useCallback(async () => {
    await leaveBattle(serverKey).catch(() => {});
  }, [serverKey]);

  // Every protocol opens a room in its own words, so the control swaps rather
  // than one of them being hidden. On TASServer this machine becomes the host.
  // Under Tachyon the server allocates a dedicated autohost and a client cannot
  // host at all, so what it offers instead is a lobby (see
  // `docs/tachyon-protocol.md`). Zero-K sits between the two: the server runs
  // the game, but the room is opened in a player's name and founding it carries
  // the room's commands with it.
  const openControl =
    protocol === "tachyon" ? (
      <CreateLobbyPopover
        disabled={!canJoin}
        onCreate={onCreate}
        initialMap={hostDraft?.mapName ?? hostMap}
        autoOpen={!!hostMap || !!hostDraft}
        leaves={rule.notice("create")}
      />
    ) : protocol === "zerok" ? (
      <HostZerokBattlePopover
        disabled={!canJoin}
        onHost={onZerokHost}
        initialMap={hostDraft?.mapName ?? hostMap}
        initialTitle={hostTitle}
        autoOpen={!!hostMap || !!hostDraft}
        leaves={rule.notice("host")}
      />
    ) : (
      <HostBattleButton
        disabled={!canJoin}
        relayAvailable={relayHostingAvailable(mirror.state)}
        serverKey={serverKey}
        onHost={onHost}
        initialMap={hostDraft?.mapName ?? hostMap}
        initialGame={hostDraft?.gameName}
        initialTitle={hostTitle}
        autoOpen={!!hostMap || !!hostDraft}
        leaves={rule.notice("host")}
      />
    );

  const lastJoinError = mirror.lastJoinError;
  const joinError = lastJoinError && (
    <div
      role="alert"
      className="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive"
    >
      Join failed: {lastJoinError}
    </div>
  );

  const list = (
    <BattleList
      battles={shown}
      totalCount={totalCount}
      joinedBattle={joinedBattle}
      joinedId={joinedId}
      inProgressIds={inProgressIds}
      canJoin={canJoin}
      onJoin={onJoin}
      onLeave={leave}
      enginePath={selected?.enginePath}
      dataDir={selected?.rootPath}
      // What the row can hand out depends on what it is connected to, so both
      // halves go down and `inviteLink` decides. A room of our own is dialled
      // over loopback and offers nothing, because the only address it could
      // name is 127.0.0.1 and the room line at the top of this page has the
      // real ones (issue #1615). Somebody else's room offers the address we
      // dialled it on (issue #1617).
      serverAddress={serverAddressFromKey(serverKey)}
      directRoom={directRoom}
      leaves={rule.notice("join")}
    />
  );

  if (layout === "section") {
    return (
      <section className="border-b border-border">
        <div className="flex items-center justify-between gap-2 px-4 pt-3 pb-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {usernameFromKey(serverKey)} on {serverNameFor(serverKey, servers)}
            <span className="ml-2 font-normal normal-case">
              {shown.length === totalCount
                ? `(${totalCount})`
                : `(${shown.length} of ${totalCount})`}
            </span>
          </h2>
          {openControl}
        </div>
        {joinError}
        {list}
      </section>
    );
  }

  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Battles</h1>
          <span className="text-sm text-muted-foreground">
            {shown.length === totalCount
              ? `(${totalCount})`
              : `(${shown.length} of ${totalCount})`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {openControl}
          {pageControls}
        </div>
      </header>

      {joinError}

      {/* Said once above the list rather than on every row, because it is about
          this machine and not about any one battle (issue #2800). The shorter
          of the two wordings: all a VPN costs somebody joining is their own
          ping. The host gets the longer one in the hosting drawer. */}
      <VpnWarning place="join" className="px-4 pt-3" />

      <div className="border-b border-border px-4 py-3">{lanSection}</div>

      {list}
    </main>
  );
}

/**
 * The Battles hub: search + filter/sort controls over the live battle list, with
 * in-place join. With two or more lobby connections, each server's battles are
 * listed under a heading naming it (issue #2844). Joining is reflected by the
 * joined banner rather than navigating away. Connection lives on the Login page;
 * disconnected shows a prompt. Reachable with no connection, because this is
 * also where a room is hosted with no server at all.
 */
function BattlesPage() {
  const {
    connections,
    activeKey,
    activeDirect,
    busy,
    clearJoinError,
    openLoginPopover,
    connectDirect,
    disconnect,
    directKey,
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
  const [filters, setFilters] = useBattleFilters();
  // Selected engine + content root for the room forms' local content.
  const { selected } = useScanTargetSelection();

  // Every live connection, the focused one first, so a single connection is
  // listed exactly as it was before servers were told apart.
  const liveKeys = useMemo(() => {
    const keys = Object.keys(connections).filter((k) => connections[k].live);
    if (activeKey == null) return keys;
    return [activeKey, ...keys.filter((k) => k !== activeKey)];
  }, [connections, activeKey]);

  // A distribution profile can preset a game filter; when set, the battle list is
  // hard-scoped to that game (matched on modname) — the bundled build only ever
  // shows its own game's battles. No profile => no scoping.
  const gameMatch = useMemo(() => getGameMatcher(), []);
  const lists = useMemo(
    () =>
      Object.fromEntries(
        liveKeys.map((key) => {
          const all = Object.values(
            connections[key]?.mirror.state?.battles ?? {},
          );
          const scoped = gameMatch
            ? all.filter((b) => gameMatch(b.modname))
            : all;
          return [key, { scoped, shown: filterSortBattles(scoped, filters) }];
        }),
      ),
    [liveKeys, connections, gameMatch, filters],
  );
  const focusedBattles = Object.values(
    (activeKey != null ? connections[activeKey] : undefined)?.mirror.state
      ?.battles ?? {},
  );

  // A content map detail's "Host a battle here" navigates here with the map name,
  // preselecting it in the host popover and opening it on arrival.
  const location = useLocation();
  const hostMap = (location.state as { hostMap?: string } | null)?.hostMap;

  // A Singleplayer preset's "Host as battle" (issue #373) navigates here with the
  // draft to host and a title. Preselect its game/map/title and, once the room
  // opens, forward the same draft to the battle room so it can seed the room's
  // options, start boxes, host seat and bots (see `BattleRoomPage`'s apply effect).
  //
  // `hostServerKey` is the connection `SkirmishPage` resolved it to when more
  // than one could host (issue #2847): the draft is seeded there rather than
  // wherever happens to be focused, which used to strand it on a connection
  // that could not host at all (a live Tachyon connection focused ahead of
  // the TASServer one the player actually meant).
  const hostState = location.state as {
    hostDraft?: SkirmishDraft;
    hostTitle?: string;
    hostServerKey?: string;
  } | null;
  const hostDraft = hostState?.hostDraft;
  const hostTargetKey = hostState?.hostServerKey ?? activeKey;

  // A confirmed coilbox://join deep link (issue #388) navigates here with the
  // target server and battle id. Join only when already connected to a server
  // and the battle is open. Cross-server auto-connect is out of scope, so an
  // unconnected or missing target is reported rather than acted on silently.
  // The focused connection's list carries it out.
  const deeplinkJoin = (
    location.state as {
      deeplinkJoin?: DeeplinkJoin;
    } | null
  )?.deeplinkJoin;
  const deeplinkJoinHandledRef = useRef(false);
  useEffect(() => {
    if (!deeplinkJoin || deeplinkJoinHandledRef.current || activeKey) return;
    deeplinkJoinHandledRef.current = true;
    notify({
      title: "Connect first to join",
      body: `Log in to ${deeplinkJoin.server}, then open the link again.`,
      level: "error",
    });
  }, [deeplinkJoin, activeKey]);

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

  // The join or host waiting to land, shared by every connection's list and the
  // room flows below (see `PendingEntry`).
  const pending = useRef<PendingEntry>(null);

  // Start a room of our own: bind the port, dial it over loopback like any other
  // server, then open the battle in it. Landing in the battle room is the join
  // effect above doing what it does for every other battle.
  //
  // Failures are thrown rather than stored, because the only place a host can read
  // one is the drawer they pressed Start in, and the drawer holds the element it
  // was opened with. So the form asking is the form told.
  async function onStartRoom(args: StartRoomArgs): Promise<string> {
    setRoomBusy(true);
    let port: number;
    try {
      ({ port } = await directStartRoom({
        host: args.host,
        port: args.port,
        advertise: args.advertise,
        approveJoins: args.approveJoins,
        publicAddress: args.publicAddress,
      }));
    } catch (e) {
      setRoomBusy(false);
      throw new Error(startRoomFailure(e, args.port));
    }
    try {
      const key = await connectDirect(port, args.host);
      clearJoinError(key);
      pending.current = { serverKey: key, seeded: false };
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
      return key;
    } catch (e) {
      // The room is up but we are not in it, which is a room nobody can host.
      // Take it down rather than leave a listener with no owner behind.
      pending.current = null;
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
      // The room's own connection rather than whichever is focused.
      await stopHostedRoom(room?.host ?? "", () =>
        disconnect(directKey ?? undefined),
      );
    } catch (e) {
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
      clearJoinError(key);
      pending.current = { serverKey: key, seeded: false };
      await mpJoinBattle({
        serverKey: key,
        id: battle.id,
        key: args.password || undefined,
        scriptPassword: newScriptPassword(),
      });
    } catch (e) {
      // Connected to a room with nothing to join in it is worse than not
      // connected: it holds the one lobby connection and shows an empty lobby.
      pending.current = null;
      await disconnect(key).catch(() => {});
      throw e;
    }
  }

  // The list is everybody else's rooms. A host is already in their own, so it
  // sits in the battle list below with the way back into it, and listing it here
  // as well was the same room twice (issue #1608). What the host's own beacon
  // proves is said on the host's own line instead. Joining somebody else's room
  // is the same duplicate: once connected, that room is the whole Open list
  // below, so it drops out of Local network too (issue #2734).
  //
  // A direct room holds exactly one battle, so the first while `activeDirect` is
  // it, and its title, host, game and map are the same four fields the room's
  // own beacon is announcing (issue #2857). Reading those off the connected
  // battle instead of matching addresses means it still catches the room when a
  // joiner dialled a hostname the beacon has no way to know resolves to the IP
  // it is announcing.
  const roomBattleNow = focusedBattles[0];
  const connectedRoom =
    activeDirect && activeKey && roomBattleNow
      ? {
          title: roomBattleNow.title,
          host: roomBattleNow.host,
          game: roomBattleNow.modname,
          map: roomBattleNow.map,
        }
      : null;
  const lanSection = (
    <>
      <LanRooms
        rooms={otherRooms(lan.rooms, connectedRoom)}
        error={lan.error}
        blocked={joinBlockedReason(activeKey, activeDirect, room !== null)}
        defaultName={lastLogin?.username}
        enginePath={selected?.enginePath}
        dataDir={selected?.rootPath}
        onJoin={onJoinRoom}
      />
      <LinkedRoomJoin
        target={deeplinkRoom}
        blocked={joinBlockedReason(activeKey, activeDirect, room !== null)}
        defaultName={lastLogin?.username}
        onJoin={onJoinRoom}
      />
    </>
  );

  const hostControl = (
    <HostRoomControl
      room={room}
      heardOnNetwork={ownRoomHeard(lan.rooms)}
      blocked={hostBlockedReason(activeKey, activeDirect)}
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

  const filterControl = (
    <BattleFilterPopover filters={filters} setFilters={setFilters} />
  );

  // One connection is the page it always was, with its own way to open a
  // battle in the header.
  if (liveKeys.length <= 1) {
    const key = liveKeys[0] ?? activeKey;
    return (
      <ServerBattles
        key={key}
        serverKey={key}
        layout="page"
        battles={lists[key]?.shown ?? []}
        totalCount={lists[key]?.scoped.length ?? 0}
        pending={pending}
        hostDraft={hostDraft}
        hostMap={hostMap}
        hostTitle={hostState?.hostTitle}
        deeplinkJoin={deeplinkJoin}
        deeplinkHandled={deeplinkJoinHandledRef}
        pageControls={
          <>
            {hostControl}
            {filterControl}
          </>
        }
        lanSection={lanSection}
      />
    );
  }

  // Two or more: one section per server, each naming it and carrying that
  // server's way to open a battle (issue #2844).
  const shownCount = liveKeys.reduce(
    (n, k) => n + (lists[k]?.shown.length ?? 0),
    0,
  );
  const totalCount = liveKeys.reduce(
    (n, k) => n + (lists[k]?.scoped.length ?? 0),
    0,
  );
  return (
    <main className="flex h-full min-h-0 flex-col">
      <header className="flex items-center justify-between gap-2 border-b border-border p-4">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-semibold">Battles</h1>
          <span className="text-sm text-muted-foreground">
            {shownCount === totalCount
              ? `(${totalCount})`
              : `(${shownCount} of ${totalCount})`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {hostControl}
          {filterControl}
        </div>
      </header>

      <VpnWarning place="join" className="px-4 pt-3" />

      <div className="border-b border-border px-4 py-3">{lanSection}</div>

      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {liveKeys.map((key) => {
          const focused = key === activeKey;
          const hosting = key === hostTargetKey;
          return (
            <ServerBattles
              key={key}
              serverKey={key}
              layout="section"
              battles={lists[key]?.shown ?? []}
              totalCount={lists[key]?.scoped.length ?? 0}
              pending={pending}
              hostDraft={hosting ? hostDraft : undefined}
              hostMap={focused ? hostMap : undefined}
              hostTitle={hosting ? hostState?.hostTitle : undefined}
              deeplinkJoin={focused ? deeplinkJoin : undefined}
              deeplinkHandled={deeplinkJoinHandledRef}
            />
          );
        })}
      </div>
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
