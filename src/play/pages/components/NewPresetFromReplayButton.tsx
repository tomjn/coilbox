import { Button, Input } from "@picoframe/frame";
import { FilePlus2, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDemoInfo, useReplays } from "@/content/config";
import { demoInfoToSkirmishDraft } from "@/content/demoToSkirmish";
import { useRefightSetup } from "@/content/refight";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import { aiByline, type Participant, usePreferredTarget } from "../../config";
import type { SkirmishDraft } from "../../drafts";

/** Encode/decode an AI select value as `kind:shortName`. */
const aiValue = (a: { kind: string; shortName: string }) =>
  `${a.kind}:${a.shortName}`;

/**
 * "New preset from replay…" (#368): the presets-drawer half of the refight
 * pipeline — the same `demoInfoToSkirmishDraft` transform as `RefightPanel`
 * (replay detail), reached the other way round: pick a replay here rather
 * than starting from its detail page. Saves straight into the presets
 * library without touching the current Skirmish setup.
 */
export function NewPresetFromReplayButton({
  onSave,
  disabled,
}: {
  onSave: (name: string, draft: SkirmishDraft) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}>
          <FilePlus2 className="size-4" /> New from replay…
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex w-80 flex-col gap-3">
        {open && (
          <ReplayPickerForm
            onSaved={(name, draft) => {
              setOpen(false);
              onSave(name, draft);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function ReplayPickerForm({
  onSaved,
}: {
  onSaved: (name: string, draft: SkirmishDraft) => void;
}) {
  const { target } = usePreferredTarget();
  const { replays, loading: replaysLoading } = useReplays(target?.dataDir);
  const [replayPath, setReplayPath] = useState("");
  const { info, loading: infoLoading } = useDemoInfo(
    target?.enginePath,
    replayPath || undefined,
  );
  const {
    shortGameId,
    gameCandidates,
    selectedGameName,
    setSelectedGameName,
    missingGame,
    missingMap,
    sides,
    ais,
    scanLoading,
  } = useRefightSetup(info);
  const [aiKey, setAiKey] = useState("");
  const [name, setName] = useState("");

  const chosenAi = (): Participant["ai"] | undefined => {
    if (!aiKey) return undefined;
    const [kind, shortName] = aiKey.split(/:(.*)/s);
    const found = ais.find((a) => a.kind === kind && a.shortName === shortName);
    return found
      ? { kind: found.kind, shortName: found.shortName, name: found.name }
      : undefined;
  };

  const replayOptions = replays.map((r) => ({
    value: r.path,
    label: r.filename,
    description: [r.mapName, r.gameType].filter(Boolean).join(" · "),
  }));
  const aiOptions = ais.map((a) => ({
    value: aiValue(a),
    label: a.name ?? a.shortName,
    description: aiByline(a),
  }));
  const gameOptions = gameCandidates.map((g) => ({
    value: g.name,
    label: g.name,
    description: g.info?.version,
  }));

  const draft: SkirmishDraft | null = info
    ? demoInfoToSkirmishDraft({ info, ais, sides, ai: chosenAi() })
    : null;
  const ready = !!replayPath && !infoLoading && !scanLoading;
  const canSave = !!draft && !!name.trim() && !missingGame && !missingMap;

  const save = () => {
    if (canSave && draft) onSaved(name.trim(), draft);
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">New preset from replay</h3>
        <p className="text-xs text-muted-foreground">
          Every seated player becomes an AI opponent, keeping the map, factions,
          colours and options.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Replay</span>
        {replaysLoading ? (
          <p className="text-xs text-muted-foreground">Loading replays…</p>
        ) : replays.length === 0 ? (
          <p className="text-xs text-muted-foreground">No replays found.</p>
        ) : (
          <OptionSelect
            value={replayPath}
            onValueChange={setReplayPath}
            options={replayOptions}
            placeholder="Pick a replay"
            size="sm"
          />
        )}
      </div>

      {replayPath && (infoLoading || scanLoading) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" /> Reading replay…
        </div>
      )}

      {ready && (missingGame || missingMap) && (
        <p className="text-xs text-destructive">
          {missingGame ? "This replay's game isn't installed. " : ""}
          {missingMap ? "This replay's map isn't installed. " : ""}
          Install it first from the Replays screen.
          {missingGame &&
            shortGameId &&
            !shortGameId.exact &&
            " Its exact game couldn't be confirmed from the replay, so this is a name-only check."}
        </p>
      )}

      {ready && info && !missingGame && !missingMap && (
        <>
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
          {!draft ? (
            <p className="text-xs text-destructive">
              This replay has no seated players to refight.
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                }}
                placeholder="Preset name"
                className="h-8 flex-1"
              />
              <Button size="sm" disabled={!canSave} onClick={save}>
                Save
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
