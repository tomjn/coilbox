import { useSetting } from "@picoframe/frame";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ConfigOption, GameItem, MapItem, Side } from "@/content/bindings";
import {
  invalidateMapPreview,
  useUnitsyncGameInfo,
  useUnitsyncMapInfo,
  useUnitsyncScan,
} from "@/content/config";
import {
  type PlayTarget,
  usePreferredTarget,
  useSkirmishAis,
} from "@/play/config";
import type { Battle, MemberStatus } from "../bindings";
import {
  mpAddBot,
  mpForceAlly,
  mpForceColor,
  mpForceSpectator,
  mpForceTeam,
  mpKick,
  mpLeaveBattle,
  mpRemoveBot,
  mpSayBattle,
  mpSetBattleStatus,
  mpSetScriptTags,
  mpSetStatus,
  mpUpdateBattleInfo,
} from "../bindings";
import { useMultiplayer } from "../store";
import { canEditBattleOptions } from "./battleOptions";
import {
  deriveSync,
  hexToColorInt,
  type MemberRow,
  membersToRows,
  randomTeamColorHex,
  type SyncState,
  startPosTypeOf,
} from "./config";

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
  startPosType: number;
  mapMissing: boolean;
  gameMissing: boolean;
  /** True once local content presence is known (scan settled). */
  contentKnown: boolean;
  sync: SyncState;
  /** Whether the battle host (autohost) is in-game — i.e. the match has started. */
  hostIngame: boolean;
  /** Whether every non-spectator human player has readied up. */
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
  /** Native engine AIs available to add as bots (host only). */
  nativeAis: { shortName: string; name?: string }[];
  /** Add a native AI bot on the next free team/ally (host only). */
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

  // Native engine AIs the host can add as bots (Lua AIs aren't addable over the
  // lobby — they attach to a team via the start script, not ADDBOT).
  const { ais } = useSkirmishAis(enginePath, dataDir, gameArchive);
  const nativeAis = useMemo(
    () => ais.filter((a) => a.kind === "native"),
    [ais],
  );

  const [contentNonce, setContentNonce] = useState(0);

  // Content presence is scan-authoritative (the scanned map/game lists), so a
  // forced rescan after a download flips it. Only "known" once the scan settles,
  // so we don't briefly report content missing (and flag ourselves unsynced)
  // while unitsync is still loading.
  const scanSettled = !scan.loading || games.length > 0 || maps.length > 0;
  const contentKnown = !!target && scanSettled;
  const mapMissing = contentKnown && !localMap;
  const gameMissing = contentKnown && !localGame;

  const rows = useMemo(
    () => (battle ? membersToRows(battle, me) : []),
    [battle, me],
  );
  const sync: SyncState = battle
    ? deriveSync(battle, { mapMissing, gameMissing })
    : "pending";

  // Match state + start gating. The match has "started" once the host (autohost)
  // goes in-game; `allReady` gates our Start button on every human player being
  // ready (the autohost still enforces its own rules).
  const hostIngame = !!battle && !!state?.users[battle.host]?.status.ingame;
  const humansPlaying = rows.filter((r) => r.kind === "human" && !r.spectator);
  const allReady =
    humansPlaying.length > 0 && humansPlaying.every((r) => r.ready);
  const startPosType = battle ? startPosTypeOf(battle) : 0;

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
        color: patch.color ?? myStatus.teamColor,
      }).catch(() => {});
    },
    [activeKey, myStatus],
  );

  // Keep the server's view of OUR sync honest: report synced(1)/unsynced(2) based
  // on whether the map+game are installed locally, once that's known. The server
  // echoes the change back (→ snapshot), so this settles after one push.
  useEffect(() => {
    if (!activeKey || !myStatus || !contentKnown) return;
    const desired = mapMissing || gameMissing ? 2 : 1;
    if (myStatus.battleStatus.sync !== desired) pushStatus({ sync: desired });
  }, [activeKey, myStatus, contentKnown, mapMissing, gameMissing, pushStatus]);

  // We join a battle showing as black (teamColor 0 is the protocol's "unset").
  // Announce our remembered colour instead — or, the first time, a fresh random
  // one we then persist — so we never sit in the lobby as black. Gated to run once
  // per join: teamColor 0 is indistinguishable from a deliberate black, so we
  // can't rely on the server echo flipping it to know we're done, or we'd re-push
  // forever if the user actually chose black.
  const coloredBattle = useRef<number | null>(null);
  useEffect(() => {
    if (!activeKey || !battle || !myStatus) return;
    if (coloredBattle.current === battle.id) return;
    coloredBattle.current = battle.id;
    if (myStatus.teamColor !== 0) return; // already coloured (rejoin/echo)
    let hex = savedColor;
    if (!hex) {
      hex = randomTeamColorHex();
      setSavedColor(hex);
    }
    pushStatus({ color: hexToColorInt(hex) });
  }, [activeKey, battle, myStatus, savedColor, setSavedColor, pushStatus]);

  const leave = useCallback(async () => {
    if (!activeKey) return;
    await mpLeaveBattle({ serverKey: activeKey }).catch(() => {});
  }, [activeKey]);

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
      }).catch(() => {});
    },
    [activeKey, battle],
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
      }).catch(() => {});
    },
    [activeKey, battle],
  );

  const setIngame = useCallback(
    (ingame: boolean) => {
      if (!activeKey) return;
      mpSetStatus({ serverKey: activeKey, ingame, away: false }).catch(
        () => {},
      );
    },
    [activeKey],
  );

  // Host-only actions over other members. Gated by the UI (only rendered when
  // `selfHost`), but harmless otherwise — the server ignores force/kick from a
  // non-founder.
  const hostControls = useMemo(
    () => ({
      forceTeam: (user: string, team: number) => {
        if (activeKey)
          mpForceTeam({ serverKey: activeKey, username: user, team }).catch(
            () => {},
          );
      },
      forceAlly: (user: string, ally: number) => {
        if (activeKey)
          mpForceAlly({ serverKey: activeKey, username: user, ally }).catch(
            () => {},
          );
      },
      forceColor: (user: string, hex: string) => {
        if (activeKey)
          mpForceColor({
            serverKey: activeKey,
            username: user,
            color: hexToColorInt(hex),
          }).catch(() => {});
      },
      forceSpectator: (user: string) => {
        if (activeKey)
          mpForceSpectator({ serverKey: activeKey, username: user }).catch(
            () => {},
          );
      },
      kick: (user: string) => {
        if (activeKey)
          mpKick({ serverKey: activeKey, username: user }).catch(() => {});
      },
      removeBot: (name: string) => {
        if (activeKey)
          mpRemoveBot({ serverKey: activeKey, name }).catch(() => {});
      },
    }),
    [activeKey],
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
        color: hexToColorInt(randomTeamColorHex()),
        aiDll: aiShortName,
      }).catch(() => {});
    },
    [activeKey, battle],
  );

  const autohostSend = useCallback(
    async (command: string) => {
      const trimmed = command.trim();
      if (!activeKey || !trimmed) return;
      await mpSayBattle({ serverKey: activeKey, message: trimmed });
    },
    [activeKey],
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
        }).catch(() => {});
      } else {
        autohostSend(`!bSet ${spadsName} ${value}`);
      }
    },
    [activeKey, isFounder, autohostSend],
  );

  const rescan = useCallback(async () => {
    if (enginePath && dataDir && battle?.map) {
      invalidateMapPreview(enginePath, dataDir, battle.map);
    }
    await scan.run(true).catch(() => {});
    setContentNonce((n) => n + 1);
  }, [enginePath, dataDir, battle?.map, scan.run]);

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
    startPosType,
    mapMissing,
    gameMissing,
    contentKnown,
    sync,
    hostIngame,
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
      pushStatus({ color: hexToColorInt(hex) });
    },
    setIngame,
    hostControls,
    nativeAis,
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
