import { Button, Input } from "@picoframe/frame";
import { Blocks, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";

import {
  childrenOf,
  descendantIds,
  type LegoProject,
  normalisePieceName,
  projectProblems,
  uniquePieceName,
} from "../model";
import { type LegoPartInfo, type LoadedPack, loadPack } from "../pack";
import { saveProject, saveThumbnail, useLegoProjects } from "../projects";
import { ModelViewport } from "./components/ModelViewport";
import { PartPicker } from "./components/PartPicker";

/**
 * Assemble one unit.
 *
 * The document is held in local state and written on save rather than on every
 * nudge, so a drag is not a hundred disk writes. The overview stays in step
 * because saving goes through the shared store.
 */
export default function BuilderPage() {
  const { id } = useParams<{ id: string }>();
  const { projects, loading } = useLegoProjects();
  const stored = projects.find((project) => project.id === id);

  const [pack, setPack] = useState<LoadedPack | null>(null);
  const [draft, setDraft] = useState<LegoProject | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    loadPack().then(setPack, () => setPack(null));
  }, []);

  // Take a copy once the document arrives. Later refreshes of the shared list
  // must not overwrite edits in progress.
  useEffect(() => {
    setDraft((current) => current ?? stored ?? null);
    setSelectedId((current) => current ?? stored?.rootPieceId ?? null);
  }, [stored]);

  const problems = useMemo(
    () => (draft ? projectProblems(draft) : []),
    [draft],
  );

  const edit = useCallback((change: (project: LegoProject) => LegoProject) => {
    setDraft((current) => (current ? change(current) : current));
    setDirty(true);
  }, []);

  function addPart(part: LegoPartInfo) {
    edit((project) => {
      // New pieces hang off whatever is selected, so building outward from a
      // hull section is the default rather than something to set up.
      const parentId = selectedId ?? project.rootPieceId;
      const pieceId = crypto.randomUUID();
      return {
        ...project,
        pieces: [
          ...project.pieces,
          {
            id: pieceId,
            name: uniquePieceName(
              part.shape,
              project.pieces.map((piece) => piece.name),
            ),
            parentId,
            partId: part.id,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
        ],
      };
    });
  }

  function addEmpty() {
    edit((project) => {
      const pieceId = crypto.randomUUID();
      return {
        ...project,
        pieces: [
          ...project.pieces,
          {
            id: pieceId,
            // Empty pieces are what become flares and aim points, so the
            // default name says what it is for.
            name: uniquePieceName(
              "point",
              project.pieces.map((piece) => piece.name),
            ),
            parentId: selectedId ?? project.rootPieceId,
            partId: null,
            position: [0, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
        ],
      };
    });
  }

  function removeSelected() {
    if (!draft || !selectedId || selectedId === draft.rootPieceId) return;
    const doomed = new Set(descendantIds(draft, selectedId));
    edit((project) => ({
      ...project,
      pieces: project.pieces.filter((piece) => !doomed.has(piece.id)),
    }));
    setSelectedId(draft.rootPieceId);
  }

  function renameSelected(name: string) {
    if (!selectedId) return;
    edit((project) => ({
      ...project,
      pieces: project.pieces.map((piece) =>
        piece.id === selectedId
          ? { ...piece, name: normalisePieceName(name) }
          : piece,
      ),
    }));
  }

  async function save() {
    if (!draft) return;
    setSaving(true);
    try {
      const written = await saveProject(draft);
      setDraft(written);
      setDirty(false);
      if (canvasRef.current) await saveThumbnail(written.id, canvasRef.current);
    } finally {
      setSaving(false);
    }
  }

  if (loading || !draft || !pack) {
    return (
      <p className="px-6 py-10 text-center text-sm text-muted-foreground">
        {loading ? "Opening the unit." : "This unit could not be opened."}
      </p>
    );
  }

  const selected = draft.pieces.find((piece) => piece.id === selectedId);

  return (
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <Blocks size={18} />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold leading-tight">
            {draft.name}
          </h1>
          <p className="truncate text-xs text-muted-foreground">
            {draft.pieces.length}{" "}
            {draft.pieces.length === 1 ? "piece" : "pieces"} · {draft.unitName}
          </p>
        </div>
        <Button className="ml-auto" onClick={save} disabled={!dirty || saving}>
          <Save size={16} /> {dirty ? "Save" : "Saved"}
        </Button>
      </header>

      {problems.length > 0 ? (
        <ul className="border-b border-border px-6 py-2 text-xs text-muted-foreground">
          {problems.map((problem) => (
            <li key={problem}>{problem}</li>
          ))}
        </ul>
      ) : null}

      <div className="flex min-h-0 flex-1">
        <div className="min-h-0 flex-1">
          <ModelViewport
            pack={pack}
            project={draft}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onReady={(canvas) => {
              canvasRef.current = canvas;
            }}
          />
        </div>

        <aside className="flex w-72 shrink-0 flex-col border-l border-border">
          <div className="flex items-center gap-1 border-b border-border px-3 py-2">
            <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Pieces
            </h2>
            <Button
              size="sm"
              variant="ghost"
              className="ml-auto"
              onClick={addEmpty}
              title="Add an empty piece, which is how flares and aim points are made"
            >
              <Plus size={14} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={removeSelected}
              disabled={!selectedId || selectedId === draft.rootPieceId}
              aria-label="Delete the selected piece"
            >
              <Trash2 size={14} />
            </Button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto py-1">
            <PieceTree
              project={draft}
              parentId={null}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          </div>

          {selected ? (
            <div className="border-t border-border px-3 py-2">
              <label
                className="text-xs text-muted-foreground"
                htmlFor="lego-piece-name"
              >
                Name
              </label>
              <Input
                id="lego-piece-name"
                value={selected.name}
                onChange={(event) => renameSelected(event.target.value)}
                className="mt-1"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                {selected.partId
                  ? "Geometry."
                  : "Empty, so it carries other pieces and can be an emit point."}
              </p>
            </div>
          ) : null}
        </aside>
      </div>

      <div className="h-56 shrink-0 border-t border-border">
        <PartPicker pack={pack} parts={pack.parts} onSelect={addPart} />
      </div>
    </div>
  );
}

/** The piece hierarchy, indented by depth. */
function PieceTree({
  project,
  parentId,
  selectedId,
  onSelect,
  depth = 0,
}: {
  project: LegoProject;
  parentId: string | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  depth?: number;
}) {
  return (
    <ul>
      {childrenOf(project, parentId).map((piece) => (
        <li key={piece.id}>
          <button
            type="button"
            onClick={() => onSelect(piece.id)}
            className={`flex w-full items-center gap-2 px-3 py-1 text-left text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              piece.id === selectedId
                ? "bg-primary/15 text-foreground"
                : "hover:bg-muted/50"
            }`}
            style={{ paddingLeft: 12 + depth * 14 }}
          >
            <span className="truncate">{piece.name}</span>
            {piece.partId ? null : (
              <span className="ml-auto text-xs text-muted-foreground">
                empty
              </span>
            )}
          </button>
          <PieceTree
            project={project}
            parentId={piece.id}
            selectedId={selectedId}
            onSelect={onSelect}
            depth={depth + 1}
          />
        </li>
      ))}
    </ul>
  );
}
