import { Button } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { useRef, useState } from "react";
import { Progress } from "@/components/ui/progress";
import {
  type Convert3doGroup,
  type Convert3doProgress,
  type Convert3doResult,
  contentOpenPath,
  unitsyncCancel,
  unitsyncConvert3do,
} from "../../bindings";

/**
 * Convert every `.3do` in one game to `.s3o` (issue #2573).
 *
 * A game of this era is hundreds of models, so this is not a dialog that blocks
 * and then answers. It picks a folder, runs, and says where it has got to model
 * by model, with a Cancel that means it. Balanced Annihilation is 720 models and
 * three seconds on the machine this was written on, but a run is a run: a window
 * that sits still for four minutes is a bug even when it finishes.
 *
 * The report at the end is the other half of the point. Which models did not
 * fit, which faces came out flat and why, which textures the game does not ship.
 * A run that quietly drops five units is far worse than one that names them.
 */
export function Convert3doDrawer({
  enginePath,
  dataDir,
  archive,
  models,
}: {
  enginePath: string;
  dataDir: string;
  archive: string;
  /** How many `.3do` files the archive listing found, so the drawer can say
   * what it is about to do before it starts. */
  models: number;
}) {
  const [outDir, setOutDir] = useState<string | null>(null);
  const [progress, setProgress] = useState<Convert3doProgress | null>(null);
  const [result, setResult] = useState<Convert3doResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const opId = useRef<string | null>(null);

  const chooseFolder = async () => {
    const picked = await open({
      directory: true,
      multiple: false,
      title: "Choose a folder for the converted models",
    });
    if (typeof picked === "string") setOutDir(picked);
  };

  const convert = async () => {
    if (!outDir) return;
    setRunning(true);
    setResult(null);
    setError(null);
    setProgress(null);
    const id = crypto.randomUUID();
    opId.current = id;
    const onProgress = new Channel<Convert3doProgress>();
    onProgress.onmessage = setProgress;
    try {
      setResult(
        await unitsyncConvert3do({
          enginePath,
          dataDir,
          archive,
          outDir,
          opId: id,
          onProgress,
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
      opId.current = null;
    }
  };

  const cancel = () => {
    if (opId.current) unitsyncCancel({ opId: opId.current }).catch(() => {});
  };

  const done = progress ? Math.min(progress.done, progress.total) : 0;
  const percent =
    progress && progress.total > 0 ? (done / progress.total) * 100 : 0;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-muted-foreground">
        Every <code>.3do</code> under <code>objects3d/</code> becomes an{" "}
        <code>.s3o</code>. Each folder's models share one texture, so the engine
        binds one sheet for a faction rather than one per unit. This archive has{" "}
        {models} of them.
      </p>

      <div className="flex flex-col gap-1">
        <span className="font-medium">Output folder</span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={running}
            onClick={chooseFolder}
          >
            <FolderOpen className="size-4" /> Choose folder
          </Button>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {outDir ?? "nothing picked yet"}
          </span>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        {running && (
          <Button
            type="button"
            variant="outline"
            className="h-9"
            onClick={cancel}
          >
            Cancel
          </Button>
        )}
        <Button
          type="button"
          className="h-9"
          disabled={!outDir || running}
          onClick={convert}
        >
          {running ? "Converting..." : "Convert models"}
        </Button>
      </div>

      {running && (
        <div className="flex flex-col gap-1">
          <Progress value={percent} />
          <p className="text-xs text-muted-foreground">
            {progress?.phase === "atlas"
              ? `Building the sheet for ${progress.folder}`
              : progress
                ? `${done} of ${progress.total}${progress.member ? `: ${progress.member}` : ""}`
                : "Reading the archive"}
          </p>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
          {error}
          {error.includes("cancelled") &&
            " Whatever had already been written is still in the output folder."}
        </p>
      )}

      {result && <Report result={result} onOpen={setOutDir} />}
    </div>
  );
}

/** What the run did, and everything it could not do properly. */
function Report({
  result,
  onOpen,
}: {
  result: Convert3doResult;
  onOpen: (dir: string) => void;
}) {
  const unreadable = Object.entries(result.unreadable);
  return (
    <div className="flex flex-col gap-3 border-t border-border/50 pt-3">
      <div className="flex items-center justify-between gap-2">
        <p>
          Wrote {result.modelsWritten} of {result.modelsFound} models into{" "}
          {result.groups.length}{" "}
          {result.groups.length === 1 ? "sheet" : "sheets"}.
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => {
            onOpen(result.outDir);
            contentOpenPath({ path: result.outDir }).catch(() => {});
          }}
        >
          <FolderOpen className="size-4" /> Open folder
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        No model has a second texture. A <code>.3do</code> carries no glow, no
        shine and no cut-out mask, so there is nothing to put there and coilbox
        leaves it empty rather than writing a stand-in that would fix all three
        at one value for every unit.
      </p>

      <p className="text-xs text-muted-foreground">
        Copy the output over the game to use it, and remove the original{" "}
        <code>.3do</code> files. The engine tries <code>.3do</code> before{" "}
        <code>.s3o</code> for a unit whose <code>objectname</code> has no
        extension, so it keeps loading the old models while both are there.
      </p>

      {result.errors.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-destructive">
          {result.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {unreadable.length > 0 && (
        <Section title={`Could not be read at all (${unreadable.length})`}>
          {unreadable.map(([member, why]) => (
            <li key={member}>
              <span className="font-mono">{member}</span>: {why}
            </li>
          ))}
        </Section>
      )}

      {result.groups.map((group) => (
        <GroupReport key={group.folder} group={group} />
      ))}
    </div>
  );
}

function GroupReport({ group }: { group: Convert3doGroup }) {
  const missing = Object.entries(group.missingTextures);
  const undecodable = Object.entries(group.undecodableTextures);
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/50 p-2">
      <p className="font-medium">{group.folder}</p>
      <p className="text-xs text-muted-foreground">
        {group.modelsWritten} models on a {group.atlasSide} pixel sheet of{" "}
        {group.tilesPacked} tiles ({group.atlas})
        {group.reusedAtlas
          ? ", kept from an earlier run so the models it already wrote stay correct"
          : ""}
        . {group.triangles.toLocaleString()} triangles,{" "}
        {group.vertices.toLocaleString()} vertices.
      </p>

      {group.didNotFit.length > 0 && (
        <Section title={`Did not fit on the sheet (${group.didNotFit.length})`}>
          {group.didNotFit.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </Section>
      )}

      {missing.length > 0 && (
        <Section title={`Textures the game does not ship (${missing.length})`}>
          {missing.map(([name, models]) => (
            <li key={name}>
              <span className="font-mono">{name}</span>, wanted by {models}{" "}
              {models === 1 ? "model" : "models"}
            </li>
          ))}
        </Section>
      )}

      {undecodable.length > 0 && (
        <Section
          title={`Textures coilbox could not decode (${undecodable.length})`}
        >
          {undecodable.map(([name, at]) => (
            <li key={name}>
              <span className="font-mono">{name}</span> is{" "}
              <span className="font-mono">{at.member}</span>, wanted by{" "}
              {at.wantedBy} {at.wantedBy === 1 ? "model" : "models"}
            </li>
          ))}
        </Section>
      )}

      <p className="text-xs text-muted-foreground">
        {group.paletteFaces} faces took a palette colour nothing could resolve
        {group.paletteModels.length > 0
          ? `, across ${group.paletteModels.length} models`
          : ""}
        . {group.missingTextureFaces} faces are flat because their tile is
        missing, and {group.untexturedFaces} because the file names no texture
        for them at all.
        {group.droppedPieces > 0
          ? ` ${group.droppedPieces} inert same-named pieces were dropped.`
          : ""}
      </p>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer font-medium">{title}</summary>
      <ul className="mt-1 flex max-h-48 flex-col gap-0.5 overflow-auto pl-3 text-muted-foreground">
        {children}
      </ul>
    </details>
  );
}
