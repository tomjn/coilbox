/**
 * A model opened into the builder straight from the archive browser (#714).
 *
 * The browser can draw a `.s3o` it is looking at but had nowhere to send it, and
 * the ordinary way in was to find the same file on disk and point the picker at
 * it. This is that road: the browser links here naming an archive and a member,
 * and everything past this point is what `GameModelDrawer` already does, down to
 * `gameImport.ts` staging the model and `readModel` reading it.
 *
 * A page rather than a drawer in the browser because the import belongs to the
 * builder. It writes into the builder's store, it reports itself in the
 * builder's words, and the unit it produces opens in the builder, so putting it
 * anywhere else would be a copy of all three.
 *
 * The archive is read through the browser's own engine and data root rather than
 * the play target's, because those are the ones that listed the member being
 * asked for. Reading a different install would be looking for a file somebody
 * never pointed at.
 */

import { Button } from "@picoframe/frame";
import { Blocks } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { PageHeader } from "@/components/PageHeader";
import {
  useScanTargetSelection,
  useUnitsyncArchiveTree,
} from "@/content/config";
import { modelName, openableInBuilder, openRequest } from "../archiveOpen";
import {
  modelSource,
  type PickedModel,
  stageModel,
  stageTextures,
  type UnitsyncTarget,
} from "../gameImport";
import { openedProjectFor } from "../gameModels";
import { saveProject, useLegoProjects } from "../projects";
import {
  ImportResult,
  type ImportStage,
  readModel,
  stageProject,
} from "./components/ImportResult";

export default function OpenFromArchivePage() {
  const [params] = useSearchParams();
  const request = useMemo(() => openRequest(params), [params]);
  const navigate = useNavigate();
  const { selected, loading: targetLoading } = useScanTargetSelection();
  const { projects, loading: projectsLoading } = useLegoProjects();
  const { tree, loading: treeLoading } = useUnitsyncArchiveTree(
    selected?.enginePath,
    selected?.rootPath,
    request?.archive,
  );
  const [stage, setStage] = useState<ImportStage>({ state: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  /** So a re-render, or the tree arriving twice out of its cache, cannot start
   *  a second import of the same model. */
  const started = useRef(false);
  /** Dropped on unmount, so an import somebody navigated away from stops
   *  reporting into a page that is no longer on screen. Raised on mount rather
   *  than only at birth, because Strict Mode mounts, unmounts and mounts again,
   *  and a flag only ever lowered would leave a live page counted as gone. */
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (!request || started.current) return;
    if (!openableInBuilder(request.member)) return;
    if (projectsLoading || treeLoading || targetLoading) return;
    if (!selected?.enginePath || !selected?.rootPath || !tree) return;
    started.current = true;

    // A model already open is offered as the unit it is, rather than imported a
    // second time into a second copy with its own geometry beside it.
    const existing = openedProjectFor({
      projects,
      archive: request.archive,
      archivePath: tree.archivePath,
      member: request.member,
    });
    if (existing) {
      navigate(`/lego/${existing}`, { replace: true });
      return;
    }

    const target: UnitsyncTarget = {
      enginePath: selected.enginePath,
      dataDir: selected.rootPath,
    };
    const picked: PickedModel = {
      archive: request.archive,
      ...(tree.archivePath ? { archivePath: tree.archivePath } : {}),
      member: request.member,
    };
    const name = modelName(request.member);

    setStage({ state: "reading" });
    void (async () => {
      try {
        const staged = await stageModel(target, picked);
        const result = await readModel({
          path: staged.path,
          name,
          unitName: name,
          source: modelSource(picked),
          unpacked: staged.staged !== null,
          game: {
            name: request.name ?? request.archive,
            archive: request.archive,
            member: request.member,
          },
          beforeImport: (textures) =>
            stageTextures(target, picked, staged, tree.files, textures),
        });
        if (live.current) setStage(result);
      } catch (error) {
        if (!live.current) return;
        setStage({
          state: "failed",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }, [
    request,
    projects,
    projectsLoading,
    selected,
    targetLoading,
    tree,
    treeLoading,
    navigate,
  ]);

  async function accept() {
    const project = stageProject(stage);
    if (!project) return;
    try {
      await saveProject(project);
      navigate(`/lego/${project.id}`, { replace: true });
    } catch (error) {
      setProblem(
        `Could not save the unit: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        className="border-b border-border px-6 py-4"
        title={
          <>
            <Blocks size={18} />{" "}
            {request ? modelName(request.member) : "Open a model"}
          </>
        }
        description={
          request
            ? `${request.member} in ${request.name ?? request.archive}`
            : "Nothing was named to open."
        }
        actions={
          <Button variant="outline" onClick={() => navigate(-1)}>
            Back to the archive
          </Button>
        }
      />

      <div className="flex max-w-2xl flex-col gap-5 overflow-y-auto p-6">
        <Body
          request={request}
          reading={targetLoading || treeLoading || projectsLoading}
          missing={Boolean(request) && !treeLoading && !tree}
          noTarget={!targetLoading && !selected}
          stage={stage}
          onAtlasChange={(atlas) =>
            setStage((current) =>
              current.state === "recovered" ? { ...current, atlas } : current,
            )
          }
          onAccept={() => void accept()}
        />
        {problem ? <p className="text-sm text-destructive">{problem}</p> : null}
      </div>
    </div>
  );
}

/** Why there is nothing to import, or the import itself. Every branch here is a
 *  state somebody can actually arrive in, and each says which one it is rather
 *  than leaving an empty page. */
function Body({
  request,
  reading,
  missing,
  noTarget,
  stage,
  onAtlasChange,
  onAccept,
}: {
  request: ReturnType<typeof openRequest>;
  reading: boolean;
  missing: boolean;
  noTarget: boolean;
  stage: ImportStage;
  onAtlasChange: (atlas: string | null) => void;
  onAccept: () => void;
}) {
  if (!request) {
    return (
      <p className="text-sm text-muted-foreground">
        This page opens one model out of an archive, and it was not told which.
        Browse an archive under Content and open a model from its preview.
      </p>
    );
  }
  if (!openableInBuilder(request.member)) {
    return (
      <p className="text-sm text-muted-foreground">
        {request.member} is not a <code>.s3o</code>. The builder reads that
        format alone, so there is nothing here it could open.
      </p>
    );
  }
  if (noTarget) {
    return (
      <p className="text-sm text-muted-foreground">
        No engine is selected, so there is nothing to read this archive with.
      </p>
    );
  }
  if (missing) {
    return (
      <p className="text-sm text-muted-foreground">
        Could not read {request.archive}. It may have been moved or removed
        since it was browsed.
      </p>
    );
  }
  if (reading || stage.state === "idle") {
    return (
      <p className="text-sm text-muted-foreground">
        Reading {request.member} out of {request.archive}.
      </p>
    );
  }
  return (
    <ImportResult
      stage={stage}
      onAtlasChange={onAtlasChange}
      onAccept={onAccept}
    />
  );
}
