import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { FilePlus2, Loader2 } from "lucide-react";
import { useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useDemoInfo, useReplays } from "@/content/config";
import { demoInfoToSkirmishDraft } from "@/content/demoToSkirmish";
import { ScanFailed } from "@/content/pages/components/states";
import { useRefightSetup } from "@/content/refight";
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
          <FilePlus2 className="size-4" /> <Trans>Create from replay</Trans>
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
  const { t } = useLingui();
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
    scanFailure,
    missingGame,
    missingMap,
    sides,
    options,
    optionsLoading,
    mapOptions,
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
    ? demoInfoToSkirmishDraft({
        info,
        ais,
        sides,
        options,
        mapOptions,
        ai: chosenAi(),
      })
    : null;
  // The preset stores only what the match changed, so it waits for the game's
  // option list as well as for the replay and the content scan (#1838).
  const ready = !!replayPath && !infoLoading && !scanLoading && !optionsLoading;
  const canSave =
    !!draft && !!name.trim() && !scanFailure && !missingGame && !missingMap;

  const save = () => {
    if (canSave && draft) onSaved(name.trim(), draft);
  };

  return (
    <>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">
          <Trans>New preset from replay</Trans>
        </h3>
        <p className="text-xs text-muted-foreground">
          <Trans>
            Every seated player becomes an AI opponent, keeping the map,
            factions, colours and options.
          </Trans>
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">
          <Trans>Replay</Trans>
        </span>
        {replaysLoading ? (
          <p className="text-xs text-muted-foreground">
            <Trans>Loading replays…</Trans>
          </p>
        ) : replays.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            <Trans>No replays found.</Trans>
          </p>
        ) : (
          <OptionSelect
            value={replayPath}
            onValueChange={setReplayPath}
            options={replayOptions}
            placeholder={t`Pick a replay`}
            size="sm"
          />
        )}
      </div>

      {replayPath && (infoLoading || scanLoading || optionsLoading) && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" />{" "}
          <Trans>Reading replay…</Trans>
        </div>
      )}

      {ready && scanFailure && (
        <ScanFailed noun={t`games or maps`} reason={scanFailure} />
      )}

      {ready && (missingGame || missingMap) && (
        <p className="text-xs text-destructive">
          {missingGame ? t`This replay's game isn't installed.` : ""}{" "}
          {missingMap ? t`This replay's map isn't installed.` : ""}{" "}
          <Trans>Install it first from the Replays screen.</Trans>
          {missingGame && shortGameId && !shortGameId.exact && (
            <>
              {" "}
              <Trans>
                Its exact game couldn't be confirmed from the replay, so this is
                a name-only check.
              </Trans>
            </>
          )}
        </p>
      )}

      {ready && info && !scanFailure && !missingGame && !missingMap && (
        <>
          {gameCandidates.length > 1 && (
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium">
                <Trans>Game version</Trans>
              </span>
              <OptionSelect
                value={selectedGameName}
                onValueChange={setSelectedGameName}
                options={gameOptions}
                size="sm"
              />
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <span className="text-xs font-medium">
              <Trans>AI to fill every player</Trans>
            </span>
            {ais.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                <Trans>No AIs found for this game.</Trans>
              </p>
            ) : (
              <OptionSelect
                value={aiKey}
                onValueChange={setAiKey}
                options={aiOptions}
                placeholder={t`Default AI`}
                size="sm"
              />
            )}
          </div>
          {!draft ? (
            <p className="text-xs text-destructive">
              <Trans>This replay has no seated players to refight.</Trans>
            </p>
          ) : (
            <div className="flex items-center gap-2">
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") save();
                }}
                placeholder={t`Preset name`}
                className="h-8 flex-1"
              />
              <Button size="sm" disabled={!canSave} onClick={save}>
                <Trans>Save</Trans>
              </Button>
            </div>
          )}
        </>
      )}
    </>
  );
}
