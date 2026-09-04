import { Button } from "@picoframe/frame";
import { Code2, FilePlus2, Loader2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { OptionSelect } from "@/components/OptionSelect";
import { compareGameVersions } from "../../../conquest/model";
import { useReplayTarget } from "../../../play/config";
import { contentRewriteDemo } from "../../bindings";
import { useUnitsyncScan } from "../../config";
import {
  gameMatchesShortId,
  resolveReplayShortGameId,
} from "../../resolveContent";

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * "Remix": rewrite a copy of the replay so its embedded `gametype` points at a
 * locally installed game (optionally restamping the engine version), for replaying
 * against a different build. A desync during playback means the local build
 * diverged from the recording, the signal a dev is usually after. The rewrite
 * produces a new file (`onRemixed` with its path). The original is never
 * modified.
 *
 * Target games are restricted to the replay's short game id (issue #503):
 * only an installed version of the same game the replay was recorded on is
 * offered, never an unrelated one, so a remix stays "the same game, maybe a
 * different build" rather than a cross-game mismatch.
 */
export function RemixPanel({
  replayPath,
  recordedGameType,
  recordedEngineVersion,
  enginePath,
  dataDir,
  onRemixed,
}: {
  replayPath: string;
  /** The replay's original `gameType` (issue #503), used to derive its short
   * game id and restrict the target list to the same game. */
  recordedGameType: string;
  recordedEngineVersion: string;
  enginePath: string;
  dataDir: string;
  onRemixed: (newPath: string) => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-1.5">
          <Code2 className="size-4" /> Remix
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        {/* Rendered only while open, so the unitsync game scan is deferred. */}
        {open && (
          <RemixForm
            replayPath={replayPath}
            recordedGameType={recordedGameType}
            recordedEngineVersion={recordedEngineVersion}
            enginePath={enginePath}
            dataDir={dataDir}
            onRemixed={(p) => {
              setOpen(false);
              onRemixed(p);
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function RemixForm({
  replayPath,
  recordedGameType,
  recordedEngineVersion,
  enginePath,
  dataDir,
  onRemixed,
}: {
  replayPath: string;
  recordedGameType: string;
  recordedEngineVersion: string;
  enginePath: string;
  dataDir: string;
  onRemixed: (newPath: string) => void;
}) {
  const scan = useUnitsyncScan(enginePath, dataDir);
  const games = scan.data?.games ?? [];
  const { resolved } = useReplayTarget(recordedEngineVersion);

  const shortGameId = useMemo(
    () =>
      resolveReplayShortGameId(
        recordedGameType,
        games.map((g) => ({ name: g.name, shortname: g.info.shortname })),
      ),
    [games, recordedGameType],
  );
  const candidates = useMemo(
    () =>
      games.filter((g) =>
        gameMatchesShortId(shortGameId, {
          name: g.name,
          shortname: g.info.shortname,
        }),
      ),
    [games, shortGameId],
  );

  const [target, setTarget] = useState("");
  const [stampVersion, setStampVersion] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default the target to the newest matching candidate once the scan lands,
  // and re-pick if the current selection falls out of the candidate list
  // (e.g. after a rescan).
  useEffect(() => {
    if (target && candidates.some((g) => g.name === target)) return;
    if (candidates.length === 0) return;
    const newest = [...candidates].sort((a, b) =>
      compareGameVersions(b.info.version ?? "", a.info.version ?? ""),
    )[0];
    setTarget(newest.name);
  }, [candidates, target]);

  const engineVersion = resolved?.target.engineVersion;

  async function rewrite() {
    if (!target) return;
    setPending(true);
    setError(null);
    try {
      const { path } = await contentRewriteDemo({
        replayPath,
        targetGametype: target,
        engineVersion: stampVersion ? engineVersion : undefined,
      });
      onRemixed(path);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Remix this replay</h3>
        <p className="text-xs text-muted-foreground">
          Writes a copy that loads a locally installed game in place of the one
          it was recorded on. A desync during playback usually means your build
          differs from the recording. The original replay is left untouched.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">New target game</span>
        {scan.loading ? (
          <p className="text-xs text-muted-foreground">
            Scanning installed games…
          </p>
        ) : games.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            No installed games found to target.
          </p>
        ) : candidates.length === 0 ? (
          <p className="text-xs text-destructive">
            Nothing to remix onto. This game isn't installed.
            {!shortGameId.exact &&
              " Its exact game couldn't be confirmed from the replay, so this is a name-only check."}
          </p>
        ) : (
          <OptionSelect
            value={target}
            onValueChange={setTarget}
            options={candidates.map((g) => ({
              value: g.name,
              label: g.name,
              description: g.info?.version,
            }))}
            placeholder="Pick a game build"
            size="sm"
          />
        )}
      </div>

      {engineVersion && (
        <div className="flex items-start gap-2">
          <Checkbox
            id="remix-stamp-version"
            checked={stampVersion}
            onCheckedChange={(v) => setStampVersion(v === true)}
            className="mt-0.5"
          />
          <div className="flex flex-col gap-0.5">
            <Label
              htmlFor="remix-stamp-version"
              className="text-xs font-normal"
            >
              Also stamp the engine version
            </Label>
            <span className="text-xs text-muted-foreground">
              Only needed to watch on a release engine.
            </span>
          </div>
        </div>
      )}

      <Button
        onClick={rewrite}
        disabled={!target || pending}
        className="gap-1.5"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <FilePlus2 className="size-4" />
        )}
        {pending ? "Rewriting…" : "Rewrite"}
      </Button>

      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}
