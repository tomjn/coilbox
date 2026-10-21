import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Channel } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, Loader2, Undo2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { formatNumber } from "@/lib/format";
import { notify } from "@/notify/notify";
import {
  type Convert3doGroup,
  type Convert3doProgress,
  type Convert3doResult,
  content3doInstallStatus,
  contentInstall3doConversion,
  contentOpenPath,
  contentUndo3doInstall,
  type Install3doOutcome,
  unitsyncCancel,
  unitsyncConvert3do,
} from "../../bindings";
import { invalidateArchiveTree } from "../../config";

const msg = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

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
  gameDir = null,
}: {
  enginePath: string;
  dataDir: string;
  archive: string;
  /** How many `.3do` files the archive listing found, so the drawer can say
   * what it is about to do before it starts. */
  models: number;
  /**
   * The game's on-disk `.sdd` folder, so the report can offer to install the
   * conversion into it (issue #2622). `null` for a packed `.sdz`/`.sd7`: a
   * packed archive is one file, and there is no sound way to rewrite one of
   * those in place, so installing is refused rather than offered.
   */
  gameDir?: string | null;
}) {
  const { t } = useLingui();
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
      title: t`Choose a folder for the converted models`,
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

  let progressText: string;
  if (!progress) progressText = t`Reading the archive`;
  else if (progress.phase === "atlas") {
    const folder = progress.folder;
    progressText = t`Building the sheet for ${folder}`;
  } else {
    const total = progress.total;
    const member = progress.member;
    progressText = member
      ? t`${done} of ${total}: ${member}`
      : t`${done} of ${total}`;
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <p className="text-muted-foreground">
        <Trans>
          Every <code>.3do</code> under <code>objects3d/</code> becomes an{" "}
          <code>.s3o</code>. Each folder's models share one texture, so the
          engine binds one sheet for a faction rather than one per unit. This
          archive has {models} of them.
        </Trans>
      </p>

      <div className="flex flex-col gap-1">
        <span className="font-medium">
          <Trans>Output folder</Trans>
        </span>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="h-9 gap-1.5"
            disabled={running}
            onClick={chooseFolder}
          >
            <FolderOpen className="size-4" /> <Trans>Choose folder</Trans>
          </Button>
          <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">
            {outDir ?? t`nothing picked yet`}
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
            <Trans>Cancel</Trans>
          </Button>
        )}
        <Button
          type="button"
          className="h-9"
          disabled={!outDir || running}
          onClick={convert}
        >
          {running ? t`Converting...` : t`Convert models`}
        </Button>
      </div>

      {running && (
        <div className="flex flex-col gap-1">
          <Progress value={percent} />
          <p className="text-xs text-muted-foreground">{progressText}</p>
        </div>
      )}

      {error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs">
          {error}
          {error.includes("cancelled") && (
            <>
              {" "}
              <Trans>
                Whatever had already been written is still in the output folder.
              </Trans>
            </>
          )}
        </p>
      )}

      {result && (
        <Report
          result={result}
          onOpen={setOutDir}
          gameDir={gameDir}
          enginePath={enginePath}
          dataDir={dataDir}
          archive={archive}
        />
      )}
    </div>
  );
}

/** What the run did, and everything it could not do properly. */
function Report({
  result,
  onOpen,
  gameDir,
  enginePath,
  dataDir,
  archive,
}: {
  result: Convert3doResult;
  onOpen: (dir: string) => void;
  gameDir: string | null;
  enginePath: string;
  dataDir: string;
  archive: string;
}) {
  const { t } = useLingui();
  const unreadable = Object.entries(result.unreadable);
  const modelsWritten = result.modelsWritten;
  const modelsFound = result.modelsFound;
  const unreadableCount = unreadable.length;
  return (
    <div className="flex flex-col gap-3 border-t border-border/50 pt-3">
      <div className="flex items-center justify-between gap-2">
        <p>
          <Trans>
            Wrote {modelsWritten} of {modelsFound} models into{" "}
            <Plural
              value={result.groups.length}
              one="# sheet"
              other="# sheets"
            />
            .
          </Trans>
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
          <FolderOpen className="size-4" /> <Trans>Open folder</Trans>
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        <Trans>
          No model has a second texture. A <code>.3do</code> carries no glow, no
          shine and no cut-out mask, so there is nothing to put there and
          coilbox leaves it empty rather than writing a stand-in that would fix
          all three at one value for every unit.
        </Trans>
      </p>

      <p className="text-xs text-muted-foreground">
        <Trans>
          Copying the output over the game is not enough on its own: the engine
          tries <code>.3do</code> before <code>.s3o</code> for a unit whose{" "}
          <code>objectname</code> has no extension, so it keeps loading the old
          models while both are there. The original <code>.3do</code> files have
          to go, and any unit definition that spells <code>.3do</code> in its{" "}
          <code>objectname</code> has to lose it too.
        </Trans>
      </p>

      <InstallPanel
        gameDir={gameDir}
        outDir={result.outDir}
        enginePath={enginePath}
        dataDir={dataDir}
        archive={archive}
      />

      {result.errors.length > 0 && (
        <ul className="flex flex-col gap-1 text-xs text-destructive">
          {result.errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {unreadable.length > 0 && (
        <Section title={t`Could not be read at all (${unreadableCount})`}>
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

/**
 * Install a conversion's output into the game it came from (issue #2622), or
 * say why not.
 *
 * `gameDir` is `null` for a packed `.sdz`/`.sd7`: a packed archive is one
 * file, and there is no sound way to rewrite one of those in place, so
 * installing is refused here rather than half-done. The Rust side refuses
 * the same thing independently, this is only the reason shown before the
 * button is ever pressed.
 *
 * Checks {@link content3doInstallStatus} on mount so "Undo" is offered even in
 * a freshly opened drawer that never ran the install itself this session: the
 * backups an install writes outlive the component.
 */
function InstallPanel({
  gameDir,
  outDir,
  enginePath,
  dataDir,
  archive,
}: {
  gameDir: string | null;
  outDir: string;
  enginePath: string;
  dataDir: string;
  archive: string;
}) {
  const { t } = useLingui();
  const [backups, setBackups] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [outcome, setOutcome] = useState<Install3doOutcome | null>(null);
  const [restored, setRestored] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!gameDir) return;
    content3doInstallStatus({ gameDir })
      .then((res) => setBackups(res.backups))
      .catch(() => {});
  }, [gameDir]);

  const refreshTree = () => invalidateArchiveTree(enginePath, dataDir, archive);

  const install = async () => {
    if (!gameDir) return;
    setBusy(true);
    setError(null);
    try {
      const res = await contentInstall3doConversion({ gameDir, outDir });
      setOutcome(res);
      setRestored(null);
      setConfirmOpen(false);
      refreshTree();
      const status = await content3doInstallStatus({ gameDir }).catch(
        () => null,
      );
      if (status) setBackups(status.backups);
      void notify({
        title: t`Installed the conversion into ${archive}.`,
        level: "success",
      });
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const undo = async () => {
    if (!gameDir) return;
    setBusy(true);
    setError(null);
    try {
      const res = await contentUndo3doInstall({ gameDir });
      setRestored(res.restored.length);
      setOutcome(null);
      setBackups(0);
      refreshTree();
      void notify({
        title: t`Restored ${archive}'s original models and unit definitions.`,
        level: "success",
      });
    } catch (e) {
      setError(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const missingNames = outcome?.missingOriginal.join(", ") ?? "";

  if (!gameDir) {
    return (
      <p className="rounded-md border border-border/50 bg-muted/40 p-2 text-xs text-muted-foreground">
        <Trans>
          {archive} is a packed archive, so coilbox cannot install into it
          directly. Copy the output folder over the game yourself, remove the
          original <code>.3do</code> files, and fix any unit definition that
          spells <code>.3do</code> in its <code>objectname</code>. Or extract
          the game to a <code>.sdd</code> copy first and run this again from
          there.
        </Trans>
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/50 p-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          <Trans>
            Install writes the converted files into {archive}, moves each
            original <code>.3do</code> aside rather than deleting it, and fixes
            any unit definition that names one. Reversible with Undo, for as
            long as the moved-aside originals are still there.
          </Trans>
        </p>
        <div className="flex shrink-0 gap-2">
          {!!backups && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-1.5"
              disabled={busy}
              onClick={undo}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Undo2 className="size-4" />
              )}
              <Trans>Undo</Trans>
            </Button>
          )}
          <Popover open={confirmOpen} onOpenChange={setConfirmOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                size="sm"
                className="gap-1.5"
                disabled={busy}
              >
                {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                <Trans>Install into game</Trans>
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="flex w-80 flex-col gap-3">
              <div className="flex flex-col gap-1">
                <h3 className="text-sm font-medium">
                  <Trans>Install this conversion?</Trans>
                </h3>
                <p className="break-words text-xs text-muted-foreground">
                  <Trans>
                    This copies the converted models and textures into {archive}
                    , and moves every original <code>.3do</code> they replace
                    aside so the conversion actually takes effect. It does not
                    delete anything, and Undo puts it all back.
                  </Trans>
                </p>
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirmOpen(false)}
                  disabled={busy}
                >
                  <Trans>Cancel</Trans>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={install}
                  disabled={busy}
                >
                  <Trans>Install</Trans>
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {outcome && (
        <p className="text-xs text-muted-foreground">
          {outcome.unitDefsPatched.length > 0 ? (
            <Trans>
              Moved{" "}
              <Plural
                value={outcome.originalsMovedAside.length}
                one="# original model"
                other="# original models"
              />{" "}
              aside and fixed{" "}
              <Plural
                value={outcome.unitDefsPatched.length}
                one="# unit definition"
                other="# unit definitions"
              />{" "}
              that named a .3do extension.
            </Trans>
          ) : (
            <Trans>
              Moved{" "}
              <Plural
                value={outcome.originalsMovedAside.length}
                one="# original model"
                other="# original models"
              />{" "}
              aside.
            </Trans>
          )}
          {outcome.alreadyInstalled.length > 0 && (
            <>
              {" "}
              <Plural
                value={outcome.alreadyInstalled.length}
                one="# model was already installed."
                other="# models were already installed."
              />
            </>
          )}
          {outcome.missingOriginal.length > 0 && (
            <>
              {" "}
              <Plural
                value={outcome.missingOriginal.length}
                one={`# converted model has no original .3do to replace: ${missingNames}.`}
                other={`# converted models have no original .3do to replace: ${missingNames}.`}
              />
            </>
          )}
        </p>
      )}

      {restored !== null && (
        <p className="text-xs text-muted-foreground">
          <Trans>
            Restored <Plural value={restored} one="# file" other="# files" /> to
            how they were before the install.
          </Trans>
        </p>
      )}
    </div>
  );
}

function GroupReport({ group }: { group: Convert3doGroup }) {
  const { t } = useLingui();
  const missing = Object.entries(group.missingTextures);
  const undecodable = Object.entries(group.undecodableTextures);
  const modelsWritten = group.modelsWritten;
  const atlasSide = group.atlasSide;
  const tilesPacked = group.tilesPacked;
  const atlas = group.atlas;
  const triangleCount = formatNumber(group.triangles);
  const vertexCount = formatNumber(group.vertices);
  const didNotFitCount = group.didNotFit.length;
  const missingCount = missing.length;
  const undecodableCount = undecodable.length;
  const paletteFaces = group.paletteFaces;
  const missingTextureFaces = group.missingTextureFaces;
  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/50 p-2">
      <p className="font-medium">{group.folder}</p>
      <p className="text-xs text-muted-foreground">
        <Trans>
          {modelsWritten} models on a {atlasSide} pixel sheet of {tilesPacked}{" "}
          tiles ({atlas})
        </Trans>
        {group.reusedAtlas && (
          <>
            {", "}
            <Trans>
              kept from an earlier run so the models it already wrote stay
              correct
            </Trans>
          </>
        )}
        {". "}
        <Trans>
          {triangleCount} triangles, {vertexCount} vertices.
        </Trans>
      </p>

      {group.didNotFit.length > 0 && (
        <Section title={t`Did not fit on the sheet (${didNotFitCount})`}>
          {group.didNotFit.map((name) => (
            <li key={name}>{name}</li>
          ))}
        </Section>
      )}

      {missing.length > 0 && (
        <Section title={t`Textures the game does not ship (${missingCount})`}>
          {missing.map(([name, models]) => (
            <li key={name}>
              <Trans>
                <span className="font-mono">{name}</span>, wanted by{" "}
                <Plural value={models} one="# model" other="# models" />
              </Trans>
            </li>
          ))}
        </Section>
      )}

      {undecodable.length > 0 && (
        <Section
          title={t`Textures coilbox could not decode (${undecodableCount})`}
        >
          {undecodable.map(([name, at]) => (
            <li key={name}>
              <Trans>
                <span className="font-mono">{name}</span> is{" "}
                <span className="font-mono">{at.member}</span>, wanted by{" "}
                <Plural value={at.wantedBy} one="# model" other="# models" />
              </Trans>
            </li>
          ))}
        </Section>
      )}

      <p className="text-xs text-muted-foreground">
        <Trans>
          {paletteFaces} faces took a palette colour nothing could resolve
        </Trans>
        {group.paletteModels.length > 0 && (
          <>
            {", "}
            <Plural
              value={group.paletteModels.length}
              one="across # model"
              other="across # models"
            />
          </>
        )}
        {". "}
        <Trans>
          {missingTextureFaces} faces are flat because their tile is missing.
        </Trans>
        {group.droppedPieces > 0 && (
          <>
            {" "}
            <Plural
              value={group.droppedPieces}
              one="# inert same-named piece was dropped."
              other="# inert same-named pieces were dropped."
            />
          </>
        )}
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
