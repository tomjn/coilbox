import { Button } from "@picoframe/frame";
import { open, save } from "@tauri-apps/plugin-dialog";
import { Bookmark, History, Play, Swords } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { summarizeSubstitutions } from "@/conquest/ai";
import {
  encodeContainerCode,
  encodeContainerJson,
} from "@/container/container";
import {
  useUnitsyncGameHeaders,
  useUnitsyncGameInfo,
  useUnitsyncMapMeta,
  useUnitsyncMinimap,
  useUnitsyncScan,
  useUnitsyncThumbnails,
} from "@/content/config";
import { mergeMapTiers } from "@/content/mapTiers";
import { ResolveContentGate } from "@/content/pages/components/ResolveContentDrawer";
import {
  exactGameRequirement,
  exactMapRequirement,
} from "@/content/resolveContent";
import { useFactionLogos } from "@/factions/logos";
import { withoutGeneratedGames } from "@/lib/generatedGames";
import { mostRecentOpen } from "@/lib/recency";
import { useMyTeamColor } from "@/lib/useMyTeamColor";
import { useMultiplayer } from "@/multiplayer/store";
import { notify } from "@/notify/notify";
import { contentListReplays } from "../../content/bindings";
import { useBrandingEntry } from "../../content/branding";
import { useReplayUserState } from "../../content/replayUserState";
import { buildImportCodeLink } from "../../deeplink/build";
import { copyDeepLink } from "../../deeplink/copyLink";
import { useImportParam } from "../../deeplink/useImportParam";
import { useOneShotParam } from "../../deeplink/useOneShotParam";
import { useRecordHubImport } from "../../hub/imports";
import { getProfile } from "../../profile/profile";
import type { BattleConfig } from "../bindings";
import { playExportPreset, playImportPreset } from "../bindings";
import {
  aiKey,
  applyRestrictions,
  defaultAi,
  effectiveTeams,
  initialParticipants,
  makeAiParticipant,
  type Participant,
  RANDOM_SIDE,
  resolveRandomSides,
  rgbToHex,
  sanitizeColors,
  setParticipantTeam,
  toBattleConfig,
  useLastAi,
  usePreferredTarget,
  useSkirmishAis,
} from "../config";
import { bumpAiHandicap } from "../debrief";
import {
  type BattleRestrictions,
  type SkirmishDraft,
  useSkirmishDraft,
} from "../drafts";
import { mergeGameAi } from "../gameAi";
import { effectiveOptions } from "../modOptions";
import { usePlay } from "../PlayProvider";
import {
  PRESET_KIND_VERSION,
  parsePresetJson,
  presetPayload,
  presetRoute,
  type SkirmishPreset,
  useSkirmishPresets,
} from "../presets";
import { reconcileParticipantAis } from "../reconcileAi";
import { useSkirmishDebrief } from "../useSkirmishDebrief";
import { DebriefDrawer } from "./components/DebriefDrawer";
import { GameOptionsPanel } from "./components/GameOptionsPanel";
import { GameSelectCard } from "./components/GameSelectCard";
import { MapCard } from "./components/MapCard";
import {
  MapLayerToggle,
  MapOverlayImage,
  useMapOverlayLayer,
} from "./components/MapOverlay";
import { ParticipantsTable } from "./components/ParticipantsTable";
import { PresetsDrawer } from "./components/PresetsDrawer";

/** A human summary of a loaded preset's faithful-replay restrictions, for the
 * banner that makes an otherwise-invisible disabled-unit/perk set visible. */
function restrictionSummary(r: BattleRestrictions): string {
  const parts: string[] = [];
  const units = r.disabledUnits?.length ?? 0;
  if (units > 0) parts.push(`${units} unit${units === 1 ? "" : "s"} disabled`);
  if (r.advantage) parts.push(`+${Math.round(r.advantage * 100)}% advantage`);
  if (r.incomeMultiplier)
    parts.push(`+${Math.round(r.incomeMultiplier * 100)}% income`);
  return parts.length > 0
    ? `Restricted battle — ${parts.join(" · ")}`
    : "Restricted battle";
}

/** Basic singleplayer (skirmish) launcher: pick a game, map and opponents, then
 * launch the engine. Uses the preferred engine silently (no picker). */
export default function SkirmishPage() {
  const navigate = useNavigate();
  const { target, loading: targetLoading } = usePreferredTarget();
  const enginePath = target?.enginePath;
  const dataDir = target?.dataDir;
  const { running, launch } = usePlay();
  const { setProvenance } = useReplayUserState();
  const {
    debrief,
    open: debriefOpen,
    checking: checkingResult,
    setOpen: setDebriefOpen,
    resolve: resolveDebrief,
    markUndetectable,
    reset: resetDebrief,
  } = useSkirmishDebrief();

  const scan = useUnitsyncScan(enginePath, dataDir);
  const { thumbs } = useUnitsyncThumbnails(enginePath, dataDir);
  const { meta } = useUnitsyncMapMeta(enginePath, dataDir);
  const { headers: gameHeaders } = useUnitsyncGameHeaders(enginePath, dataDir);

  // Seed from the persisted draft so the setup (game, map, opponents, options)
  // survives navigation and restarts. The debounced effect below writes it back.
  const [draft, setDraft] = useSkirmishDraft();
  const [participants, setParticipants] = useState<Participant[]>(() =>
    draft.participants.length > 0 ? draft.participants : initialParticipants(),
  );
  const [gameName, setGameName] = useState(() => draft.gameName);
  const [mapName, setMapName] = useState(() => draft.mapName);
  const [startPosType, setStartPosType] = useState(() => draft.startPosType);
  const [modOptionValues, setModOptionValues] = useState<
    Record<string, string>
  >(() => draft.modOptionValues);
  // Faithful-replay restrictions carried by a loaded conquest/warpath/MP preset
  // (disabled units + team-0 perks). Undefined for a hand-built skirmish. Held here
  // so `buildConfig` re-applies them on launch and the banner can show/clear them.
  const [restrictions, setRestrictions] = useState<
    BattleRestrictions | undefined
  >(() => draft.restrictions);
  const [error, setError] = useState<string | null>(null);
  // A one-line notice when applying a preset/draft into a game that doesn't
  // offer one of its AIs, so the remap to a valid default isn't silent (#501).
  const [aiNotice, setAiNotice] = useState<string | null>(null);

  const [presetsOpen, setPresetsOpen] = useState(false);
  const { presets, savePreset, touchPreset, removePreset } =
    useSkirmishPresets();

  // Whether Host is offered at all (issue #514): hosting needs a live multiplayer
  // login, so the button is hidden rather than shown disabled when logged out.
  // Under Tachyon the server allocates a dedicated autohost from its own pool and a
  // client cannot host at all, so the same button is hidden while connected to one
  // (see `docs/tachyon-protocol.md`).
  const { connected: mpConnected, protocol: mpProtocol } = useMultiplayer();
  // Logged out this stays true, so the preset drawer's "Host as battle" keeps
  // showing the way it does today. Only a live Tachyon connection removes it.
  const hostingPossible = mpProtocol !== "tachyon";

  // Header overflow fix (issue #514): the Continue affordance goes icon-only,
  // with its full "Continue: <preset name>" text moved into this popover so a
  // long preset name never widens the header.
  const [continueOpen, setContinueOpen] = useState(false);

  // The single most recently used preset (issue #374's "continue playing"
  // affordance): a compact header button, mirroring the login panel's
  // "Reconnect as ..." shortcut, that loads it back into the working setup.
  const mostRecentPreset = useMemo(
    () =>
      mostRecentOpen(
        presets,
        () => true,
        (p) => Date.parse(p.lastUsedAt),
      ),
    [presets],
  );

  // The team colour remembered across surfaces (shared with the MP lobby via the
  // same setting key). Empty = never picked.
  const [myColor, setMyColor] = useMyTeamColor();

  // One-shot heal on mount: a stale persisted draft (or older seeding) can leave
  // a participant — usually "you" — as black. Replace any black/invalid colour
  // with the remembered/non-black pick so the setup never opens showing black.
  const sanitized = useRef(false);
  useEffect(() => {
    if (sanitized.current) return;
    sanitized.current = true;
    setParticipants((ps) => sanitizeColors(ps, myColor));
  }, [myColor]);

  // Coilbox's own generated games are scanned like any other, but a skirmish in
  // one is never what a player meant, and the auto-pick below would otherwise
  // land on one on an install that has little else. One a draft already names
  // stays, so the draft is not silently moved off it.
  const games = useMemo(
    () => withoutGeneratedGames(scan.data?.games ?? [], gameName),
    [scan.data, gameName],
  );
  const maps = mergeMapTiers(scan.data?.maps ?? [], thumbs, meta);
  const selectedGame = games.find((g) => g.name === gameName) ?? null;
  // Fall back to the first map so a map is shown the instant maps load, without
  // waiting for the auto-pick effect below to commit `mapName`.
  const selectedMap = maps.find((m) => m.name === mapName) ?? maps[0] ?? null;
  const gameArchive = selectedGame?.primaryArchive.name;
  // The selected game's AI catalogue, for the AI picker's difficulty pips.
  const brandingAi = useBrandingEntry(selectedGame ?? undefined)?.ai;
  const aiConfig = mergeGameAi(getProfile().ai, brandingAi);
  // Still scanning and nothing to show yet — the map card shows a spinner.
  const mapsLoading = scan.loading && maps.length === 0;
  const gamesLoading = scan.loading && games.length === 0;

  const gameInfo = useUnitsyncGameInfo(enginePath, dataDir, gameArchive);
  const { ais, loaded: aisLoaded } = useSkirmishAis(
    enginePath,
    dataDir,
    gameArchive,
  );
  // Whether `ais` is the selected game's own settled list. A query with no game
  // yet (the scan still loading) returns the engine's natives, which lack the
  // game's Lua AIs, so both the fill and reconcile passes below wait for this.
  // Mirrors `addableAisReady` in `useBattleRoom` (#531).
  const aisReady = !!gameArchive && aisLoaded;
  const [lastAi, setLastAi] = useLastAi();
  const minimap = useUnitsyncMinimap(enginePath, dataDir, selectedMap?.name);
  const overlay = useMapOverlayLayer(enginePath, dataDir, selectedMap?.name);
  // Overlays only make sense once a map is selected and its minimap resolves.
  const canOverlay = !!selectedMap && !!minimap.url;
  const sides = gameInfo.info?.sides ?? [];
  const factionLogos = useFactionLogos({
    game: selectedGame ?? undefined,
    enginePath,
    dataDir,
    gameArchive,
    sideNames: sides.map((s) => s.name),
  });
  const modOptions = gameInfo.info?.options ?? [];

  // Default the game/map selections to the first available once a scan lands.
  useEffect(() => {
    if (games.length > 0)
      setGameName((cur) =>
        games.some((g) => g.name === cur) ? cur : games[0].name,
      );
  }, [games]);
  useEffect(() => {
    if (maps.length > 0)
      setMapName((cur) =>
        maps.some((m) => m.name === cur) ? cur : maps[0].name,
      );
  }, [maps]);

  // Mod options are per-game; reset entered values when the user switches game.
  // Guard against the initial undefined -> defined transition as the scan lands,
  // which is hydration (game restored from the draft), not a real switch — that
  // would otherwise wipe the mod options we just restored.
  const prevArchive = useRef(gameArchive);
  useEffect(() => {
    const prev = prevArchive.current;
    prevArchive.current = gameArchive;
    if (prev !== undefined && gameArchive !== undefined && prev !== gameArchive)
      setModOptionValues({});
  }, [gameArchive]);

  // Normalise participant factions to a valid side once the game's sides load.
  useEffect(() => {
    if (sides.length === 0) return;
    const valid = new Set(sides.map((s) => s.name));
    setParticipants((ps) => {
      let changed = false;
      const next = ps.map((p) => {
        // Keep the Random sentinel — it resolves to a real side at launch.
        if (p.side === RANDOM_SIDE) return p;
        if (!valid.has(p.side)) {
          changed = true;
          return { ...p, side: sides[0].name };
        }
        return p;
      });
      return changed ? next : ps;
    });
  }, [sides]);

  // Auto-select the last AI the user picked for any still-empty AI slot (the
  // default opponent, or one added before the AI list had loaded). Restored
  // participants already carry their `ai`, so this only fills genuine blanks.
  // Waits for the game's own list: filling from the natives fallback writes an
  // AI the game may not offer, which the pass below then flags as a
  // substitution the user never made.
  useEffect(() => {
    if (!aisReady) return;
    const preset = defaultAi(lastAi, ais);
    if (!preset) return;
    setParticipants((ps) => {
      let changed = false;
      const next = ps.map((p) => {
        if (p.kind === "ai" && !p.ai) {
          changed = true;
          return { ...p, ai: preset };
        }
        return p;
      });
      return changed ? next : ps;
    });
  }, [lastAi, ais, aisReady]);

  // Reconcile every AI slot against the selected game's actual AI list (#501).
  // Presets and drafts are reused across games and versions, so switching the
  // game (or loading a preset for a different one) can leave a slot pointing at
  // an AI this game doesn't offer, which showed as a blank dropdown. Runs when
  // the AI list changes. Reads the current participants via a ref so an edit
  // doesn't re-trigger it. Remaps present-but-unavailable AIs to a valid default
  // and surfaces the swap, leaving genuine blanks to the fill pass above.
  //
  // Gated on `aisReady`: running while the game is still loading reconciled
  // against the engine's natives, swapping a valid Lua pick out and back again
  // once the real list landed, so the notice returned on every visit and no
  // pick ever stuck. While not ready the notice is left alone rather than
  // cleared, so a game switch doesn't blank it mid-flight.
  const participantsRef = useRef(participants);
  participantsRef.current = participants;
  useEffect(() => {
    if (!aisReady || ais.length === 0) return;
    const res = reconcileParticipantAis(participantsRef.current, ais, aisReady);
    if (res.changed) setParticipants(res.participants);
    // Clear a stale notice too, so switching to a game that offers every AI
    // doesn't leave the previous game's substitution message on screen.
    setAiNotice(summarizeSubstitutions(res.substitutions) ?? null);
  }, [ais, aisReady]);

  // Persist the working draft (debounced — one write after edits settle, not per
  // keystroke). Transient run state (running/error) is intentionally excluded.
  //
  // The write stamps `touchedAt` so the welcome screen's Continue zone can rank
  // the setup you were actually building against a Warpath run or a campaign
  // mission (#1011). Without it the collector could only offer whichever preset
  // you last loaded, which is a different setup from the one on screen.
  useEffect(() => {
    const id = setTimeout(() => {
      setDraft({
        participants,
        gameName,
        mapName,
        startPosType,
        modOptionValues,
        restrictions,
        touchedAt: Date.now(),
      });
    }, 400);
    return () => clearTimeout(id);
  }, [
    participants,
    gameName,
    mapName,
    startPosType,
    modOptionValues,
    restrictions,
    setDraft,
  ]);

  // Minimap marker colours in *team* order (leader colour per team), so under
  // fixed start positions marker N shows who actually spawns at position N.
  const activeColors = useMemo(() => {
    const byId = new Map(participants.map((p) => [p.id, p]));
    const { leaderIdByTeam } = effectiveTeams(participants);
    return leaderIdByTeam.flatMap((id) => {
      const p = byId.get(id);
      return p ? rgbToHex(p.color) : [];
    });
  }, [participants]);

  const you = participants.find((p) => p.kind === "you");
  const activeCount = participants.filter(
    (p) => !(p.kind === "you" && p.spectator),
  ).length;
  const aiRowsReady = participants
    .filter((p) => p.kind === "ai")
    .every((p) => !!p.ai);
  const canStart =
    !!target &&
    !!selectedGame &&
    !!selectedMap &&
    activeCount >= 2 &&
    aiRowsReady &&
    !running;

  const updateParticipant = (id: string, patch: Partial<Participant>) => {
    // Remember an explicit AI pick so later opponents default to it.
    if (patch.ai) setLastAi(aiKey(patch.ai));
    // Mirror MP's setColor: when "you" recolours, remember it so the colour stays
    // in sync across both surfaces. patch.color is play float RGB -> hex core.
    if (patch.color && participants.find((p) => p.id === id)?.kind === "you")
      setMyColor(rgbToHex(patch.color));
    setParticipants((ps) =>
      ps.map((p) => (p.id === id ? { ...p, ...patch } : p)),
    );
  };
  const removeParticipant = (id: string) =>
    setParticipants((ps) => ps.filter((p) => p.id !== id));
  // Added before the game's AI list settles, the slot is left blank for the fill
  // pass rather than seeded from the engine's natives.
  const addAi = () =>
    setParticipants((ps) => [
      ...ps,
      makeAiParticipant(
        ps,
        RANDOM_SIDE,
        aisReady ? defaultAi(lastAi, ais) : undefined,
      ),
    ]);

  // Derive the engine `BattleConfig` from the current setup, or null if a game
  // or map isn't selected yet. Shared by launch and export so they never drift.
  // `parts` defaults to the live participants so callers only need to pass an
  // override when launching a tweaked roster (see "Rematch with a tweak"),
  // where a freshly-computed array must be used instead of stale state.
  function buildConfig(
    parts: Participant[] = participants,
  ): BattleConfig | null {
    if (!selectedGame || !selectedMap) return null;
    // Roll each Random-faction bot to a concrete side here, at the impure launch
    // boundary, so the start script gets a real side and each Random AI rolls
    // independently. The participant model stays free of randomness (issue #332).
    const resolved = resolveRandomSides(parts, sides);
    // Disabled units render into `[RESTRICT]` via `toBattleConfig`; the team-0
    // perk levers are re-applied afterwards. Both no-op for a hand-built setup.
    return applyRestrictions(
      toBattleConfig({
        participants: resolved,
        mapName: selectedMap.name,
        gameType: selectedGame.name,
        startPosType,
        modOptions: effectiveOptions(modOptions, modOptionValues),
        disabledUnits: restrictions?.disabledUnits,
      }),
      restrictions,
    );
  }

  // The current setup as a launchable/saveable `SkirmishDraft` — shared by
  // "Save current setup", the debrief's "Save as preset", and (implicitly)
  // the persisted draft effect above.
  const currentDraft = (): SkirmishDraft => ({
    participants,
    gameName,
    mapName,
    startPosType,
    modOptionValues,
    restrictions,
  });

  // "Host as battle" (issue #373): take a skirmish draft (the current setup, or
  // a saved preset from the drawer) online. A draft's game or map might not be
  // installed locally at all (a preset saved on another machine, or an old one
  // whose content moved). `HostBattlePopover` only ever offers installed
  // games/maps, so hosting one that isn't would silently open a battle for a
  // different game. Gate on the resolve-content flow (#387) first. Only once
  // both are confirmed installed does this navigate to the Battles hub with
  // the draft to seed (`BattlesPage`/`BattleRoomPage` carry it the rest of the
  // way). Not connected yet, or not logged in? `/battles` itself already
  // prompts to connect (same as the content map detail's "Host a battle here"),
  // so nothing extra is needed here.
  const [pendingHost, setPendingHost] = useState<{
    draft: SkirmishDraft;
    title: string;
  } | null>(null);

  function hostAsBattle(draft: SkirmishDraft, title: string) {
    const installed =
      games.some((g) => g.name === draft.gameName) &&
      maps.some((m) => m.name === draft.mapName);
    if (installed) {
      navigate("/battles", { state: { hostDraft: draft, hostTitle: title } });
      return;
    }
    setPendingHost({ draft, title });
  }

  async function onStart(parts: Participant[] = participants) {
    if (!target) return;
    const config = buildConfig(parts);
    if (!config) return;
    setError(null);
    resetDebrief();
    // Snapshot the replays that exist before the engine runs, so any new file
    // afterwards can be tagged as a skirmish (and, on exit, decoded for the
    // debrief's outcome/duration — see `useSkirmishDebrief`). Best-effort: a
    // failure here just disables tagging/detection, never the launch itself.
    let beforePaths: Set<string> | null = null;
    try {
      const { replays } = await contentListReplays({ root: target.dataDir });
      beforePaths = new Set(replays.map((r) => r.path));
    } catch {
      beforePaths = null;
    }
    try {
      const res = await launch("skirmish", {
        config,
        executable: target.executable,
        dataDir: target.dataDir,
      });
      if (res.exitCode && res.exitCode !== 0) {
        setError(`Engine exited with code ${res.exitCode}.`);
      }
      // Cancelled before the game started: nothing to debrief.
      if (res.exitCode === null) return;
      if (!beforePaths) {
        markUndetectable();
        return;
      }
      await resolveDebrief({
        target,
        beforePaths,
        playerName: config.myPlayerName,
        setProvenance,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const onRematch = () => {
    onStart();
  };

  // "Rematch with a tweak" (#370, keeping #354's richer per-AI control
  // separate): nudge every AI's handicap by a fixed delta, persist it onto the
  // visible setup, and relaunch. The tweaked array is threaded through
  // explicitly rather than read back from `participants` — `setParticipants`
  // hasn't committed by the time `onStart` would otherwise read it.
  const onRematchWithTweak = (deltaPercent: number) => {
    const tweaked = bumpAiHandicap(participants, deltaPercent);
    setParticipants(tweaked);
    onStart(tweaked);
  };

  const saveCurrentPreset = (name: string): SkirmishPreset =>
    savePreset(name, currentDraft());

  // "New preset from replay…" (#368): save straight into the presets library,
  // leaving the current setup on the page untouched.
  const saveFromReplay = (name: string, draft: SkirmishDraft) => {
    savePreset(name, draft);
    notify({
      title: "Saved to Singleplayer presets",
      body: `"${name}" — replay it from Singleplayer → Presets.`,
      level: "success",
    });
  };

  const loadPreset = (p: SkirmishPreset) => {
    // The mod-option reset effect wipes values whenever the game archive changes
    // to a different defined value. Pre-seed `prevArchive` to the incoming game's
    // archive so restoring a preset for a different game doesn't discard the
    // preset's own mod options (mirrors the initial draft-hydration escape).
    prevArchive.current = games.find(
      (g) => g.name === p.gameName,
    )?.primaryArchive.name;
    setParticipants(p.participants);
    setGameName(p.gameName);
    setMapName(p.mapName);
    setStartPosType(p.startPosType);
    setModOptionValues(p.modOptionValues);
    setRestrictions(p.restrictions);
    touchPreset(p.id);
  };

  // Share a preset: serialize it and write to a file the user picks. The write
  // goes through the plugin (no frontend fs plugin), mirroring the start-script
  // export above.
  async function onExportPreset(preset: SkirmishPreset) {
    setError(null);
    try {
      const dest = await save({
        title: "Export preset",
        defaultPath: `${preset.name || "preset"}.json`,
        filters: [{ name: "Coilbox preset", extensions: ["json"] }],
      });
      if (!dest) return;
      await playExportPreset({
        json: encodeContainerJson(
          "preset",
          PRESET_KIND_VERSION,
          presetPayload(preset, games),
        ),
        dest,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // Copy a preset as a coilbox://import?code= link (issue #498), an addition
  // alongside the file-export share action above, not a replacement for it.
  function onCopyPresetLink(preset: SkirmishPreset) {
    const code = encodeContainerCode(
      "preset",
      PRESET_KIND_VERSION,
      presetPayload(preset, games),
    );
    void copyDeepLink(buildImportCodeLink(code));
  }

  // Import a shared preset file: read it, validate the shape, then, once its
  // game and map are confirmed installed (or downloaded, #387) — add it as a
  // new preset (fresh id/timestamps via savePreset) without touching the
  // current setup.
  const [pendingPreset, setPendingPreset] = useState<
    (SkirmishDraft & { name?: string }) | null
  >(null);

  async function onImportPreset() {
    setError(null);
    try {
      const src = await open({
        title: "Import preset",
        multiple: false,
        filters: [{ name: "Coilbox preset", extensions: ["json"] }],
      });
      if (typeof src !== "string") return;
      const { json } = await playImportPreset({ src });
      const parsed = parsePresetJson(json);
      if (!parsed) {
        setError("That file isn't a valid coilbox preset.");
        return;
      }
      setPendingPreset(parsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  // A confirmed `coilbox://import` deep link (issue #388) lands here with a
  // preset code in the query string. Decode it with the same validator as a file
  // import, then hand off to the content-resolution gate below.
  const { code: presetImportCode, hubItemId } = useImportParam();
  const recordHubImport = useRecordHubImport();
  useEffect(() => {
    if (!presetImportCode) return;
    const parsed = parsePresetJson(presetImportCode);
    if (!parsed) {
      setError("That link isn't a valid coilbox preset.");
      return;
    }
    setPendingPreset(parsed);
  }, [presetImportCode]);

  // Opening one saved preset by address (issue #1372, `presetRoute`). Loads it
  // into the setup, which is what the drawer's own Load does, so arriving by
  // link and picking the row end in the same place.
  //
  // Waits for the content scan, because the defaulting passes above move the
  // game and map to the first installed one as it lands, and would drag the
  // preset's picks along with them. A preset the link names but this install no
  // longer has is said out loud rather than leaving the page looking untouched.
  const openPresetId = useOneShotParam("preset");
  const openedPreset = useRef<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `loadPreset` is rebuilt every render, and the ref guard is what keeps this to one run
  useEffect(() => {
    if (!openPresetId || scan.loading) return;
    if (openedPreset.current === openPresetId) return;
    openedPreset.current = openPresetId;
    const preset = presets.find((p) => p.id === openPresetId);
    if (!preset) {
      toast.warning(
        "That preset isn't here any more. It may have been deleted.",
      );
      return;
    }
    loadPreset(preset);
    toast.success(`Loaded the preset "${preset.name}".`);
  }, [openPresetId, scan.loading, presets]);

  return (
    <div className="flex flex-col gap-5 p-4">
      <TooltipProvider>
        <header className="flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold">Singleplayer</h1>
          <div className="flex items-center gap-4">
            {you && (
              <label
                htmlFor="spectate-you"
                className="inline-flex cursor-pointer items-center gap-2 text-sm text-muted-foreground"
              >
                <Switch
                  id="spectate-you"
                  checked={you.spectator}
                  disabled={running}
                  onCheckedChange={(v) =>
                    updateParticipant(you.id, { spectator: v === true })
                  }
                />
                Spectate
              </label>
            )}
            {mostRecentPreset && (
              <Popover open={continueOpen} onOpenChange={setContinueOpen}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label={`Continue: ${mostRecentPreset.name}`}
                        disabled={running}
                      >
                        <History className="size-4" />
                      </Button>
                    </PopoverTrigger>
                  </TooltipTrigger>
                  <TooltipContent>
                    Continue: {mostRecentPreset.name}
                  </TooltipContent>
                </Tooltip>
                <PopoverContent align="end" className="w-64 p-1">
                  <button
                    type="button"
                    onClick={() => {
                      loadPreset(mostRecentPreset);
                      setContinueOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <History className="size-4 shrink-0" />
                    <span className="truncate">
                      Continue: {mostRecentPreset.name}
                    </span>
                  </button>
                </PopoverContent>
              </Popover>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Presets"
                  onClick={() => setPresetsOpen(true)}
                  disabled={running}
                >
                  <Bookmark className="size-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Presets</TooltipContent>
            </Tooltip>
            {mpConnected && hostingPossible && (
              <Button
                variant="outline"
                onClick={() =>
                  hostAsBattle(
                    currentDraft(),
                    `${gameName || "Skirmish"} (hosted)`,
                  )
                }
                disabled={running || !selectedGame || !selectedMap}
              >
                <Swords className="size-4" /> Host
              </Button>
            )}
            <Button onClick={() => onStart()} disabled={!canStart}>
              <Play className="size-4 fill-current" />{" "}
              {running ? "Game running…" : "Start Game"}
            </Button>
          </div>
        </header>
      </TooltipProvider>

      <PresetsDrawer
        open={presetsOpen}
        onOpenChange={setPresetsOpen}
        presets={presets}
        thumbs={thumbs}
        onLoad={loadPreset}
        onSave={saveCurrentPreset}
        onDelete={removePreset}
        onExportPreset={onExportPreset}
        onCopyPresetLink={onCopyPresetLink}
        onImport={onImportPreset}
        onSaveFromReplay={saveFromReplay}
        onHostAsBattle={
          hostingPossible ? (p) => hostAsBattle(p, p.name) : undefined
        }
        disabled={running}
      />

      {pendingPreset && (
        <ResolveContentGate
          title="Set up this preset"
          requirements={[
            exactGameRequirement(pendingPreset.gameName),
            exactMapRequirement(pendingPreset.mapName),
          ]}
          target={target ?? undefined}
          targetLoading={targetLoading}
          onContinue={() => {
            const saved = savePreset(
              pendingPreset.name?.trim() || "Imported preset",
              pendingPreset,
            );
            recordHubImport(hubItemId, [saved.id], presetRoute(saved.id));
            setPendingPreset(null);
          }}
          onCancel={() => setPendingPreset(null)}
        />
      )}

      {pendingHost && (
        <ResolveContentGate
          title="Set up this battle for hosting"
          requirements={[
            exactGameRequirement(pendingHost.draft.gameName),
            exactMapRequirement(pendingHost.draft.mapName),
          ]}
          target={target ?? undefined}
          targetLoading={targetLoading}
          onContinue={() => {
            navigate("/battles", {
              state: {
                hostDraft: pendingHost.draft,
                hostTitle: pendingHost.title,
              },
            });
            setPendingHost(null);
          }}
          onCancel={() => setPendingHost(null)}
        />
      )}

      <DebriefDrawer
        open={debriefOpen}
        onOpenChange={setDebriefOpen}
        debrief={debrief}
        onRematch={onRematch}
        onRematchWithTweak={onRematchWithTweak}
        getDraft={currentDraft}
        defaultPresetName={
          selectedMap ? `Rematch: ${selectedMap.name}` : "Rematch"
        }
        disabled={!canStart}
      />

      {!target && !scan.loading && (
        <p className="rounded-md border border-border/50 bg-card p-3 text-sm text-muted-foreground">
          No engine found. Add a content folder with an engine in{" "}
          <Link
            className="font-medium underline underline-offset-4"
            to="/settings/content-folders"
          >
            Settings → Content Folders
          </Link>{" "}
          first.
        </p>
      )}

      {error && (
        <Alert variant="destructive" className="p-3">
          <AlertDescription className="text-destructive">
            {error}
          </AlertDescription>
        </Alert>
      )}

      {running && (
        <p className="rounded-md border border-border/50 bg-card p-3 text-sm text-muted-foreground">
          Game running — settings are frozen until the engine exits.
        </p>
      )}

      {checkingResult && (
        <p className="rounded-md border border-border/50 bg-card p-3 text-sm text-muted-foreground">
          Checking match result…
        </p>
      )}

      <div className="grid grid-cols-1 items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,14rem)] lg:grid-cols-[minmax(0,1fr)_minmax(0,17rem)] xl:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <div className="flex flex-col gap-5">
          {aiNotice && (
            <Alert className="p-3">
              <AlertDescription className="flex items-center justify-between gap-3 text-sm">
                <span>{aiNotice}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAiNotice(null)}
                >
                  Dismiss
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {restrictions && (
            <Alert className="p-3">
              <AlertDescription className="flex items-center justify-between gap-3 text-sm">
                <span>{restrictionSummary(restrictions)}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={running}
                  onClick={() => setRestrictions(undefined)}
                >
                  Clear
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <ParticipantsTable
            participants={participants}
            sides={sides}
            factionLogos={factionLogos}
            ais={ais}
            aiConfig={aiConfig}
            disabled={running}
            startPosType={startPosType}
            startPosCount={minimap.startPositions?.length}
            onUpdate={updateParticipant}
            onSetTeam={(id, team) =>
              setParticipants((ps) => setParticipantTeam(ps, id, team))
            }
            onRemove={removeParticipant}
            onAddAi={addAi}
          />
          <GameOptionsPanel
            selectedGame={selectedGame}
            startPosType={startPosType}
            onStartPosType={setStartPosType}
            options={modOptions}
            optionValues={modOptionValues}
            onOptionChange={(key, value) =>
              setModOptionValues((m) => ({ ...m, [key]: value }))
            }
            disabled={running}
          />
        </div>

        <div className="flex flex-col gap-5">
          <MapCard
            map={selectedMap}
            maps={maps}
            thumbs={thumbs}
            minimapUrl={minimap.url}
            startPositions={minimap.startPositions}
            minimapLoading={minimap.loading}
            markerColors={activeColors}
            env={minimap.env}
            mapsLoading={mapsLoading}
            onSelectMap={setMapName}
            disabled={running}
            dimBase={!!overlay.overlayUrl}
            overlay={
              overlay.overlayUrl ? (
                <MapOverlayImage src={overlay.overlayUrl} />
              ) : undefined
            }
          />
          {canOverlay && (
            <MapLayerToggle layer={overlay.layer} onChange={overlay.setLayer} />
          )}
          <GameSelectCard
            game={selectedGame}
            games={games}
            headers={gameHeaders}
            gamesLoading={gamesLoading}
            onSelectGame={setGameName}
            disabled={running}
          />
        </div>
      </div>
    </div>
  );
}
