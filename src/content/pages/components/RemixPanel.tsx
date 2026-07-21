import { Button } from "@picoframe/frame";
import { Code2, FilePlus2, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import { useReplayTarget } from "../../../play/config";
import { contentRewriteDemo } from "../../bindings";
import { useUnitsyncScan } from "../../config";

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * "Remix": rewrite a copy of the replay so its embedded `gametype` points at a
 * locally installed game (optionally restamping the engine version), for replaying
 * against a different build. A desync during playback means the local build
 * diverged from the recording — the signal a dev is usually after. The rewrite
 * produces a new file (`onRemixed` with its path); the original is never modified.
 */
export function RemixPanel({
  replayPath,
  recordedEngineVersion,
  enginePath,
  dataDir,
  onRemixed,
}: {
  replayPath: string;
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
  recordedEngineVersion,
  enginePath,
  dataDir,
  onRemixed,
}: {
  replayPath: string;
  recordedEngineVersion: string;
  enginePath: string;
  dataDir: string;
  onRemixed: (newPath: string) => void;
}) {
  const scan = useUnitsyncScan(enginePath, dataDir);
  const games = scan.data?.games ?? [];
  const { resolved } = useReplayTarget(recordedEngineVersion);

  const [target, setTarget] = useState("");
  const [stampVersion, setStampVersion] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Default the target to the first installed game once the scan lands.
  useEffect(() => {
    if (!target && games.length > 0) setTarget(games[0].name);
  }, [games, target]);

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
        {games.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {scan.loading
              ? "Scanning installed games…"
              : "No installed games found to target."}
          </p>
        ) : (
          <OptionSelect
            value={target}
            onValueChange={setTarget}
            options={games.map((g) => ({
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
