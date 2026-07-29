import { Button, Input, useHideSidebar } from "@picoframe/frame";
import {
  Blocks,
  ChevronDown,
  ChevronUp,
  ClipboardPaste,
  Copy,
  PackagePlus,
  Plus,
  Redo,
  Rocket,
  Save,
  Trash2,
  Undo,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router";

import { ButtonGroup } from "@/components/ui/button-group";
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
import { currentPivot, pivotChoices, setPivot } from "../pivot";
import {
  deleteCompound,
  saveCompound,
  saveProject,
  saveThumbnail,
  useLegoCompounds,
  useLegoProjects,
} from "../projects";
import { canReparent, reparentPiece } from "../reparent";
import { sitOnGround } from "../s3oBuild";
import { AnimationPanel } from "./components/AnimationPanel";
import { CompoundPicker } from "./components/CompoundPicker";
import { ExportDrawer } from "./components/ExportDrawer";
import { ModelViewport } from "./components/ModelViewport";
import { NameInput } from "./components/NameInput";
import { NoMatches, PartFilters } from "./components/PartFilters";
import { PartPicker } from "./components/PartPicker";
import { PieceTree } from "./components/PieceTree";
import { TestDrawer } from "./components/TestDrawer";
import { TransformFields } from "./components/TransformFields";

/** Radix needs a non-empty value, so "no role" gets one of its own. */
const NO_ROLE = "none";

/** Undo steps kept. Whole documents, but a unit is a few hundred numbers. */
const HISTORY_LIMIT = 60;
/** Edits closer together than this are one gesture, so they undo together. */
const COALESCE_MS = 400;

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
  const [stripOpen, setStripOpen] = useState(true);
  /** A lifted subtree waiting to be pasted. In memory, not the OS clipboard. */
  const [clipboard, setClipboard] = useState<LegoProject | null>(null);
  const [aside, setAside] = useState<"pieces" | "animation">("pieces");
  const [exporting, setExporting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [playing, setPlaying] = useState(false);
  /** A preference, not part of the unit, so it lives with the session. */
  const [uniformScale, setUniformScale] = useState(true);
  const captureRef = useRef<(() => HTMLCanvasElement) | null>(null);
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

  // Write shortly after the last edit rather than on every one, so a drag is
  // not a hundred disk writes but navigating away never loses work. Leaving the
  // page saves immediately, because the timer dies with the component.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  /**
   * Undo history: whole documents, not a log of operations.
   *
   * A unit is small and every edit already returns a fresh one, so keeping
   * copies costs little and cannot drift from the operations the way a replay
   * log can. Bounded, because a long session should not grow without end.
   */
  const [past, setPast] = useState<LegoProject[]>([]);
  const [future, setFuture] = useState<LegoProject[]>([]);
  const lastEditAt = useRef(0);

  const edit = useCallback((change: (project: LegoProject) => LegoProject) => {
    const current = draftRef.current;
    if (!current) return;
    const next = change(current);
    if (next === current) return;

    // Edits in quick succession are one gesture. Dragging a slider should undo
    // in a single step, not sixty.
    const now = Date.now();
    const continues = now - lastEditAt.current < COALESCE_MS;
    lastEditAt.current = now;

    setPast((entries) =>
      continues && entries.length > 0
        ? entries
        : [...entries, current].slice(-HISTORY_LIMIT),
    );
    setFuture([]);
    setDraft(next);
    setDirty(true);
  }, []);

  const undo = useCallback(() => {
    const current = draftRef.current;
    if (!current) return;
    setPast((entries) => {
      const previous = entries.at(-1);
      if (!previous) return entries;
      setFuture((ahead) => [...ahead, current]);
      setDraft(previous);
      setDirty(true);
      // The next edit starts a fresh step rather than folding into whatever
      // was being done before the undo.
      lastEditAt.current = 0;
      return entries.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    const current = draftRef.current;
    if (!current) return;
    setFuture((ahead) => {
      const next = ahead.at(-1);
      if (!next) return ahead;
      setPast((entries) => [...entries, current]);
      setDraft(next);
      setDirty(true);
      lastEditAt.current = 0;
      return ahead.slice(0, -1);
    });
  }, []);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const persist = useCallback(async (project: LegoProject) => {
    setSaving(true);
    try {
      const written = await saveProject(project);
      setDirty(false);
      // Draw a fresh frame and copy it in the same breath. The viewport's
      // drawing buffer is gone the moment its frame is composited, so a
      // thumbnail taken from the canvas at any other time is blank.
      const capture = captureRef.current;
      if (capture) await saveThumbnail(written.id, capture());
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
  const shortcutsRef = useRef({
    remove: removeSelected,
    undo,
    redo,
    copy: () => {},
    paste: () => {},
    duplicate: () => {},
  });

  // Backspace deletes the selected piece, which is what it does in every other
  // 3D tool. Without this the webview treats it as browser Back and the whole
  // page navigates away mid-edit.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      // Never steal a key from a field. Undo in a text box is the browser's.
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }

      const shortcuts = shortcutsRef.current;
      const command = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();

      if (command && key === "z") {
        event.preventDefault();
        if (event.shiftKey) shortcuts.redo();
        else shortcuts.undo();
        return;
      }
      if (command && key === "y") {
        event.preventDefault();
        shortcuts.redo();
        return;
      }
      if (command && key === "c") {
        event.preventDefault();
        shortcuts.copy();
        return;
      }
      if (command && key === "v") {
        event.preventDefault();
        shortcuts.paste();
        return;
      }
      if (command && key === "d") {
        event.preventDefault();
        shortcuts.duplicate();
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        shortcuts.remove();
      }
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

  function movePivot(pieceId: string, pivot: [number, number, number]) {
    edit((project) => setPivot(project, pieceId, pivot));
  }

  /**
   * Copy, paste and duplicate are the compound machinery without the file.
   * A subtree lifted out and put back is the same operation whether it goes
   * via the clipboard or straight back into the unit.
   */
  function lift(pieceId: string): LegoProject | null {
    if (!draft) return null;
    return subtreeAsCompound(draft, pieceId, {
      id: crypto.randomUUID(),
      now: new Date().toISOString(),
      newId: () => crypto.randomUUID(),
    });
  }

  function drop(cutting: LegoProject, parentId: string) {
    if (!draft) return;
    const inserted = insertCompound(draft, cutting, parentId, () =>
      crypto.randomUUID(),
    );
    edit(() => inserted.project);
    setSelectedId(inserted.rootPieceId);
  }

  function copySelection() {
    if (!selectedId) return;
    setClipboard(lift(selectedId));
  }

  function pasteClipboard() {
    if (!clipboard || !draft) return;
    drop(clipboard, selectedId ?? draft.rootPieceId);
  }

  function duplicateSelection() {
    if (!draft || !selectedId || selectedId === draft.rootPieceId) return;
    const cutting = lift(selectedId);
    // Alongside the original rather than inside it, which is what duplicate
    // means everywhere else.
    const parentId =
      draft.pieces.find((piece) => piece.id === selectedId)?.parentId ??
      draft.rootPieceId;
    if (cutting) drop(cutting, parentId);
  }

  // Rebound every render, so a shortcut always runs against the current
  // selection rather than the one the listener was created with.
  shortcutsRef.current = {
    remove: removeSelected,
    undo,
    redo,
    copy: copySelection,
    paste: pasteClipboard,
    duplicate: duplicateSelection,
  };

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
  // Empty pieces have no part, so no bounding box to offer pivots from. They
  // are already a bare point, which is its own pivot.
  const selectedPart = selected?.partId
    ? (pack.byId.get(selected.partId) ?? null)
    : null;

  return (
    <div className="flex h-full flex-col">
      <ExportDrawer
        open={exporting}
        onOpenChange={setExporting}
        project={draft}
        pack={pack}
        onRemember={(settings) =>
          edit((project) => ({ ...project, ...settings }))
        }
      />

      <TestDrawer
        open={testing}
        onOpenChange={setTesting}
        project={draft}
        pack={pack}
      />

      <div className="flex min-h-0 flex-1">
        {/* The unit's chrome floats over the view rather than taking a strip
            off the top of it. The 3D is the point of this screen. */}
        <div className="relative min-h-0 flex-1">
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3">
            <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-2 py-1.5 backdrop-blur">
              <Blocks size={16} className="shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <Input
                  value={draft.name}
                  onChange={(event) => renameUnit(event.target.value)}
                  aria-label="Unit name"
                  className="h-6 border-transparent bg-transparent px-1 text-sm font-semibold hover:border-border focus-visible:border-border"
                />
                <p className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
                  {draft.pieces.length}{" "}
                  {draft.pieces.length === 1 ? "piece" : "pieces"} · exports as
                  <NameInput
                    value={draft.unitName}
                    onCommit={renameExport}
                    aria-label="Export name"
                    className="h-5 w-40 border-transparent bg-transparent px-1 text-xs hover:border-border focus-visible:border-border"
                  />
                </p>
              </div>
            </div>

            <div className="pointer-events-auto flex items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-2 py-1.5 backdrop-blur">
              <ButtonGroup>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={undo}
                  disabled={past.length === 0}
                  aria-label="Undo"
                  title="Undo (Cmd Z)"
                >
                  <Undo size={14} />
                </Button>
                <Button
                  size="icon"
                  variant="outline"
                  onClick={redo}
                  disabled={future.length === 0}
                  aria-label="Redo"
                  title="Redo (Cmd Shift Z)"
                >
                  <Redo size={14} />
                </Button>
              </ButtonGroup>
              <span className="text-xs text-muted-foreground">
                {saving ? "Saving" : dirty ? "Unsaved changes" : "Saved"}
              </span>
              <Button
                size="sm"
                variant="outline"
                onClick={() => draft && void persist(draft)}
                disabled={saving}
              >
                <Save size={14} /> Save
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setTesting(true)}
              >
                <Rocket size={14} /> Test in game
              </Button>
              <Button size="sm" onClick={() => setExporting(true)}>
                <Upload size={14} /> Export
              </Button>
            </div>
          </div>

          {problems.length > 0 ? (
            <ul className="pointer-events-none absolute inset-x-0 top-20 z-10 mx-auto w-fit max-w-[80%] rounded-md border border-amber-500/40 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
              {problems.map((problem) => (
                <li key={problem}>{problem}</li>
              ))}
            </ul>
          ) : null}

          <ModelViewport
            pack={pack}
            project={draft}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onTransform={transformPiece}
            playing={playing}
            uniformScale={uniformScale}
            onGround={() => edit((project) => sitOnGround(project, pack))}
            onReady={(capture) => {
              captureRef.current = capture;
            }}
          />
        </div>

        <aside className="flex w-72 shrink-0 flex-col border-l border-border">
          <ButtonGroup className="m-2">
            <Button
              size="sm"
              variant={aside === "pieces" ? "default" : "outline"}
              onClick={() => setAside("pieces")}
              aria-pressed={aside === "pieces"}
            >
              Pieces
            </Button>
            <Button
              size="sm"
              variant={aside === "animation" ? "default" : "outline"}
              onClick={() => setAside("animation")}
              aria-pressed={aside === "animation"}
            >
              Animation
            </Button>
          </ButtonGroup>

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
                  onClick={duplicateSelection}
                  disabled={!selectedId || selectedId === draft.rootPieceId}
                  title="Duplicate the selected piece and everything under it (Cmd D)"
                  aria-label="Duplicate the selection"
                >
                  <Copy size={14} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={pasteClipboard}
                  disabled={!clipboard}
                  title="Paste under the selected piece (Cmd V)"
                  aria-label="Paste"
                >
                  <ClipboardPaste size={14} />
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

              <div className="relative min-h-32 flex-1">
                <div className="h-full overflow-y-auto py-1">
                  <PieceTree
                    project={draft}
                    selectedId={selectedId}
                    onSelect={setSelectedId}
                    onReparent={reparent}
                  />
                </div>
                {/* Fades the last row rather than clipping it mid-line, so a
                    partly visible row reads as "more below" rather than a
                    rendering fault. */}
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-background to-transparent"
                />
              </div>

              {selected ? (
                // Capped and scrollable. The panel grew as pieces gained a
                // parent, a pivot and a role, and without a limit it squeezed
                // the tree above it down to a single clipped row.
                <div className="max-h-[55%] shrink-0 overflow-y-auto border-t border-border px-3 py-2">
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

                  <TransformFields
                    piece={selected}
                    onChange={(change) => transformPiece(selected.id, change)}
                    uniformScale={uniformScale}
                    onUniformScaleChange={setUniformScale}
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

                  {selectedPart ? (
                    <div className="mt-2">
                      <span className="text-xs text-muted-foreground">
                        Turns about
                      </span>
                      <Select
                        value={
                          currentPivot(selectedPart, selected.pivot) ?? "middle"
                        }
                        onValueChange={(id) => {
                          const choice = pivotChoices(selectedPart).find(
                            (option) => option.id === id,
                          );
                          if (choice) movePivot(selected.id, choice.position);
                        }}
                      >
                        <SelectTrigger
                          size="sm"
                          className="mt-1 w-full"
                          aria-label="Pivot point"
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {pivotChoices(selectedPart).map((choice) => (
                            <SelectItem key={choice.id} value={choice.id}>
                              {choice.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <p className="mt-1 text-xs text-muted-foreground">
                        The point this piece turns about, and that its children
                        hang from. A leg wants its top, not its middle.
                      </p>
                    </div>
                  ) : null}

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

      {/* Collapsible: most of a session is spent moving what is already there,
          not reaching for another part. */}
      <div
        className={`flex shrink-0 flex-col border-t border-border ${
          stripOpen ? "h-72" : ""
        }`}
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <Button
            size="icon"
            variant="ghost"
            onClick={() => setStripOpen(!stripOpen)}
            aria-expanded={stripOpen}
            aria-label={stripOpen ? "Hide the parts" : "Show the parts"}
          >
            {stripOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </Button>

          <ButtonGroup>
            <Button
              size="sm"
              variant={strip === "parts" ? "default" : "outline"}
              onClick={() => {
                setStrip("parts");
                setStripOpen(true);
              }}
              aria-pressed={strip === "parts"}
            >
              Parts
            </Button>
            <Button
              size="sm"
              variant={strip === "compounds" ? "default" : "outline"}
              onClick={() => {
                setStrip("compounds");
                setStripOpen(true);
              }}
              aria-pressed={strip === "compounds"}
            >
              Compounds
            </Button>
          </ButtonGroup>

          {stripOpen && strip === "parts" ? (
            <PartFilters
              pack={pack}
              query={filter.query}
              onQuery={filter.setQuery}
              category={filter.category}
              onCategory={filter.setCategory}
              shown={filter.parts.length}
              className="flex-1"
            />
          ) : null}
        </div>

        {/* Flex, not block: the picker sizes itself with flex-1 and its contents
            are absolutely positioned, so in a block parent it collapses to
            nothing and the panel looks empty. */}
        {stripOpen ? (
          <div className="flex min-h-0 flex-1 border-t border-border">
            {strip === "compounds" ? (
              <CompoundPicker
                pack={pack}
                compounds={compounds}
                onInsert={addCompound}
                onDelete={(compoundId) => void deleteCompound(compoundId)}
                onRename={(compound, name) =>
                  void saveCompound({ ...compound, name })
                }
              />
            ) : filter.parts.length === 0 ? (
              <NoMatches />
            ) : (
              <PartPicker pack={pack} parts={filter.parts} onSelect={addPart} />
            )}
          </div>
        ) : null}
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
