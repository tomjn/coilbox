import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Download, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
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
  const { ais } = useSkirmishAis(enginePath, dataDir, archive);
  const { info } = useUnitsyncGameInfo(enginePath, dataDir, archive);
  const sides = (info?.sides ?? []).map((s) => s.name);

  const [file, setFile] = useState(files[0]);
  const path = files.includes(file) ? file : files[0];
  const [records, setRecords] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [removing, setRemoving] = useState<string | null>(null);
  const [writeId, setWriteId] = useState("");
  const [replacing, setReplacing] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const { json } = await playChobbyPresetsRead({ path });
      setRecords(parseOptionsPresets(json));
      setError(null);
    } catch (e) {
      setRecords(null);
      setError(describeError(e));
    }
  }, [path]);

  useEffect(() => {
    setPicked(new Set());
    setRemoving(null);
    void load();
  }, [load]);

  /** Make the edits, returning where the copy of the file went, or null when
   *  nothing was written. */
  const change = async (edits: ChobbyPresetEdit[]): Promise<string | null> => {
    setBusy(true);
    try {
      const { json, backup } = await playChobbyPresetsWrite({ path, edits });
      setRecords(parseOptionsPresets(json));
      setError(null);
      return backup;
    } catch (e) {
      setError(describeError(e));
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
        ais,
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
      { op: "set", name, record: presetToChobbyRecord(writing, sides) },
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
                disabled={disabled || busy}
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
              disabled={disabled || busy || !records || !writing}
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
        {error && (
          <Alert variant="destructive" className="mb-3">
            <AlertDescription>{error}</AlertDescription>
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
          disabled={disabled || picked.size === 0 || !currentGameName}
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
