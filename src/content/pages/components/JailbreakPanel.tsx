import { Button } from "@picoframe/frame";
import { Loader2, Play, Wand2 } from "lucide-react";
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
import { usePlay } from "../../../play/PlayProvider";
import { contentRewriteDemo } from "../../bindings";
import { useUnitsyncScan } from "../../config";

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * "Run on local build": rewrite a copy of the replay so its embedded `gametype`
 * points at a locally installed game (optionally restamping the engine version),
 * then watch that copy. A desync during playback means the local build diverged
 * from the recording — the signal a dev is usually after. The original replay is
 * never modified (the copy is a new sibling file; see `content_rewrite_demo`).
 */
export function JailbreakPanel({
  replayPath,
  recordedGametype,
  recordedEngineVersion,
  enginePath,
  dataDir,
}: {
  replayPath: string;
  recordedGametype: string;
  recordedEngineVersion: string;
  enginePath: string;
  dataDir: string;
}) {
  const [open, setOpen] = useState(false);
  const { running } = usePlay();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className="gap-1.5" disabled={running}>
          <Wand2 className="size-4" /> Run on local build
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="flex w-80 flex-col gap-3">
        {/* Rendered only while open, so the unitsync game scan is deferred. */}
        {open && (
          <JailbreakForm
            replayPath={replayPath}
            recordedGametype={recordedGametype}
            recordedEngineVersion={recordedEngineVersion}
            enginePath={enginePath}
            dataDir={dataDir}
            onLaunched={() => setOpen(false)}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}

function JailbreakForm({
  replayPath,
  recordedGametype,
  recordedEngineVersion,
  enginePath,
  dataDir,
  onLaunched,
}: {
  replayPath: string;
  recordedGametype: string;
  recordedEngineVersion: string;
  enginePath: string;
  dataDir: string;
  onLaunched: () => void;
}) {
  const scan = useUnitsyncScan(enginePath, dataDir);
  const games = scan.data?.games ?? [];
  const { resolved } = useReplayTarget(recordedEngineVersion);
  const { running, launchReplay } = usePlay();

  const [target, setTarget] = useState("");
  const [stampVersion, setStampVersion] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // Default the target to the first installed game once the scan lands.
  useEffect(() => {
    if (!target && games.length > 0) setTarget(games[0].name);
  }, [games, target]);

  const engineVersion = resolved?.target.engineVersion;

  async function run() {
    if (!target || !resolved) return;
    setPending(true);
    setError(null);
    setNote(null);
    try {
      const { path } = await contentRewriteDemo({
        replayPath,
        targetGametype: target,
        engineVersion: stampVersion ? engineVersion : undefined,
      });
      const res = await launchReplay({
        demoPath: path,
        executable: resolved.target.executable,
        dataDir: resolved.target.dataDir,
      });
      // A desync exit is the expected, useful outcome here — report it plainly
      // rather than as a hard error.
      if (res.exitCode && res.exitCode !== 0) {
        setNote(
          `Engine exited with code ${res.exitCode}. A desync exit is expected when the local build's behaviour differs from the recording.`,
        );
      } else {
        onLaunched();
      }
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-medium">Run on a local build</h3>
        <p className="text-xs text-muted-foreground">
          Rewrites a copy of this replay to load a locally installed game
          instead of{" "}
          <span className="break-all font-mono text-foreground">
            {recordedGametype || "its recorded game"}
          </span>
          . A desync during playback usually means your build differs from the
          recording. The original replay is left untouched.
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium">Target game</span>
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
        <div className="flex items-start gap-2 text-xs">
          <Checkbox
            id="jailbreak-stamp-version"
            checked={stampVersion}
            onCheckedChange={(v) => setStampVersion(v === true)}
            className="mt-0.5"
          />
          <Label
            htmlFor="jailbreak-stamp-version"
            className="text-xs font-normal leading-snug"
          >
            Also stamp engine version to{" "}
            <span className="font-mono">{engineVersion}</span> — only needed on
            a release engine.
          </Label>
        </div>
      )}

      <Button
        onClick={run}
        disabled={!target || !resolved || pending || running}
        className="gap-1.5"
        title={!resolved ? "Install an engine to watch replays." : undefined}
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <Play className="size-4 fill-current" />
        )}
        {pending ? "Preparing…" : "Rewrite & watch"}
      </Button>

      {!resolved && (
        <p className="text-xs text-muted-foreground">
          Install an engine to watch replays.
        </p>
      )}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </>
  );
}
