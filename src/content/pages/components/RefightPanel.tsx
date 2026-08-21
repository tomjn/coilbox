import { Button } from "@picoframe/frame";
import { Loader2, Play, Swords } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  aiByline,
  gameOptionSchema,
  type Participant,
  resolveRandomSides,
  toBattleConfig,
} from "@/play/config";
import type { SkirmishDraft } from "@/play/drafts";
import { usePlay } from "@/play/PlayProvider";
import { SaveAsPresetButton } from "@/play/pages/components/SaveAsPresetButton";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import { tagFreshReplay } from "../../../play/tagReplayProvenance";
import type { DemoInfo } from "../../bindings";
import { contentListReplays } from "../../bindings";
import { demoInfoToSkirmishDraft } from "../../demoToSkirmish";
import { useRefightSetup } from "../../refight";
import { useReplayUserState } from "../../replayUserState";

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Encode/decode an AI select value as `kind:shortName`. */
const aiValue = (a: { kind: string; shortName: string }) =>
  `${a.kind}:${a.shortName}`;

/**
 * "Refight this setup" (#368): converts a decoded replay into a launchable
 * `SkirmishDraft` (every seated player becomes an AI opponent, see
 * `demoInfoToSkirmishDraft`) and offers "Refight now" (launch it immediately)
 * or "Save as preset" (via the shared `SaveAsPresetButton`). Disabled with a
 * reason when the replay's game/map isn't installed locally — a refight must
 * not silently launch a broken draft.
 */
export function RefightPanel({
  info,
  filename,
}: {
  info: DemoInfo;
  filename: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-1.5">
          <Swords className="size-4" /> Refight this setup
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        {open && (
          <RefightForm
            info={info}
            filename={filename}
            onLaunched={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function RefightForm({
  info,
  filename,
  onLaunched,
}: {
  info: DemoInfo;
  filename: string;
  onLaunched: () => void;
}) {
  const {
    target,
    scanLoading,
    shortGameId,
    gameCandidates,
    selectedGameName,
    setSelectedGameName,
    installedGame,
    missingGame,
    missingMap,
    sides,
    options,
    optionsLoading,
    ais,
  } = useRefightSetup(info);
  const { running, launch } = usePlay();
  const { setProvenance } = useReplayUserState();
  const [aiKey, setAiKey] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosenAi = useMemo(() => {
    if (!aiKey) return undefined;
    const [kind, shortName] = aiKey.split(/:(.*)/s);
    const found = ais.find((a) => a.kind === kind && a.shortName === shortName);
    return found
      ? ({
          kind: found.kind,
          shortName: found.shortName,
          name: found.name,
        } as Participant["ai"])
      : undefined;
  }, [aiKey, ais]);

  const getDraft = (): SkirmishDraft | null =>
    demoInfoToSkirmishDraft({ info, ais, sides, options, ai: chosenAi });

  if (scanLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Checking installed content…
      </div>
    );
  }

  if (missingGame || missingMap) {
    return (
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Refight this setup</h3>
        <p className="text-xs text-muted-foreground">
          {missingGame && missingMap
            ? "This replay's game and map aren't installed."
            : missingGame
              ? "This replay's game isn't installed."
              : "This replay's map isn't installed."}{" "}
          Download {missingGame && missingMap ? "them" : "it"} below first.
          {missingGame &&
            shortGameId &&
            !shortGameId.exact &&
            " Its exact game couldn't be confirmed from the replay, so this is a name-only check."}
        </p>
      </div>
    );
  }

  const gameOptions = gameCandidates.map((g) => ({
    value: g.name,
    label: g.name,
    description: g.info?.version,
  }));

  const nativeAis = ais.filter((a) => a.kind === "native");
  const luaAis = ais.filter((a) => a.kind === "lua");
  const aiOptions = [...nativeAis, ...luaAis].map((a) => ({
    value: aiValue(a),
    label: a.name ?? a.shortName,
    description: aiByline(a),
  }));

  async function refightNow() {
    if (!target) return;
    const draft = getDraft();
    if (!draft) {
      setError("This replay has no seated players to refight.");
      return;
    }
    setPending(true);
    setError(null);
    let beforePaths: Set<string> | null = null;
    try {
      const { replays } = await contentListReplays({ root: target.dataDir });
      beforePaths = new Set(replays.map((r) => r.path));
    } catch {
      beforePaths = null;
    }
    try {
      const resolved = resolveRandomSides(draft.participants, sides);
      const config = toBattleConfig({
        participants: resolved,
        mapName: draft.mapName,
        gameType: draft.gameName,
        startPosType: draft.startPosType,
        modOptions: draft.modOptionValues,
        // The replay's own options win. This only supplies the target game's
        // defaults for anything the replay did not record.
        optionSchema: await gameOptionSchema(
          target,
          installedGame?.primaryArchive.name,
        ),
      });
      const res = await launch("skirmish", {
        config,
        executable: target.executable,
        dataDir: target.dataDir,
      });
      if (res.exitCode && res.exitCode !== 0) {
        setError(`Engine exited with code ${res.exitCode}.`);
      }
      if (beforePaths && res.exitCode !== null) {
        tagFreshReplay(
          target.dataDir,
          beforePaths,
          { mode: "refight", sourceReplayFilename: filename },
          setProvenance,
        );
      }
      onLaunched();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Refight this setup</h3>
        <p className="text-xs text-muted-foreground">
          Every seated player from this replay becomes an AI opponent, keeping
          the map, factions, colours and options. "You" starts as a spectator —
          take a seat from the Skirmish page if you want to play.
        </p>
      </div>

      {gameCandidates.length > 1 && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium">Game version</span>
          <OptionSelect
            value={selectedGameName}
            onValueChange={setSelectedGameName}
            options={gameOptions}
            size="sm"
          />
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">AI to fill every player</span>
        {ais.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No AIs found for this game.
          </p>
        ) : (
          <OptionSelect
            value={aiKey}
            onValueChange={setAiKey}
            options={aiOptions}
            placeholder="Default AI"
            size="sm"
          />
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={refightNow}
          disabled={pending || running || !target}
          className="flex-1 gap-1.5"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Play className="size-4 fill-current" />
          )}
          {pending ? "Launching…" : "Refight now"}
        </Button>
        <SaveAsPresetButton
          getDraft={getDraft}
          defaultName={`Refight: ${info.mapName}`}
          // A preset stores only what the match changed, which needs the game's
          // option list to compare against. Refighting now does not, because it
          // sends the match's values whatever they are.
          disabled={pending || optionsLoading}
          variant="outline"
        />
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}
