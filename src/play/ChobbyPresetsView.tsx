import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Download, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { OptionSelect } from "@/components/OptionSelect";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Checkbox } from "@/components/ui/checkbox";
import { useUnitsyncGameInfo } from "@/content/config";
import { describeError } from "@/i18n/uiError";
import { notify } from "@/notify/notify";
import { dedupePresetName } from "@/packs/manifest";
import {
  type ChobbyPresetEdit,
  playChobbyPresetsRead,
  playChobbyPresetsWrite,
} from "./bindings";
import {
  chobbyRecordToDraft,
  describeChobbyRecord,
  parseOptionsPresets,
  presetToChobbyRecord,
} from "./chobbyPresets";
import { useSkirmishAis } from "./config";
import { useSkirmishPresets } from "./presets";

/** The folder an `optionsPresets.json` sits in, to tell two of them apart. */
const folderOf = (file: string) => file.replace(/[\\/][^\\/]*$/, "");

/**
 * The sheet's face for BYAR-Chobby's saved presets (issue #1297): the records in
 * its `optionsPresets.json` to import, a coilbox preset to write in, and a
 * record to remove.
 *
 * The file is Chobby's, so every change goes through one command that reads it
 * again at the moment of writing, copies it beside itself and keeps what it was
 * not asked to change. A file Chobby could not decode is shown as the error and
 * not written to. While a game coilbox launched is running the sheet passes
 * `disabled`, and nothing here changes the file.
 */
export function ChobbyPresetsView({
  files,
  currentGameName,
  enginePath,
  dataDir,
  archive,
  disabled,
}: {
  /** Every `optionsPresets.json` found. Never empty. */
  files: string[];
  /** The game imported presets will belong to. A record names no game. */
  currentGameName: string;
  enginePath?: string;
  dataDir?: string;
  archive?: string;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const { presets, savePreset } = useSkirmishPresets();
  const aiList = useSkirmishAis(enginePath, dataDir, archive);
  const gameInfo = useUnitsyncGameInfo(enginePath, dataDir, archive);
  const sides = (gameInfo.info?.sides ?? []).map((s) => s.name);
  // Converting needs the game's factions and AIs. With a game resolved, wait
  // for both to arrive rather than save blank factions and guess AI kinds, and
  // do not convert when either read failed. With no game resolved there is
  // nothing to wait for.
  const hasGame = !!(enginePath && dataDir && archive);
  const lookupsPending =
    hasGame && (gameInfo.status === "loading" || !aiList.loaded);
  const lookupsFailed =
    hasGame &&
    !lookupsPending &&
    (gameInfo.status === "error" || aiList.failed);
  const convertible = !lookupsPending && !lookupsFailed;

  const [file, setFile] = useState(files[0]);
  const path = files.includes(file) ? file : files[0];
  // What a file held and what went wrong with it carry the file they are about,
  // so a reply for a file no longer shown is never read as this one's.
  const [loaded, setLoaded] = useState<{
    path: string;
    records: Record<string, unknown> | null;
    error: string | null;
  } | null>(null);
  const records = loaded?.path === path ? loaded.records : null;
  const error = loaded?.path === path ? loaded.error : null;
  const shown = useRef(path);
  shown.current = path;
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [removing, setRemoving] = useState<string | null>(null);
  const [writeId, setWriteId] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    setPicked(new Set());
    setRemoving(null);
    setReplacing(false);
    playChobbyPresetsRead({ path })
      .then(({ json }) => {
        if (live)
          setLoaded({ path, records: parseOptionsPresets(json), error: null });
      })
      .catch((e) => {
        if (live) setLoaded({ path, records: null, error: describeError(e) });
      });
    return () => {
      live = false;
    };
  }, [path]);

  /** Make the edits, returning where the copy of the file went, or null when
   *  nothing was written. */
  const change = async (edits: ChobbyPresetEdit[]): Promise<string | null> => {
    const target = path;
    setBusy(true);
    try {
      const { json, backup } = await playChobbyPresetsWrite({
        path: target,
        edits,
      });
      if (shown.current === target)
        setLoaded({
          path: target,
          records: parseOptionsPresets(json),
          error: null,
        });
      return backup;
    } catch (e) {
      if (shown.current === target)
        setLoaded((prev) => ({
          path: target,
          records: prev?.path === target ? prev.records : null,
          error: describeError(e),
        }));
      return null;
    } finally {
      setBusy(false);
    }
  };

  const names = Object.keys(records ?? {});
  const writing = presets.find((p) => p.id === writeId);

  const importPicked = () => {
    if (!records) return;
    const taken = presets.map((p) => p.name);
    const dropped = new Set<string>();
    let count = 0;
    for (const name of names.filter((n) => picked.has(n))) {
      const result = chobbyRecordToDraft(records[name], {
        gameName: currentGameName,
        sides,
        ais: aiList.ais,
      });
      // A clash gets a new name. Nothing already in the library is replaced.
      const saved = dedupePresetName(taken, name);
      taken.push(saved);
      savePreset(saved, result.draft);
      for (const section of result.dropped) dropped.add(section);
      count++;
    }
    setPicked(new Set());
    const sections = [...dropped].join(", ");
    notify({
      title: plural(count, {
        one: "Imported # preset from Chobby",
        other: "Imported # presets from Chobby",
      }),
      body: sections ? t`Left out: ${sections}` : undefined,
      level: "success",
    });
  };

  const write = async () => {
    if (!writing) return;
    const name = writing.name;
    if (records && name in records && !replacing) {
      setReplacing(true);
      return;
    }
    setReplacing(false);
    const backup = await change([
      {
        op: "set",
        name,
        record: presetToChobbyRecord(
          writing,
          // Sides are the selected game's. Another game's preset gets none.
          writing.gameName === currentGameName ? sides : undefined,
        ),
      },
    ]);
    if (backup)
      notify({
        title: t`Wrote "${name}" to Chobby`,
        body: t`Backup: ${backup}`,
        level: "success",
      });
  };

  const remove = async (name: string) => {
    setRemoving(null);
    const backup = await change([{ op: "remove", name }]);
    if (backup)
      notify({
        title: t`Removed "${name}" from Chobby`,
        body: t`Backup: ${backup}`,
        level: "success",
      });
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-col gap-2 border-b border-border/60 px-5 py-3">
        {files.length > 1 && (
          <OptionSelect
            size="sm"
            ariaLabel={t`Chobby file`}
            value={path}
            onValueChange={setFile}
            disabled={busy}
            options={files.map((f) => ({ value: f, label: folderOf(f) }))}
          />
        )}
        <div className="flex items-center gap-2">
          <OptionSelect
            size="sm"
            className="min-w-0 flex-1"
            ariaLabel={t`Preset to write`}
            placeholder={t`Choose a preset to write`}
            value={writeId}
            onValueChange={(id) => {
              setWriteId(id);
              setReplacing(false);
            }}
            disabled={disabled || busy || !records}
            options={presets.map((p) => ({ value: p.id, label: p.name }))}
          />
          {replacing ? (
            <>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void write()}
                disabled={disabled || busy || !convertible}
              >
                <Trans>Replace</Trans>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setReplacing(false)}
              >
                <Trans>Cancel</Trans>
              </Button>
            </>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void write()}
              disabled={
                disabled || busy || !records || !writing || !convertible
              }
            >
              <Upload className="size-4" /> <Trans>Write</Trans>
            </Button>
          )}
        </div>
        {replacing && writing && (
          <p className="text-sm">
            <Trans>"{writing.name}" is already in Chobby.</Trans>
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {(error || lookupsFailed) && (
          <Alert variant="destructive" className="mb-3">
            <AlertDescription>
              {error ??
                t`Could not read this game's factions and AIs. Close the sheet and open it again to retry.`}
            </AlertDescription>
          </Alert>
        )}
        <ul className="flex flex-col gap-2">
          {names.map((name) => {
            const sum = describeChobbyRecord(records?.[name]);
            const bots = plural(sum.bots, { one: "# bot", other: "# bots" });
            const options = plural(sum.options, {
              one: "# option",
              other: "# options",
            });
            return (
              <li
                key={name}
                className="flex items-center gap-3 rounded-lg border border-border/50 bg-card p-3"
              >
                <Checkbox
                  aria-label={t`Import ${name}`}
                  checked={picked.has(name)}
                  disabled={disabled}
                  onCheckedChange={(on) =>
                    setPicked((prev) => {
                      const next = new Set(prev);
                      if (on === true) next.add(name);
                      else next.delete(name);
                      return next;
                    })
                  }
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {name}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                    {[sum.map, bots, options].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {removing === name ? (
                  <>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => void remove(name)}
                      disabled={disabled || busy}
                    >
                      <Trans>Remove</Trans>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setRemoving(null)}
                    >
                      <Trans>Cancel</Trans>
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => setRemoving(name)}
                    disabled={disabled || busy}
                    aria-label={t`Remove ${name} from Chobby`}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      </div>

      <div className="border-t border-border/60 px-5 py-3">
        <Button
          size="sm"
          className="w-full"
          onClick={importPicked}
          disabled={
            disabled || picked.size === 0 || !currentGameName || !convertible
          }
        >
          <Download className="size-4" />{" "}
          {picked.size === 0
            ? t`Import`
            : plural(picked.size, {
                one: "Import # preset",
                other: "Import # presets",
              })}
        </Button>
      </div>
    </div>
  );
}
