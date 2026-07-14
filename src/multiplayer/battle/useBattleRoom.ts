import { useSetting } from "@picoframe/frame";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfigOption, GameItem, MapItem, Side } from "@/content/bindings";
import {
  invalidateMapPreview,
  useUnitsyncGameInfo,
  useUnitsyncMapInfo,
  useUnitsyncScan,
} from "@/content/config";
import { isBlackHex, pickTeamColorHex } from "@/lib/teamColor";
import {
  type PlayTarget,
  usePreferredTarget,
  useSkirmishAis,
} from "@/play/config";
import type { Battle, MemberStatus, Vote } from "../bindings";
import {
  mpAddBot,
  mpForceAlly,
  mpForceColor,
  mpForceSpectator,
  mpForceTeam,
  mpKick,
  mpLeaveBattle,
  mpRemoveBot,
  mpRemoveScriptTags,
  mpRemoveStartRect,
  mpSayBattle,
  mpSetBattleStatus,
  mpSetScriptTags,
  mpSetStartRect,
  mpSetStatus,
  mpUpdateBattleInfo,
} from "../bindings";
import { useMultiplayer } from "../store";
import { battleOptionTags, canEditBattleOptions } from "./battleOptions";
import {
  battleStartable,
  deriveSync,
  hexToColorInt,
  type MemberRow,
  membersToRows,
  type SyncState,
  startPosTypeOf,
  usedColorsFromBattle,
} from "./config";
import { diffRestrictTags } from "./restrictTags";

/** Format a rejected command for the action-error banner (matches useBattleLaunch). */
const mpErr = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The battle room's single data+action hook. It reads the current battle out of
 * the live mirror (never holding local battle state — the store replaces the
 * snapshot wholesale on every delta), resolves the local engine/content target,
 * and exposes memoised actions for our own status, leaving, and autohost `!`
 * commands. The UI calls these rather than the bindings directly, mirroring
 * `chat/useConversation`.
 */
export interface BattleRoomView {
  battle: Battle | undefined;
  me: string | null;
  myStatus: MemberStatus | undefined;
  /** Whether the logged-in user founded the battle (rare — usually the autohost). */
  isFounder: boolean;
  /** We founded this battle AND we host it ourselves (not via an autohost bot). */
  selfHost: boolean;
  target: PlayTarget | null;
  targetLoading: boolean;
  enginePath: string | undefined;
  dataDir: string | undefined;
  /** All locally-scanned maps (for the map-suggestion picker). */
  maps: MapItem[];
  /** The locally-scanned map matching the battle, for true proportions. */
  localMap: MapItem | undefined;
  /** The locally-scanned game matching the battle, if installed. */
  localGame: GameItem | undefined;
  rows: MemberRow[];
  sides: Side[];
  /** Mod-option schema from the game archive (empty if the game isn't installed). */
  modOptionsSchema: ConfigOption[];
  /** Map-option schema from the map archive (empty if the map isn't installed). */
  mapOptionsSchema: ConfigOption[];
  /** Whether the local user may edit options (founder, or the host is an autohost). */
  canEditOptions: boolean;
  /** Dispatch one option edit: founder → SETSCRIPTTAGS, autohost → `!bSet`. */
  sendOption: (tagKey: string, spadsName: string, value: string) => void;
  /** Apply a whole preset's option tags at once (founder batch-set + prune omitted;
   * autohost `!bSet` per value). */
  applyOptionTags: (tags: Record<string, string>) => void;
  /**
   * Whether the local user may edit unit restrictions: only the actual battle
   * founder (we own the `game/restrict/*` script tags — there's no autohost path).
   */
  canEditRestrictions: boolean;
  /** Set the full disabled-unit set as engine-native `game/restrict/*` script tags. */
  setRestrictions: (disabled: string[]) => void;
  /**
   * Whether the local user may draw/clear start boxes: they can edit options AND
   * the battle is in "choose in-game" mode (startPosType 2) — SPADS rejects box
   * commands otherwise, and boxes are only meaningful then.
   */
  canEditBoxes: boolean;
  /**
   * Set (create/move/resize) one ally's start box; `ally` is 0-based. Founder →
   * ADDSTARTRECT; autohost → `!addbox <l> <t> <r> <b> <ally+1>` (SPADS teamNb is
   * 1-based and replaces the ally's box). Coords are 0..200 ints, left<=right,
   * top<=bottom.
   */
  setStartBox: (
    ally: number,
    rect: { left: number; top: number; right: number; bottom: number },
  ) => void;
  /** Clear one ally's start box (0-based). Founder → REMOVESTARTRECT; autohost → `!clearbox <ally+1>`. */
  clearStartBox: (ally: number) => void;
  startPosType: number;
  mapMissing: boolean;
  gameMissing: boolean;
  /** True once local content presence is known (scan settled). */
  contentKnown: boolean;
  sync: SyncState;
  /**
   * The reason the last battle action (kick, force, ready, start, leave, …)
   * failed, or null. Surfaced as a banner so a failed action isn't a silently
   * dead button. Clears on the next successful action.
   */
  actionError: string | null;
  /** Whether the battle host (autohost) is in-game — i.e. the match has started. */
  hostIngame: boolean;
  /**
   * The live SPADS autohost vote in this battle, or null. Only ever set for
   * autohost battles (a bot host posts the vote lines we parse); drives the
   * one-click vote panel. Vote with `autohostSend("!vote y|n|b")`.
   */
  currentVote: Vote | null;
  /** Whether the match can start: a playing participant (human or bot) exists and
   * every non-spectator human is ready (see `battleStartable`). */
  allReady: boolean;
  serverKey: string | null;
  /** Bumped on rescan/download so content-dependent subtrees can remount+refetch. */
  contentNonce: number;
  setReady: (ready: boolean) => void;
  setSpectator: (spectator: boolean) => void;
  setSide: (side: number) => void;
  setTeam: (teamId: number) => void;
  setAlly: (ally: number) => void;
  setColor: (hex: string) => void;
  /** Set our own in-game flag (MYSTATUS); the host flips this to start the match. */
  setIngame: (ingame: boolean) => void;
  /** Host controls over another member (self-hosted battles only; no-op otherwise). */
  hostControls: {
    forceTeam: (user: string, team: number) => void;
    forceAlly: (user: string, ally: number) => void;
    forceColor: (user: string, hex: string) => void;
    forceSpectator: (user: string) => void;
    kick: (user: string) => void;
    removeBot: (name: string) => void;
  };
  /** AIs the host can add as bots (host only): the game's own AIs — native engine
   *  AIs and/or its Lua AIs — or the engine's natives when the game declares none. */
  addableAis: {
    shortName: string;
    kind: "native" | "lua";
    name?: string;
    version?: string;
    description?: string;
  }[];
  /** Add an AI bot on the next free team/ally (host only). Lua AIs are addable too:
   *  ADDBOT carries the shortName and the host scripts each as an `[AI]` block. */
  addBot: (aiShortName: string) => void;
  leave: () => Promise<void>;
  autohostSend: (command: string) => Promise<void>;
  /** Ask the autohost to start the match (`!start`). */
  startGame: () => Promise<void>;
  /** Ask the autohost to switch to a map (`!map <name>`). */
  suggestMap: (name: string) => Promise<void>;
  /**
   * Host: change the battle's map directly (UPDATEBATTLEINFO), preserving the
   * current lock/spectator fields. `maphash` is the map's signed 32-bit CRC.
   */
  setMap: (name: string, maphash: number) => void;
  /** Host: lock/unlock the battle directly (UPDATEBATTLEINFO), preserving the map. */
  setLocked: (locked: boolean) => void;
  /** Force a unitsync rescan and drop cached previews for the battle's map. */
  rescan: () => Promise<void>;
}

export function useBattleRoom(): BattleRoomView {
  const { mirror, activeKey } = useMultiplayer();
  const state = mirror.state;

  // The team colour we remember across battles and app restarts. Empty means
  // "never picked" — we assign a random colour the first time we need one.
  const [savedColor, setSavedColor] = useSetting<string>(
    "multiplayer.teamColor",
    "",
  );

  const battle =
    state?.currentBattle != null
      ? state.battles[String(state.currentBattle)]
      : undefined;
  const me = state?.myUsername ?? null;
  const myStatus = me ? battle?.members[me] : undefined;
  const isFounder = !!battle && !!me && battle.host === me;

  const { target, loading: targetLoading } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;

  const scan = useUnitsyncScan(enginePath, dataDir);
  const games = scan.data?.games ?? [];
  const maps = scan.data?.maps ?? [];
  const localGame = battle
    ? games.find((g) => g.name === battle.modname)
    : undefined;
  const localMap = battle ? maps.find((m) => m.name === battle.map) : undefined;
  const gameArchive = localGame?.primaryArchive.name;
  const gameInfo = useUnitsyncGameInfo(enginePath, dataDir, gameArchive);
  const sides = gameInfo.info?.sides ?? [];
  const mapInfo = useUnitsyncMapInfo(enginePath, dataDir, battle?.map);
  const modOptionsSchema = gameInfo.info?.options ?? [];
  const mapOptionsSchema = mapInfo.info?.options ?? [];
  const hostIsBot = !!battle && !!state?.users[battle.host]?.status.bot;
  const canEditOptions = canEditBattleOptions(isFounder, hostIsBot);
  // We founded the battle and run it ourselves (no autohost bot relaying it), so we
  // drive the roster/options over the protocol and launch the game as founder.
  const selfHost = isFounder && !hostIsBot;

  // AIs the host can add as bots. The game-scoped query already applies the game's
  // `validais.lua` whitelist and includes its own Lua AIs (from `LuaAI.lua`) — both
  // are addable over the lobby: ADDBOT carries the shortName and the host scripts
  // each as an `[AI]` block, so the engine resolves native and Lua AIs alike. Only
  // when the game declares no AIs at all (e.g. an empty/absent whitelist with no
  // Lua AIs) do we fall back to the engine's natives (a no-game query skips the
  // whitelist) so "Add AI" is never uselessly empty.
  const { ais } = useSkirmishAis(enginePath, dataDir, gameArchive);
  const { ais: engineAis } = useSkirmishAis(enginePath, dataDir, undefined);
  const addableAis = useMemo(
    () => (ais.length > 0 ? ais : engineAis.filter((a) => a.kind === "native")),
    [ais, engineAis],
  );

  const [contentNonce, setContentNonce] = useState(0);

  // Surface a failed battle action instead of the button silently doing nothing.
  // Each action promise ends in `.then(clearErr, setErr)`: it clears the banner on
  // success and records why it failed otherwise. The action stays best-effort
  // (never throws to the caller), matching the prior swallow but with feedback.
  const [actionError, setActionError] = useState<string | null>(null);
  const clearErr = useCallback(() => setActionError(null), []);
  const setErr = useCallback((e: unknown) => setActionError(mpErr(e)), []);

  // Content presence is scan-authoritative (the scanned map/game lists), so a
  // forced rescan after a download flips it. Only "known" once the scan settles,
  // so we don't briefly report content missing (and flag ourselves unsynced)
  // while unitsync is still loading.
  const scanSettled = !scan.loading || games.length > 0 || maps.length > 0;
  const contentKnown = !!target && scanSettled;
  const mapMissing = contentKnown && !localMap;
  const gameMissing = contentKnown && !localGame;

  const rows = useMemo(
    () => (battle ? membersToRows(battle, me, state?.users) : []),
    [battle, me, state?.users],
  );
  const sync: SyncState = battle
    ? deriveSync(battle, { mapMissing, gameMissing })
    : "pending";

  // Match state + start gating. The match has "started" once the host (autohost)
  // goes in-game; `allReady` gates our Start button on there being a playing
  // participant (human or bot) with every non-spectator human ready — so an
  // all-bot match with the host spectating still starts (the autohost/engine
  // enforces its own rules).
  const hostIngame = !!battle && !!state?.users[battle.host]?.status.ingame;
  const allReady = battleStartable(rows);
  const startPosType = battle ? startPosTypeOf(battle) : 0;

  // The colour we last intended (as the `0xBBGGRR` int), so a status push that
  // omits `color` never reverts to 0 while our colour echo is still in flight —
  // the bug behind "always black". Seeded by the assign-on-join effect below.
  const intendedColorRef = useRef(0);

  // Merge a patch over our current battle status and push it (MYBATTLESTATUS).
  // `color` is the `0xBBGGRR` int; `??` preserves current values for anything the
  // patch omits (safe for booleans since it only fills null/undefined).
  const pushStatus = useCallback(
    (patch: {
      ready?: boolean;
      teamId?: number;
      ally?: number;
      mode?: boolean;
      handicap?: number;
      sync?: number;
      side?: number;
      color?: number;
    }) => {
      if (!activeKey || !myStatus) return;
      const bs = myStatus.battleStatus;
      mpSetBattleStatus({
        serverKey: activeKey,
        ready: patch.ready ?? bs.ready,
        teamId: patch.teamId ?? bs.teamId,
        ally: patch.ally ?? bs.ally,
        mode: patch.mode ?? bs.mode,
        handicap: patch.handicap ?? bs.handicap,
        sync: patch.sync ?? bs.sync,
        side: patch.side ?? bs.side,
        // Prefer the echoed colour, but fall back to our intended colour while
        // the echo is in flight — never re-send 0 and clobber the just-assigned
        // colour back to black.
        color: patch.color ?? (myStatus.teamColor || intendedColorRef.current),
      }).then(clearErr, setErr);
    },
    [activeKey, myStatus, setErr, clearErr],
  );

  // Keep the server's view of OUR sync honest: report synced(1)/unsynced(2) based
  // on whether the map+game are installed locally, once that's known. The server
  // echoes the change back (→ snapshot), so this settles after one push.
  useEffect(() => {
    if (!activeKey || !myStatus || !contentKnown) return;
    const desired = mapMissing || gameMissing ? 2 : 1;
    if (myStatus.battleStatus.sync !== desired) pushStatus({ sync: desired });
  }, [activeKey, myStatus, contentKnown, mapMissing, gameMissing, pushStatus]);

  // Assign our team colour on join. The seat opens at teamColor 0 (the protocol's
  // "unset", rendered black) both when we join someone else's battle and when the
  // Rust self-host founder opens its own seat. In the lobby there is no such thing
  // as a deliberately-chosen black, so we always replace a 0 with a real colour:
  // our remembered colour when it's free, else a random one that avoids the
  // colours already in the battle. Once teamColor echoes back non-zero we treat it
  // (or a host force-recolour) as authoritative and just track it.
  const assignedBattleRef = useRef<number | null>(null);
  useEffect(() => {
    if (!activeKey || !battle || !myStatus) return;
    if (myStatus.teamColor !== 0) {
      // Authoritative echoed/forced colour — keep intendedColorRef in sync so the
      // pushStatus fill-in never reverts it.
      intendedColorRef.current = myStatus.teamColor;
      assignedBattleRef.current = battle.id;
      return;
    }
    if (assignedBattleRef.current === battle.id) return; // assign pushed; echo pending
    assignedBattleRef.current = battle.id;
    // Pick in hex space, then bridge to the lobby's 0xBBGGRR int (never play's
    // float RGB — the two colour spaces must not be crossed).
    const hex = pickTeamColorHex({
      remembered: savedColor,
      used: usedColorsFromBattle(battle, me),
    });
    intendedColorRef.current = hexToColorInt(hex);
    pushStatus({ color: intendedColorRef.current });
    // Persist only when there was no usable remembered colour; a per-battle
    // collision adjustment must not overwrite the user's remembered choice.
    if (!savedColor || isBlackHex(savedColor)) setSavedColor(hex);
  }, [activeKey, battle, myStatus, me, savedColor, setSavedColor, pushStatus]);

  const leave = useCallback(async () => {
    if (!activeKey) return;
    await mpLeaveBattle({ serverKey: activeKey }).then(clearErr, setErr);
  }, [activeKey, clearErr, setErr]);

  // Host map/lock edits. UPDATEBATTLEINFO carries map + lock + spectator count
  // together, so each helper resends the current values for the fields it isn't
  // touching. The server echoes the change back (→ snapshot + a system chat
  // notice), so the local view reconciles from the real state, not optimistically.
  const setMap = useCallback(
    (name: string, maphash: number) => {
      if (!activeKey || !battle) return;
      mpUpdateBattleInfo({
        serverKey: activeKey,
        spectators: battle.spectatorCount,
        locked: battle.locked,
        maphash,
        map: name,
      }).then(clearErr, setErr);
    },
    [activeKey, battle, clearErr, setErr],
  );

  const setLocked = useCallback(
    (locked: boolean) => {
      if (!activeKey || !battle) return;
      mpUpdateBattleInfo({
        serverKey: activeKey,
        spectators: battle.spectatorCount,
        locked,
        // The mirror keeps maphash as the raw (decimal) wire token; fold it back
        // into the signed 32-bit int the command expects.
        maphash: Number(battle.maphash) | 0,
        map: battle.map,
      }).then(clearErr, setErr);
    },
    [activeKey, battle, setErr, clearErr],
  );

  const setIngame = useCallback(
    (ingame: boolean) => {
      if (!activeKey) return;
      mpSetStatus({ serverKey: activeKey, ingame, away: false }).then(
        clearErr,
        setErr,
      );
    },
    [activeKey, clearErr, setErr],
  );

  // Host-only actions over other members. Gated by the UI (only rendered when
  // `selfHost`), but harmless otherwise — the server ignores force/kick from a
  // non-founder.
  const hostControls = useMemo(
    () => ({
      forceTeam: (user: string, team: number) => {
        if (activeKey)
          mpForceTeam({ serverKey: activeKey, username: user, team }).then(
            clearErr,
            setErr,
          );
      },
      forceAlly: (user: string, ally: number) => {
        if (activeKey)
          mpForceAlly({ serverKey: activeKey, username: user, ally }).then(
            clearErr,
            setErr,
          );
      },
      forceColor: (user: string, hex: string) => {
        if (activeKey)
          mpForceColor({
            serverKey: activeKey,
            username: user,
            color: hexToColorInt(hex),
          }).then(clearErr, setErr);
      },
      forceSpectator: (user: string) => {
        if (activeKey)
          mpForceSpectator({ serverKey: activeKey, username: user }).then(
            clearErr,
            setErr,
          );
      },
      kick: (user: string) => {
        if (activeKey)
          mpKick({ serverKey: activeKey, username: user }).then(
            clearErr,
            setErr,
          );
      },
      removeBot: (name: string) => {
        if (activeKey)
          mpRemoveBot({ serverKey: activeKey, name }).then(clearErr, setErr);
      },
    }),
    [activeKey, setErr, clearErr],
  );

  // Add a native AI bot on the first free team/ally, with a fresh colour and a name
  // unique within the battle. We're a player (mode) and marked synced.
  const addBot = useCallback(
    (aiShortName: string) => {
      if (!activeKey || !battle) return;
      const usedTeams = new Set<number>();
      const usedAllies = new Set<number>();
      const usedNames = new Set<string>();
      for (const [name, m] of Object.entries(battle.members)) {
        usedNames.add(name);
        if (m.battleStatus.mode) {
          usedTeams.add(m.battleStatus.teamId);
          usedAllies.add(m.battleStatus.ally);
        }
      }
      for (const [name, b] of Object.entries(battle.bots)) {
        usedNames.add(name);
        usedTeams.add(b.battleStatus.teamId);
        usedAllies.add(b.battleStatus.ally);
      }
      const firstFree = (used: Set<number>) => {
        let i = 0;
        while (used.has(i)) i++;
        return i;
      };
      const base = aiShortName.replace(/\s+/g, "") || "AI";
      let name = base;
      let n = 1;
      while (usedNames.has(name)) name = `${base}${n++}`;
      mpAddBot({
        serverKey: activeKey,
        name,
        ready: true,
        teamId: firstFree(usedTeams),
        ally: firstFree(usedAllies),
        mode: true,
        handicap: 0,
        sync: 1,
        side: 0,
        // Avoid colours already in the battle (no self to exclude for a bot). hex
        // core -> lobby 0xBBGGRR int only.
        color: hexToColorInt(
          pickTeamColorHex({ used: usedColorsFromBattle(battle, null) }),
        ),
        aiDll: aiShortName,
      }).then(clearErr, setErr);
    },
    [activeKey, battle, setErr, clearErr],
  );

  const autohostSend = useCallback(
    async (command: string) => {
      const trimmed = command.trim();
      if (!activeKey || !trimmed) return;
      // Was an un-caught await (a failed `!start`/`!map` became an unhandled
      // rejection in the caller). Report it and resolve instead.
      await mpSayBattle({ serverKey: activeKey, message: trimmed }).then(
        clearErr,
        setErr,
      );
    },
    [activeKey, clearErr, setErr],
  );

  // Route one option edit. Founder: set the script tag directly. Autohost battle:
  // send `!bSet <name> <value>`; the autohost validates + echoes SETSCRIPTTAGS.
  const sendOption = useCallback(
    (tagKey: string, spadsName: string, value: string) => {
      if (!activeKey) return;
      if (isFounder) {
        mpSetScriptTags({
          serverKey: activeKey,
          tags: { [tagKey]: value },
        }).then(clearErr, setErr);
      } else {
        autohostSend(`!bSet ${spadsName} ${value}`);
      }
    },
    [activeKey, isFounder, autohostSend, setErr, clearErr],
  );

  // Apply a whole set of option tags at once (loading a hosting preset). Founder:
  // batch-set the preset's tags and remove any option tags currently set that the
  // preset omits, so a load reflects exactly the saved options (same diff shape as
  // `setRestrictions`). Autohost battle: `!bSet` each value (removal isn't possible
  // there — an omitted option simply keeps its current value).
  const applyOptionTags = useCallback(
    (tags: Record<string, string>) => {
      if (!activeKey || !battle) return;
      if (isFounder) {
        if (Object.keys(tags).length > 0) {
          mpSetScriptTags({ serverKey: activeKey, tags }).then(
            clearErr,
            setErr,
          );
        }
        const current = battleOptionTags(battle.scriptTags);
        const wanted = new Set(Object.keys(tags).map((k) => k.toLowerCase()));
        const remove = Object.keys(current).filter(
          (k) => !wanted.has(k.toLowerCase()),
        );
        if (remove.length > 0) {
          mpRemoveScriptTags({ serverKey: activeKey, tags: remove }).then(
            clearErr,
            setErr,
          );
        }
      } else {
        for (const [k, v] of Object.entries(tags)) {
          const spadsName = k.slice(k.lastIndexOf("/") + 1);
          autohostSend(`!bSet ${spadsName} ${v}`);
        }
      }
    },
    [activeKey, battle, isFounder, autohostSend, clearErr, setErr],
  );

  // Apply a unit-restriction change (founder only). The engine-native
  // `game/restrict/*` tags are host-authoritative script tags we own directly, so
  // unlike mod options there's no autohost `!bSet` fork — only the actual founder
  // can set them. We diff the desired disabled set against the current restrict
  // tags: write added/changed keys and remove now-unused (reindexed) ones.
  const setRestrictions = useCallback(
    (disabled: string[]) => {
      if (!activeKey || !isFounder || !battle) return;
      const { set, remove } = diffRestrictTags(disabled, battle.scriptTags);
      if (Object.keys(set).length > 0) {
        mpSetScriptTags({ serverKey: activeKey, tags: set }).then(
          clearErr,
          setErr,
        );
      }
      if (remove.length > 0) {
        mpRemoveScriptTags({ serverKey: activeKey, tags: remove }).then(
          clearErr,
          setErr,
        );
      }
    },
    [activeKey, isFounder, battle, clearErr, setErr],
  );

  // Start-box edits follow the same founder/autohost fork as options. Founder
  // drives the rects over the protocol (ADDSTARTRECT/REMOVESTARTRECT); an autohost
  // battle goes through SPADS `!addbox`/`!clearbox`, whose teamNb is 1-based (so we
  // send `ally + 1`) and which requires startPosType 2 (gated by `canEditBoxes`).
  const setStartBox = useCallback(
    (
      ally: number,
      rect: { left: number; top: number; right: number; bottom: number },
    ) => {
      if (!activeKey) return;
      if (isFounder) {
        mpSetStartRect({ serverKey: activeKey, ally, ...rect }).then(
          clearErr,
          setErr,
        );
      } else {
        autohostSend(
          `!addbox ${rect.left} ${rect.top} ${rect.right} ${rect.bottom} ${ally + 1}`,
        );
      }
    },
    [activeKey, isFounder, autohostSend, clearErr, setErr],
  );

  const clearStartBox = useCallback(
    (ally: number) => {
      if (!activeKey) return;
      if (isFounder) {
        mpRemoveStartRect({ serverKey: activeKey, ally }).then(
          clearErr,
          setErr,
        );
      } else {
        autohostSend(`!clearbox ${ally + 1}`);
      }
    },
    [activeKey, isFounder, autohostSend, clearErr, setErr],
  );

  const rescan = useCallback(async () => {
    if (enginePath && dataDir && battle?.map) {
      invalidateMapPreview(enginePath, dataDir, battle.map);
    }
    await scan.run(true).then(clearErr, setErr);
    setContentNonce((n) => n + 1);
  }, [enginePath, dataDir, battle?.map, scan.run, setErr, clearErr]);

  return {
    battle,
    me,
    myStatus,
    isFounder,
    selfHost,
    target,
    targetLoading,
    enginePath,
    dataDir,
    maps,
    localMap,
    localGame,
    rows,
    sides,
    modOptionsSchema,
    mapOptionsSchema,
    canEditOptions,
    sendOption,
    applyOptionTags,
    canEditRestrictions: isFounder,
    setRestrictions,
    canEditBoxes: canEditOptions && startPosType === 2,
    setStartBox,
    clearStartBox,
    startPosType,
    mapMissing,
    gameMissing,
    contentKnown,
    sync,
    actionError,
    hostIngame,
    // Votes only exist in autohost battles; when we self-host there's no bot to run
    // them, so never surface a (stale) panel there.
    currentVote: selfHost ? null : (state?.currentVote ?? null),
    allReady,
    serverKey: activeKey,
    contentNonce,
    setReady: (ready) => pushStatus({ ready }),
    setSpectator: (spectator) => pushStatus({ mode: !spectator }),
    setSide: (side) => pushStatus({ side }),
    setTeam: (teamId) => pushStatus({ teamId }),
    setAlly: (ally) => pushStatus({ ally }),
    setColor: (hex) => {
      setSavedColor(hex);
      // Track the deliberate pick so a manual black survives the assign-on-join
      // effect and the pushStatus fill-in (a user-chosen black is real; a 0 default
      // isn't). hex -> lobby 0xBBGGRR int only.
      intendedColorRef.current = hexToColorInt(hex);
      pushStatus({ color: intendedColorRef.current });
    },
    setIngame,
    hostControls,
    addableAis,
    addBot,
    leave,
    autohostSend,
    startGame: () => autohostSend("!start"),
    suggestMap: (name) => autohostSend(`!map ${name}`),
    setMap,
    setLocked,
    rescan,
  };
}
