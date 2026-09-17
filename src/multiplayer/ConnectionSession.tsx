import { useEffect, useRef } from "react";
import {
  type LobbyServer,
  profileOfficialServer,
} from "../lobby-servers/config";
import { notify } from "../notify/notify";
import { sendAdminCommand } from "./admin/adminRequest";
import {
  mpFriendList,
  mpFriendRequestList,
  mpIgnore,
  mpIgnoreList,
  mpJoinBattle,
} from "./bindings";
import {
  type JoinedChannels,
  normalizeChannelList,
  profileDefaultChannels,
} from "./channels";
import { backfilledCounts, conversationCounts } from "./chat/conversation";
import type { ConnectionRuntime, ConnectionState } from "./connections";
import { favouritesFor } from "./friends";
import { addIgnore, ignoredFor } from "./ignore";
import { autoJoinsChannels, protocolForKey, syncsOnReady } from "./protocol";
import { newScriptPassword } from "./scriptPassword";
import { adminLevelFromOutcome, isUberserver } from "./serverAdmin";
import { useAwayStatus } from "./useAwayStatus";

type NameLists = Record<string, string[]>;

export interface ConnectionSessionProps {
  entry: ConnectionState;
  runtime: ConnectionRuntime;
  /** The built-in and custom servers, to read the connection's protocol. */
  servers: LobbyServer[];
  joinedChannels: JoinedChannels;
  setJoinedChannels: (next: JoinedChannels) => void;
  ignored: NameLists;
  setIgnored: (next: NameLists) => void;
  favourites: NameLists;
  requestJoinChannel: (
    channel: string,
    key: string | undefined,
    serverKey: string,
  ) => Promise<unknown>;
  update: (
    serverKey: string,
    update: (c: ConnectionState) => ConnectionState,
  ) => void;
  /** Tell the provider a seen mark moved, so unread counts re-render. */
  onSeenChange: () => void;
  /** Whether a game is running, which every connection reports (issue #2848). */
  ingame: boolean;
  /** Whether the user set themselves away by hand, on every connection. */
  manualAway: boolean;
}

/**
 * The effects that run for one lobby connection (issue #2841), rendered by the
 * provider once per entry. Each used to run once in the provider against its
 * one `activeKey`. Here they run against this entry's key, and only while the
 * entry is live, which is when the provider's `activeKey` was that key.
 *
 * Renders nothing.
 */
export function ConnectionSession({
  entry,
  runtime,
  servers,
  joinedChannels,
  setJoinedChannels,
  ignored,
  setIgnored,
  favourites,
  requestJoinChannel,
  update,
  onSeenChange,
  ingame,
  manualAway: manualAwayWanted,
}: ConnectionSessionProps) {
  const serverKey = entry.serverKey;
  const mirror = entry.mirror;
  // The key while this connection is live, and null otherwise, so each effect
  // below reads exactly as it did against the provider's `activeKey`.
  const activeKey = entry.live ? serverKey : null;
  const protocol = protocolForKey(activeKey, servers);

  // Seed the seen marks to the connect-time snapshot so persisted DM history
  // and already-present channel logs don't show as unread. Conversations
  // appearing after connect start unseen (fully unread).
  useEffect(() => {
    if (activeKey == null) {
      runtime.seen = {};
      runtime.baselineDone = false;
      return;
    }
    if (!mirror.state) return;
    if (!runtime.baselineDone) {
      runtime.seen = conversationCounts(mirror.state);
      runtime.baselineDone = true;
      onSeenChange();
      return;
    }
    // A channel's stored backlog arrives after that baseline, since we only ask
    // for it once joined, and streams in a message at a time, so it would
    // otherwise read as a channel's worth of unread the moment you join. Keep
    // each seen mark at or above the backlog behind it. This only ever raises,
    // so live messages arriving afterwards still count as unread as normal.
    let raised = false;
    for (const [id, n] of Object.entries(backfilledCounts(mirror.state))) {
      if ((runtime.seen[id] ?? 0) < n) {
        runtime.seen[id] = n;
        raised = true;
      }
    }
    if (raised) onSeenChange();
  }, [activeKey, mirror.state, runtime, onSeenChange]);

  // A new session is a fresh start for join failures: clear them so a
  // recovered channel is re-notified next time and no stale badge lingers.
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeKey is the reset trigger (a session change), not read in the body
  useEffect(() => {
    update(serverKey, (c) =>
      Object.keys(c.channelJoinFailures).length === 0
        ? c
        : { ...c, channelJoinFailures: {} },
    );
    runtime.notifiedJoinFailures = new Set();
    runtime.pendingJoins = new Set();
  }, [activeKey, runtime, serverKey, update]);

  // Auto-join the configured channels once per session, after login reaches
  // the `ready` phase (JOIN before ACCEPTED would be rejected). The ref guards
  // against re-firing when `joinedChannels` changes mid-session (e.g. the user
  // joins one). Each entry may carry a key/password, passed straight to JOIN.
  //
  // A Tachyon server has no named channels, so it gets none of this and the
  // auto-join list is hidden in settings to match (see `autoJoinsChannels`).
  const rejoinedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeKey == null) {
      rejoinedForRef.current = null;
      return;
    }
    if (!autoJoinsChannels(protocol)) return;
    if (mirror.phase === "ready" && rejoinedForRef.current !== activeKey) {
      rejoinedForRef.current = activeKey;
      // First-ever connect for this login (no stored list yet) to the
      // profile's official server: seed the distribution's default channels.
      // Seed-once, so the user can leave them afterwards and they stay gone.
      let entries = normalizeChannelList(joinedChannels[activeKey]);
      const official = profileOfficialServer();
      if (
        joinedChannels[activeKey] === undefined &&
        official != null &&
        activeKey.endsWith(`@${official.host}:${official.port}`)
      ) {
        const seed = profileDefaultChannels();
        if (seed.length > 0) {
          entries = seed;
          setJoinedChannels({ ...joinedChannels, [activeKey]: seed });
        }
      }
      for (const { name, key } of entries) {
        // A settings row can be added before it is named, so skip a JOIN "".
        if (!name.trim()) continue;
        requestJoinChannel(name, key, activeKey).catch((e) =>
          console.warn("multiplayer: auto-join channel failed", name, e),
        );
      }
      // Pull the server's ignore list so it can be reconciled with the local
      // one (see below). Best-effort: unsupported servers never send a list,
      // and local hiding still applies.
      mpIgnoreList({ serverKey: activeKey }).catch(() => {});
    }
  }, [
    activeKey,
    protocol,
    mirror.phase,
    joinedChannels,
    requestJoinChannel,
    setJoinedChannels,
  ]);

  // Reconcile the local ignore list with the server's once its IGNORELIST
  // arrives: fold any server-confirmed ignores we lack into the local store,
  // and push any local-only ignores up so the server suppresses them too.
  // Driven off the received-list seq (not the map) so setting the map here
  // can't re-trigger it, and reading the delta payload avoids racing the
  // snapshot.
  const ignoredRef = useRef(ignored);
  useEffect(() => {
    ignoredRef.current = ignored;
  }, [ignored]);
  const ignoreReconciledRef = useRef(0);
  useEffect(() => {
    if (activeKey == null) {
      ignoreReconciledRef.current = 0;
      return;
    }
    const seq = mirror.serverIgnoreListSeq;
    if (seq === 0 || seq === ignoreReconciledRef.current) return;
    ignoreReconciledRef.current = seq;

    const server = mirror.serverIgnoreList;
    const local = ignoredFor(ignoredRef.current, activeKey);

    // Add server-confirmed ignores we don't have locally (addIgnore dedupes).
    let next = ignoredRef.current;
    for (const name of server) next = addIgnore(next, activeKey, name);
    if (next !== ignoredRef.current) setIgnored(next);

    // Push local-only ignores up so both sides converge. Best-effort, since a
    // server that just replied with an empty list may still not support IGNORE.
    const known = new Set(server.map((n) => n.toLowerCase()));
    for (const name of local) {
      if (name.trim() && !known.has(name.toLowerCase())) {
        mpIgnore({ serverKey: activeKey, username: name }).catch(() => {});
      }
    }
  }, [
    activeKey,
    mirror.serverIgnoreListSeq,
    mirror.serverIgnoreList,
    setIgnored,
  ]);

  // Sync the server-side friend list and pending requests once per session,
  // after login reaches `ready`. A server without friend support ignores the
  // lines, so failure is swallowed and local favourites keep working. Tachyon
  // has friends of its own, but not over these commands (see `syncsOnReady`).
  const friendsSyncedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeKey == null) {
      friendsSyncedForRef.current = null;
      return;
    }
    if (!syncsOnReady(protocol)) return;
    if (mirror.phase === "ready" && friendsSyncedForRef.current !== activeKey) {
      friendsSyncedForRef.current = activeKey;
      mpFriendList({ serverKey: activeKey }).catch(() => {});
      mpFriendRequestList({ serverKey: activeKey }).catch(() => {});
    }
  }, [activeKey, protocol, mirror.phase]);

  // Once this account's `access` status bit is set, ask uberserver whether it
  // is an admin or only a moderator (issue #2776): the bit alone is set for
  // both, but a moderator or admin can `GETUSERINFO` their own name and read
  // the `access=` line it carries. Sent once per session, the same as the
  // effects above. `ConnectionState.adminLevel` starts and stays "mod" until
  // this settles it, so a refusal or no answer only ever hides a tool the
  // server would refuse rather than shows one it would.
  const adminLevelQueriedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeKey == null) {
      adminLevelQueriedForRef.current = null;
      return;
    }
    if (
      mirror.phase !== "ready" ||
      adminLevelQueriedForRef.current === activeKey
    ) {
      return;
    }
    const me = mirror.state?.myUsername;
    const hasAccess = !!me && (mirror.state?.users[me]?.status.access ?? false);
    if (!me || !hasAccess || !isUberserver(protocol, mirror.state)) return;
    adminLevelQueriedForRef.current = activeKey;
    sendAdminCommand(activeKey, "GETUSERINFO", [me], "userInfo")
      .then((outcome) => {
        const level = adminLevelFromOutcome(outcome);
        if (level == null) return;
        update(serverKey, (c) =>
          c.adminLevel === level ? c : { ...c, adminLevel: level },
        );
      })
      .catch(() => {});
  }, [activeKey, protocol, mirror.phase, mirror.state, serverKey, update]);

  // Notify when a friend (server-side or a client-local favourite) comes online
  // or goes offline. The lobby has no friend presence event, so this diffs the
  // roster between snapshots. Gated on `ready` (the initial ADDUSER dump
  // completes before then) and baselined on the first ready snapshot so the
  // login roster flood never fires a burst of notifications.
  const prevRosterRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const st = mirror.state;
    if (activeKey == null || mirror.phase !== "ready" || !st) {
      prevRosterRef.current = null;
      return;
    }
    const roster = new Set(Object.keys(st.users));
    const prev = prevRosterRef.current;
    prevRosterRef.current = roster;
    if (prev == null) return; // baseline the first ready snapshot, don't notify
    const watched = new Set<string>([
      ...(st.friends ?? []),
      ...favouritesFor(favourites, activeKey),
    ]);
    for (const name of watched) {
      if (name === st.myUsername) continue;
      const online = roster.has(name);
      if (online && !prev.has(name))
        void notify({ title: `${name} is online` });
      else if (!online && prev.has(name))
        void notify({ title: `${name} went offline` });
    }
  }, [activeKey, mirror.phase, mirror.state, favourites]);

  // Away status (issue #333): see useAwayStatus for the design. The provider
  // owns the in-game and manual away choices, because one person at one
  // keyboard is in a game or away on every connection at once (issue #2848).
  // They are copied in here after the hook's own reset on a session change,
  // so a connection that opens mid-game still reports it. The resolved pair
  // is copied into the entry for the context to read.
  const { status, setIngame, manualAway, setManualAway } = useAwayStatus(
    activeKey,
    protocol,
    mirror.phase,
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeKey is the re-apply trigger, after the hook resets on a session change
  useEffect(() => {
    setIngame(ingame);
  }, [activeKey, ingame, setIngame]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: activeKey is the re-apply trigger, after the hook resets on a session change
  useEffect(() => {
    setManualAway(manualAwayWanted);
  }, [activeKey, manualAwayWanted, setManualAway]);
  useEffect(() => {
    update(serverKey, (c) =>
      c.status === status && c.manualAway === manualAway
        ? c
        : { ...c, status, manualAway },
    );
  }, [serverKey, status, manualAway, update]);

  // After a reconnect reaches `ready`, rejoin the battle captured before the
  // drop if it's still open (channels replay via the effect above). Once per
  // session and best-effort: a closed/passworded battle is skipped.
  const rejoinBattleDoneRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeKey == null) {
      rejoinBattleDoneRef.current = null;
      return;
    }
    if (mirror.phase !== "ready" || rejoinBattleDoneRef.current === activeKey) {
      return;
    }
    rejoinBattleDoneRef.current = activeKey;
    const target = runtime.rejoinBattle;
    runtime.rejoinBattle = null;
    if (!target) return;
    const stillOpen = mirror.state?.battles[String(target.id)] != null;
    if (!stillOpen) {
      void notify({ title: "Your battle is no longer open" });
      return;
    }
    mpJoinBattle({
      serverKey: activeKey,
      id: target.id,
      // A fresh one when the server never echoed the old back: teiserver
      // refuses a JOINBATTLE that carries no script password at all.
      scriptPassword: target.scriptPassword ?? newScriptPassword(),
    }).catch((e) => console.warn("multiplayer: auto-rejoin battle failed", e));
  }, [activeKey, mirror.phase, mirror.state, runtime]);

  return null;
}
