import { Button, NavGate } from "@picoframe/frame";
import { useEffect, useMemo, useRef } from "react";
import { useLocation, useNavigate } from "react-router";
import type { SkirmishDraft } from "@/play/drafts";
import { useScanTargetSelection } from "../../content/config";
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
} from "../bindings";
import { newScriptPassword } from "../scriptPassword";
import { serverAddressFromKey, useMpRevealed, useMultiplayer } from "../store";

/**
 * The Battles hub: search + filter/sort controls over the live battle list, with
 * in-place join. Battles come from the mirror snapshot (kept fresh by the store's
 * delta→snapshot rule); joining is reflected by the joined banner rather than
 * navigating away. Connection lives on the Login page; disconnected shows a prompt.
 * Reachable only once the user has connected this session (see the `NavGate`
 * wrapper below); before that, the route redirects to Login.
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
  } = useMultiplayer();
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
  async function onJoin(b: Battle, key?: string) {
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
  }

  // Open a battle we host. The OPENBATTLE ack sets `currentBattle`, which the join
  // effect above turns into navigation to the room (same path as joining).
  async function onHost(args: OpenBattleArgs) {
    if (!activeKey) return;
    clearJoinError();
    hostingFromDraftRef.current = !!hostDraft;
    joiningRef.current = true;
    try {
      await mpOpenBattle({ serverKey: activeKey, ...args });
    } catch {
      joiningRef.current = false;
      hostingFromDraftRef.current = false;
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

  async function leave() {
    if (!activeKey) return;
    await mpLeaveBattle({ serverKey: activeKey }).catch(() => {});
  }

  if (!activeKey) {
    return (
      <main className="flex flex-col items-center justify-center gap-4 p-10 text-center">
        <h1 className="text-lg font-semibold">Battles</h1>
        <p className="text-sm text-muted-foreground">
          You are not connected to a lobby server.
        </p>
        <Button onClick={openLoginPopover}>Connect…</Button>
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

/** Route entry: gated behind having connected at least once this session. */
export default function BattlesRoute() {
  return (
    <NavGate use={useMpRevealed} redirectTo="/lobby">
      <BattlesPage />
    </NavGate>
  );
}
