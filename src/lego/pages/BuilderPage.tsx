import { Button, Input, useHideSidebar } from "@picoframe/frame";
import { Blocks, PackagePlus, Plus, Save, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ROLES } from "../animPresets";
import { insertCompound, subtreeAsCompound } from "../compounds";
import { usePartFilter } from "../filter";
import {
  childrenOf,
  descendantIds,
  type LegoPiece,
  type LegoProject,
  normalisePieceName,
  projectProblems,
  uniquePieceName,
} from "../model";
import { type LegoPartInfo, type LoadedPack, loadPack } from "../pack";
import {
  deleteCompound,
  saveCompound,
  saveProject,
  saveThumbnail,
  useLegoCompounds,
  useLegoProjects,
} from "../projects";
import { canReparent, reparentPiece } from "../reparent";
import { AnimationPanel } from "./components/AnimationPanel";
import { CompoundPicker } from "./components/CompoundPicker";
import { ExportDrawer } from "./components/ExportDrawer";
import { ModelViewport } from "./components/ModelViewport";
import { NameInput } from "./components/NameInput";
import { NoMatches, PartFilters } from "./components/PartFilters";
import { PartPicker } from "./components/PartPicker";
import { PieceTree } from "./components/PieceTree";

/** Radix needs a non-empty value, so "no role" gets one of its own. */
const NO_ROLE = "none";

/**
 * Assemble one unit.
 *
 * The document is held in local state and written shortly after the last edit,
 * so a drag is not a hundred disk writes and leaving the page does not lose
 * work. The overview stays in step because saving goes through the shared store.
 */
export default function BuilderPage() {
  const { id } = useParams<{ id: string }>();
  // The viewport wants the width, and the nav stays reachable from the top bar.
  useHideSidebar();
  const { projects, loading } = useLegoProjects();
  const { compounds } = useLegoCompounds();
  const stored = projects.find((project) => project.id === id);

  const [pack, setPack] = useState<LoadedPack | null>(null);
  const [draft, setDraft] = useState<LegoProject | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [strip, setStrip] = useState<"parts" | "compounds">("parts");
  const [aside, setAside] = useState<"pieces" | "animation">("pieces");
  const [exporting, setExporting] = useState(false);
  const [playing, setPlaying] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const filter = usePartFilter(pack);

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

  // Write shortly after the last edit rather than on every one, so a drag is
  // not a hundred disk writes but navigating away never loses work. Leaving the
  // page saves immediately, because the timer dies with the component.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const persist = useCallback(async (project: LegoProject) => {
    setSaving(true);
    try {
      const written = await saveProject(project);
      setDirty(false);
      // The thumbnail comes from the live canvas, so it can only be refreshed
      // while the viewport is still mounted.
      if (canvasRef.current) await saveThumbnail(written.id, canvasRef.current);
    } finally {
      setSaving(false);
    }
  }, []);

  useEffect(() => {
    if (!dirty || !draft) return;
    const timer = setTimeout(() => void persist(draft), 800);
    return () => clearTimeout(timer);
  }, [dirty, draft, persist]);

  useEffect(() => {
    return () => {
      // Leaving before the timer fires still writes the document. The canvas is
      // already going, so this one cannot refresh the thumbnail.
      if (dirtyRef.current && draftRef.current)
        void saveProject(draftRef.current);
    };
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

  // The key handler is registered once, so it reaches the current selection
  // through a ref rather than the one it was created with.
  const removeSelectedRef = useRef(removeSelected);
  removeSelectedRef.current = removeSelected;

  // Backspace deletes the selected piece, which is what it does in every other
  // 3D tool. Without this the webview treats it as browser Back and the whole
  // page navigates away mid-edit.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      event.preventDefault();
      removeSelectedRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // The piece stays where it is on screen: only what carries it changes.
  function reparent(pieceId: string, parentId: string) {
    edit((project) => reparentPiece(project, pieceId, parentId));
  }

  async function saveSelectionAsCompound() {
    if (!draft || !selectedId) return;
    const compound = subtreeAsCompound(draft, selectedId, {
      id: crypto.randomUUID(),
      now: new Date().toISOString(),
      newId: () => crypto.randomUUID(),
    });
    if (!compound) return;
    await saveCompound(compound);
    // Showing where it went is the only confirmation the save needs.
    setStrip("compounds");
  }

  function addCompound(compound: LegoProject) {
    if (!draft) return;
    const inserted = insertCompound(
      draft,
      compound,
      selectedId ?? draft.rootPieceId,
      () => crypto.randomUUID(),
    );
    edit(() => inserted.project);
    setSelectedId(inserted.rootPieceId);
  }

  function transformPiece(pieceId: string, change: Partial<LegoPiece>) {
    edit((project) => ({
      ...project,
      pieces: project.pieces.map((piece) =>
        piece.id === pieceId ? { ...piece, ...change } : piece,
      ),
    }));
  }

  function renameUnit(name: string) {
    edit((project) => ({
      ...project,
      name,
      // The export name follows the title only while it has not been set to
      // something of its own, so a deliberate override is never overwritten.
      unitName:
        project.unitName === normalisePieceName(project.name)
          ? normalisePieceName(name)
          : project.unitName,
    }));
  }

  // Setting the export name by hand breaks its link to the title, because the
  // two no longer match and `renameUnit` only follows while they do.
  function renameExport(unitName: string) {
    edit((project) => ({ ...project, unitName }));
  }

  function setRole(pieceId: string, role: string | undefined) {
    edit((project) => ({
      ...project,
      pieces: project.pieces.map((piece) => {
        if (piece.id !== pieceId) return piece;
        const { role: _dropped, ...rest } = piece;
        return role ? { ...rest, role } : rest;
      }),
    }));
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
        <div className="min-w-0 flex-1">
          <Input
            value={draft.name}
            onChange={(event) => renameUnit(event.target.value)}
            aria-label="Unit name"
            className="h-7 border-transparent bg-transparent px-1 text-sm font-semibold hover:border-border focus-visible:border-border"
          />
          <p className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
            {draft.pieces.length}{" "}
            {draft.pieces.length === 1 ? "piece" : "pieces"} · exports as
            <NameInput
              value={draft.unitName}
              onCommit={renameExport}
              aria-label="Export name"
              className="h-6 w-48 border-transparent bg-transparent px-1 text-xs hover:border-border focus-visible:border-border"
            />
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {saving ? "Saving" : dirty ? "Unsaved changes" : "Saved"}
        </span>
        <Button
          variant="outline"
          onClick={() => draft && void persist(draft)}
          disabled={saving}
        >
          <Save size={16} /> Save now
        </Button>
        <Button onClick={() => setExporting(true)}>
          <Upload size={16} /> Export
        </Button>
      </header>

      <ExportDrawer
        open={exporting}
        onOpenChange={setExporting}
        project={draft}
        pack={pack}
        onRemember={(settings) =>
          edit((project) => ({ ...project, ...settings }))
        }
      />

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
            onTransform={transformPiece}
            playing={playing}
            onReady={(canvas) => {
              canvasRef.current = canvas;
            }}
          />
        </div>

        <aside className="flex w-72 shrink-0 flex-col border-l border-border">
          <div className="flex gap-1 border-b border-border px-3 py-2">
            <Button
              size="sm"
              variant={aside === "pieces" ? "default" : "ghost"}
              onClick={() => setAside("pieces")}
            >
              Pieces
            </Button>
            <Button
              size="sm"
              variant={aside === "animation" ? "default" : "ghost"}
              onClick={() => setAside("animation")}
            >
              Animation
            </Button>
          </div>

          {aside === "animation" ? (
            <AnimationPanel
              project={draft}
              playing={playing}
              onPlayingChange={setPlaying}
              onChange={(animations) =>
                edit((project) => ({ ...project, animations }))
              }
            />
          ) : (
            <>
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
                  onClick={() => void saveSelectionAsCompound()}
                  disabled={!selectedId}
                  title="Save the selected piece and everything under it, to reuse in another unit"
                  aria-label="Save the selection as a compound"
                >
                  <PackagePlus size={14} />
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
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  onReparent={reparent}
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
                  <NameInput
                    id="lego-piece-name"
                    value={selected.name}
                    onCommit={renameSelected}
                    className="mt-1"
                  />
                  {selected.id === draft.rootPieceId ? null : (
                    // The same move as dragging a row onto another, for anyone not
                    // using a pointer.
                    <div className="mt-2">
                      <span className="text-xs text-muted-foreground">
                        Hangs off
                      </span>
                      <Select
                        value={selected.parentId ?? draft.rootPieceId}
                        onValueChange={(parentId) =>
                          reparent(selected.id, parentId)
                        }
                      >
                        <SelectTrigger
                          size="sm"
                          className="mt-1 w-full"
                          aria-label="Parent piece"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {parentOptions(draft, selected.id).map(
                            ({ piece, depth }) => (
                              <SelectItem
                                key={piece.id}
                                value={piece.id}
                                // Indent on the item, not inside its text: Radix
                                // mirrors the text into the trigger, and the
                                // padding would come with it.
                                style={{ paddingLeft: 8 + depth * 12 }}
                              >
                                {piece.name}
                              </SelectItem>
                            ),
                          )}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  <div className="mt-2">
                    <span className="text-xs text-muted-foreground">Role</span>
                    <Select
                      value={selected.role ?? NO_ROLE}
                      onValueChange={(role) =>
                        setRole(
                          selected.id,
                          role === NO_ROLE ? undefined : role,
                        )
                      }
                    >
                      <SelectTrigger
                        size="sm"
                        className="mt-1 w-full"
                        aria-label="Animation role"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NO_ROLE}>None</SelectItem>
                        {ROLES.map((role) => (
                          <SelectItem key={role.id} value={role.id}>
                            {role.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      What this piece is, so the animation presets know what to
                      move.
                    </p>
                  </div>

                  <p className="mt-2 text-xs text-muted-foreground">
                    {selected.partId
                      ? "Geometry."
                      : "Empty, so it carries other pieces and can be an emit point."}
                  </p>
                </div>
              ) : null}
            </>
          )}
        </aside>
      </div>

      <div className="flex h-72 shrink-0 flex-col border-t border-border">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <div className="flex gap-1">
            <Button
              size="sm"
              variant={strip === "parts" ? "default" : "ghost"}
              onClick={() => setStrip("parts")}
            >
              Parts
            </Button>
            <Button
              size="sm"
              variant={strip === "compounds" ? "default" : "ghost"}
              onClick={() => setStrip("compounds")}
            >
              Compounds
            </Button>
          </div>
          {strip === "parts" ? (
            <PartFilters
              pack={pack}
              query={filter.query}
              onQuery={filter.setQuery}
              colourway={filter.colourway}
              onColourway={filter.setColourway}
              shown={filter.parts.length}
              className="flex-1"
            />
          ) : null}
        </div>

        {/* Flex, not block: the picker sizes itself with flex-1 and its contents
            are absolutely positioned, so in a block parent it collapses to
            nothing and the panel looks empty. */}
        <div className="flex min-h-0 flex-1">
          {strip === "compounds" ? (
            <CompoundPicker
              pack={pack}
              compounds={compounds}
              onInsert={addCompound}
              onDelete={(compoundId) => void deleteCompound(compoundId)}
            />
          ) : filter.parts.length === 0 ? (
            <NoMatches />
          ) : (
            <PartPicker pack={pack} parts={filter.parts} onSelect={addPart} />
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Every piece that could carry `pieceId`, in tree order and with its depth.
 *
 * The picker reads as the hierarchy it is choosing from, rather than a flat
 * list in which two pieces called `barrel` are indistinguishable.
 */
function parentOptions(
  project: LegoProject,
  pieceId: string,
): { piece: LegoPiece; depth: number }[] {
  const options: { piece: LegoPiece; depth: number }[] = [];
  const visit = (parentId: string | null, depth: number) => {
    for (const child of childrenOf(project, parentId)) {
      if (canReparent(project, pieceId, child.id)) {
        options.push({ piece: child, depth });
      }
      visit(child.id, depth + 1);
    }
  };
  visit(null, 0);
  return options;
}
