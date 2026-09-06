import { Button, cn, Input, useHideSidebar } from "@picoframe/frame";
import {
  Blocks,
  ChevronDown,
  ChevronUp,
  Copy,
  FlipHorizontal2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo,
  Rocket,
  Save,
  Undo,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";

import { ButtonGroup } from "@/components/ui/button-group";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { notify } from "@/notify/notify";
import { aimPoint } from "../aimPoint";
import { addAnchor, removeAnchor, updateAnchor } from "../anchors";
import { ROLES, restAngleWarnings } from "../animPresets";
import { unitAtlas } from "../atlas";
import { legoTexturePrune } from "../bindings";
import { parseClipboardPiece, serializeClipboardPiece } from "../clipboard";
import { reanchorCollisionVolume } from "../collisionVolume";
import { selectionAsCompound } from "../compounds";
import { usePartFilter } from "../filter";
import {
  applyGroupTransform,
  type PieceTransform,
  transformRoots,
} from "../groupTransform";
import { canMirror, mirrorCopy, mirrorPiece } from "../mirror";
import {
  descendantIds,
  type LegoImported,
  type LegoPiece,
  type LegoProject,
  normalisePieceName,
  projectProblems,
  uniquePieceName,
} from "../model";
import {
  type LegoPartInfo,
  type LoadedPack,
  loadPack,
  projectPackProblems,
} from "../pack";
import { usePanelOpen } from "../panels";
import { buildPieceCollisionScript } from "../pieceCollisionScript";
import { currentPivot, pivotChoices, setPivot } from "../pivot";
import {
  deleteCompound,
  saveCompound,
  useLegoCompounds,
  useLegoProjects,
} from "../projects";
import { rawGeometryProblems } from "../rawGeometry";
import { texturesInUse } from "../rawImport";
import { parentOptions, reparentPiece } from "../reparent";
import { bakedPieces, sitOnGround, unitBounds } from "../s3oBuild";
import type { ScriptTimeline } from "../scriptPlayback";
import { shortcutLabel } from "../shortcuts";
import { useEditShortcuts } from "../useEditShortcuts";
import { useLegoDocument } from "../useLegoDocument";
import { useRawGeometry } from "../useRawGeometry";
import { useSymmetry } from "../useSymmetry";
import { AimPointPanel } from "./components/AimPointPanel";
import { AnchorList } from "./components/AnchorList";
import { AnimationPanel } from "./components/AnimationPanel";
import { AtlasPicker } from "./components/AtlasPicker";
import { CollisionPanel } from "./components/CollisionPanel";
import { CompoundPicker } from "./components/CompoundPicker";
import { ExportDrawer } from "./components/ExportDrawer";
import { ModelViewport } from "./components/ModelViewport";
import { NameInput } from "./components/NameInput";
import { NoMatches, PartFilters } from "./components/PartFilters";
import { PartPicker } from "./components/PartPicker";
import { pickedCollisionPiece } from "./components/PieceCollisionFields";
import { PieceTree } from "./components/PieceTree";
import { SetPanel } from "./components/SetPanel";
import { TestDrawer } from "./components/TestDrawer";
import { TexturePicker } from "./components/TexturePicker";
import { TransformFields } from "./components/TransformFields";

/** Radix needs a non-empty value, so "no role" gets one of its own. */
const NO_ROLE = "none";

/**
 * Assemble one unit.
 *
 * The layout. The document itself, its history, its selection, its clipboard
 * and its saving are `useLegoDocument`.
 */
export default function BuilderPage() {
  const { id } = useParams<{ id: string }>();
  // The viewport wants the width, and the nav stays reachable from the top bar.
  useHideSidebar();
  // Keyed by id: `lego/:id` has no key of its own, so switching units without a
  // reload (a client-side route change) would otherwise leave React's state
  // pointed at whichever unit was open first. Remounting on id change is what
  // makes the document, its undo history, its selection and its clipboard
  // start clean for the unit actually named in the URL.
  return <Builder key={id} id={id} />;
}

function Builder({ id }: { id: string | undefined }) {
  const doc = useLegoDocument(id);
  const { edit, selectedId, selectedIds, select: setSelectedId } = doc;
  const draft = doc.project;
  const { compounds } = useLegoCompounds();
  // Only for the keep-set when a texture changes: the store is shared, so
  // nothing can decide a key is dead by looking at one unit.
  const { projects } = useLegoProjects();

  const [pack, setPack] = useState<LoadedPack | null>(null);
  // The meshes of a unit imported from somebody else's model. Read once
  // alongside the document, and null for a unit built out of parts.
  const geometry = useRawGeometry(draft);
  const raw = geometry.raw;
  // A unit imported whole has no parts and no atlas, so the parts library, the
  // compound library and the atlas picker are all hidden for it. Its UVs point
  // onto its own texture rather than onto the pack's sheet, so a part dropped
  // into it would sample the wrong image and nothing could put that right.
  const imported = draft?.imported ?? null;
  const [strip, setStrip] = useState<"parts" | "compounds">("parts");
  // Open or closed is remembered between runs. Which tab is showing is not, so
  // the side panel always comes back on Pieces. See `../panels`.
  const [stripOpen, setStripOpen] = usePanelOpen("strip");
  const [asideOpen, setAsideOpen] = usePanelOpen("aside");
  const [aside, setAside] = useState<
    "pieces" | "animation" | "collision" | "aim"
  >("pieces");
  const [exporting, setExporting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [playing, setPlaying] = useState(false);
  /**
   * What playing means for a unit that owns its script: the poses a run of that
   * script produced, rather than the presets it no longer has.
   */
  const [scriptTimeline, setScriptTimeline] = useState<ScriptTimeline | null>(
    null,
  );
  /**
   * Whether a script run's clock is frozen on `scriptFrame` rather than
   * advancing, and the frame it is either frozen on or, while running,
   * reported to be showing.
   */
  const [scriptPaused, setScriptPaused] = useState(false);
  const [scriptFrame, setScriptFrame] = useState(0);
  /** A preference, not part of the unit, so it lives with the session. */
  const [uniformScale, setUniformScale] = useState(true);
  /** Shared between the viewport and the tree, so hovering a piece in either
   *  highlights it in the other. */
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  /** Whether the next click in the viewport drops a snap anchor. */
  const [placingAnchor, setPlacingAnchor] = useState(false);
  /**
   * Symmetry mode: a piece added now gets a mirrored twin the first time it is
   * put somewhere off the centre line, and the twin then follows it for as long
   * as it stays selected. A preference for the session, like the scale lock
   * above, rather than something the unit carries. See `../useSymmetry`.
   */
  const symmetry = useSymmetry({ project: draft, selectedIds, edit });
  const { queueTwin, place } = symmetry;
  const filter = usePartFilter(pack);

  useEffect(() => {
    loadPack().then(setPack, () => setPack(null));
  }, []);

  // The document's own problems, plus anything wrong between it and the packs
  // installed. Both are things to say rather than reasons to refuse the unit.
  const problems = useMemo(
    () =>
      draft
        ? [
            ...projectProblems(draft),
            // A unit imported whole names no parts and no atlas, so the pack
            // has nothing to say about it. Its own geometry does.
            ...(draft.imported
              ? [
                  ...(geometry.error ? [geometry.error] : []),
                  ...geometry.missingTextures,
                  ...rawGeometryProblems(draft.pieces, geometry.raw),
                ]
              : pack
                ? projectPackProblems(draft, pack)
                : []),
          ]
        : [],
    [draft, pack, geometry.error, geometry.raw, geometry.missingTextures],
  );

  function addPart(part: LegoPartInfo) {
    const pieceId = crypto.randomUUID();
    edit((project) => {
      // New pieces hang off whatever is selected, so building outward from a
      // hull section is the default rather than something to set up.
      const parentId = selectedId ?? project.rootPieceId;
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
    queueTwin(pieceId);
  }

  function addEmpty() {
    const pieceId = crypto.randomUUID();
    edit((project) => {
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
    queueTwin(pieceId);
  }

  function removeSelected() {
    if (!draft) return;
    // Everything selected goes, and everything under it. The root stays: it is
    // the unit rather than a piece in it.
    const doomed = new Set(
      selectedIds
        .filter((pieceId) => pieceId !== draft.rootPieceId)
        .flatMap((pieceId) => descendantIds(draft, pieceId)),
    );
    if (doomed.size === 0) return;
    edit((project) => ({
      ...project,
      pieces: project.pieces.filter((piece) => !doomed.has(piece.id)),
    }));
    // The edit above already reseats the selection to the removed pieces'
    // parents, since they are no longer in the resulting project.
  }

  /**
   * A plain click replaces the selection, Shift or Cmd adds to it or takes it
   * out again. A modified click that hit nothing leaves the set alone: it was
   * aimed at a piece and missed, not at clearing what is already there.
   */
  function selectPiece(pieceId: string | null, additive = false) {
    if (!additive) setSelectedId(pieceId);
    else if (pieceId) doc.toggleSelect(pieceId);
  }

  // The pieces stay where they are on screen: only what carries them changes.
  function reparentAll(pieceIds: string[], parentId: string) {
    edit((project) =>
      pieceIds.reduce(
        (next, moved) => reparentPiece(next, moved, parentId),
        project,
      ),
    );
  }

  // Dragging a row that is itself selected carries the whole selection, which
  // is what dragging one of several selected things means everywhere else.
  function reparent(pieceId: string, parentId: string) {
    reparentAll(
      draft && selectedIds.includes(pieceId)
        ? transformRoots(draft, selectedIds)
        : [pieceId],
      parentId,
    );
  }

  async function saveSelectionAsCompound() {
    if (!draft) return;
    const compound = selectionAsCompound(draft, selectedIds, {
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
    const inserted = doc.insert(compound, selectedId ?? draft.rootPieceId);
    if (inserted.length === 0) return;
    doc.selectMany(inserted);
    for (const pieceId of inserted) queueTwin(pieceId);
  }

  function transformPiece(pieceId: string, change: Partial<LegoPiece>) {
    // Where a placement lands, whether it came from the gizmo or from typing a
    // number into the panel, so symmetry only has to watch this one spot.
    place([pieceId], (project) => ({
      ...project,
      pieces: project.pieces.map((piece) =>
        piece.id === pieceId ? { ...piece, ...change } : piece,
      ),
    }));
  }

  /** A whole set moved at once, so it is one edit and one undo step. */
  function transformPieces(changes: Map<string, PieceTransform>) {
    place([...changes.keys()], (project) =>
      applyGroupTransform(project, changes),
    );
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

  // The base pack's atlas is stored as no atlas at all, the same way `role` and
  // `hidden` are dropped rather than written empty. Nothing else changes: every
  // part is mapped into every atlas, so the pieces are untouched.
  function setAtlas(atlas: string | undefined) {
    edit((project) => {
      const { atlas: _dropped, ...rest } = project;
      return atlas ? { ...rest, atlas } : rest;
    });
  }

  /**
   * Point an imported unit at a different texture, or at a re-read of the same
   * file after it was edited elsewhere.
   *
   * An ordinary edit, so undo takes it back, and nothing else moves: the
   * geometry, its UVs, the camera and the selection are all untouched.
   *
   * The prune afterwards is because the store is content addressed. A refreshed
   * texture is new bytes under a new key, so the version before it is left
   * behind, and a session of edits on an 8 MiB texture would otherwise be
   * hundreds of megabytes of dead files.
   *
   * The keep-set is worked out here rather than inside the edit. `edit`
   * dispatches to a reducer, which runs on the next render, so anything read
   * out of it would still be the old document when the prune goes out and the
   * texture just chosen would be swept away the moment it arrived. It is every
   * saved unit's keys plus the two this unit now has, since this unit's own
   * document is not written until the autosave a moment later.
   */
  function changeTextures(change: Partial<LegoImported>) {
    const current = draft?.imported;
    if (!current) return;
    const next = { ...current, ...change };
    edit((project) =>
      project.imported
        ? { ...project, imported: { ...project.imported, ...change } }
        : project,
    );
    void legoTexturePrune({
      keep: [
        ...texturesInUse(projects),
        ...[next.texture, next.texture2].flatMap((texture) =>
          texture?.key ? [texture.key] : [],
        ),
      ],
    }).catch(() => {
      // A store that could not be swept is a disk-space question rather than a
      // correctness one, and the unit is already pointing at the new texture.
    });
  }

  function movePivot(pieceId: string, pivot: [number, number, number]) {
    edit((project) => setPivot(project, pieceId, pivot));
  }

  // Placing is one anchor at a time: the click is aimed at a spot, and staying
  // armed afterwards would put a second anchor wherever the next click landed.
  function placeAnchor(pieceId: string, position: [number, number, number]) {
    edit((project) =>
      addAnchor(project, pieceId, position, crypto.randomUUID()),
    );
    setPlacingAnchor(false);
    // The panel follows the piece the anchor landed on, which is not
    // necessarily the one that was selected when the click was armed.
    setSelectedId(pieceId);
  }

  // Only while armed, so Escape keeps whatever it means everywhere else.
  useEffect(() => {
    if (!placingAnchor) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPlacingAnchor(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [placingAnchor]);

  async function copySelection() {
    const lifted = doc.lift(selectedIds);
    if (!lifted) return;
    try {
      await navigator.clipboard.writeText(serializeClipboardPiece(lifted));
    } catch (e) {
      void notify({
        title: "Couldn't copy to the clipboard",
        body: e instanceof Error ? e.message : String(e),
        level: "error",
      });
    }
  }

  async function pasteClipboard() {
    if (!draft || !pack) return;

    let text: string;
    try {
      text = await navigator.clipboard.readText();
    } catch (e) {
      void notify({
        title: "Couldn't read the clipboard",
        body: e instanceof Error ? e.message : String(e),
        level: "error",
      });
      return;
    }

    const knownPartIds = new Set(pack.parts.map((part) => part.id));
    const result = parseClipboardPiece(text, knownPartIds);
    if (!result.ok) {
      void notify({
        title: "Couldn't paste",
        body: result.reason,
        level: "error",
      });
      return;
    }
    if (result.piece.missingParts.length > 0) {
      const count = result.piece.missingParts.length;
      void notify({
        title: `Pasted, but ${count} ${count === 1 ? "piece isn't" : "pieces aren't"} in this pack and won't show geometry until reassigned.`,
        level: "warning",
      });
    }

    const inserted = doc.insert(
      result.piece.project,
      selectedId ?? draft.rootPieceId,
    );
    if (inserted.length === 0) return;
    doc.selectMany(inserted);
    for (const pieceId of inserted) queueTwin(pieceId);
  }

  function duplicateSelection() {
    if (!draft) return;
    // The roots of the selection, so a piece selected alongside its own parent
    // is copied once, inside its parent's copy, rather than twice.
    const copies = doc.duplicate(transformRoots(draft, selectedIds));
    if (copies.length > 0) doc.selectMany(copies);
  }

  function mirrorSelection() {
    if (!selectedId) return;
    edit((project) => mirrorPiece(project, selectedId));
  }

  // A copy, because the case this is for is one leg becoming the other and the
  // first leg is meant to stay.
  function mirrorCopyOfSelection() {
    if (!draft || !selectedId) return;
    const copy = mirrorCopy(draft, selectedId, () => crypto.randomUUID());
    if (!copy) return;
    edit(() => copy.project);
    setSelectedId(copy.pieceId);
  }

  useEditShortcuts({
    remove: removeSelected,
    undo: doc.undo,
    redo: doc.redo,
    copy: copySelection,
    paste: pasteClipboard,
    duplicate: duplicateSelection,
    symmetry: () => symmetry.setOn(!symmetry.on),
  });

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

  // Editor only: `hidden` never reaches the export, so this is the only
  // reducer that touches it. Shown is the absence of the key, not `false`,
  // matching how `role` is dropped rather than written empty above.
  function toggleHidden(pieceId: string) {
    edit((project) => ({
      ...project,
      pieces: project.pieces.map((piece) => {
        if (piece.id !== pieceId) return piece;
        if (piece.hidden) {
          const { hidden: _dropped, ...rest } = piece;
          return rest;
        }
        return { ...piece, hidden: true };
      }),
    }));
  }

  // The collision panel's two readings, both of which walk every vertex in the
  // unit. Only worked out while that panel is open, so a keystroke anywhere
  // else in the builder does not pay for them.
  const collisionOpen = asideOpen && aside === "collision";
  const pieceCollisionLua = useMemo(
    () =>
      draft && pack && collisionOpen
        ? buildPieceCollisionScript(draft, bakedPieces(draft, pack, raw).pieces)
        : "",
    [draft, pack, raw, collisionOpen],
  );
  // The piece the viewport puts its collision handles on: whichever is
  // selected while the collision panel is open. Selecting a piece is the whole
  // gesture, rather than a switch on top of it, because picking the thing you
  // want to change is already how everything else in the builder works.
  //
  // Nothing selected leaves them on the unit's own volume, which is also the
  // way back from a piece.
  const collisionPieceId =
    draft && collisionOpen && selectedId
      ? pickedCollisionPiece(draft, selectedId)
      : null;

  /** Stop the preview. Whatever is on screen describes the unit before a script
   *  change: the presets it just stopped using, or the script it just left. */
  function stopPlayback() {
    setPlaying(false);
    setScriptTimeline(null);
    setScriptPaused(false);
    setScriptFrame(0);
  }

  if (doc.loading || !draft || !pack) {
    return (
      <p className="px-6 py-10 text-center text-sm text-muted-foreground">
        {doc.loading ? "Opening the unit." : "This unit could not be opened."}
      </p>
    );
  }

  // Declared past the guard above, since it measures the unit and there is no
  // pack to measure it against until then.
  const loaded = pack;

  /**
   * Put the unit's aim point somewhere, or hand it back to the bounding box.
   *
   * Shared by the aim panel's fields and by the viewport's drag handles: moving
   * the point drags two other things with it, and neither caller should be the
   * one that has to remember that.
   */
  function setAimPoint(mid: [number, number, number] | null) {
    edit((project) => {
      const bounds = unitBounds(project, loaded, raw);
      const from = aimPoint(project, bounds);
      const to = mid ?? bounds.mid;
      // A volume somebody fitted to the geometry is measured from the aim
      // point, so moving the point would drag it off. Its offsets absorb the
      // move instead.
      const held = project.collisionVolume
        ? {
            ...project,
            collisionVolume: reanchorCollisionVolume(
              project.collisionVolume,
              from,
              to,
            ),
          }
        : project;
      // A pinned radius came out of an imported header and was measured from
      // that header's own mid, so deciding the aim point here makes it stale.
      // Dropping it has the export measure a sphere round the point instead.
      const { radius: _stale, mid: _replaced, ...rest } = held;
      return mid ? { ...rest, mid } : rest;
    });
  }

  // What the drawers below draw parts and compounds with, so picking one is
  // not a guess about how it will actually look once it is on the unit.
  const drawAtlas = unitAtlas(draft, pack.library.atlases).drawWith;

  const selected = draft.pieces.find((piece) => piece.id === selectedId);
  // Empty pieces have no part, so no bounding box to offer pivots from. They
  // are already a bare point, which is its own pivot.
  const selectedPart = selected?.partId
    ? (pack.byId.get(selected.partId) ?? null)
    : null;

  return (
    // The side panel collapses for the same reason the parts drawer does: a
    // large unit is hard to see with 288px of panel beside it. It leaves no
    // rail behind, so the button that brings it back rides in the chrome
    // already floating over the view.
    <Collapsible asChild open={asideOpen} onOpenChange={setAsideOpen}>
      <div className="flex h-full flex-col">
        <ExportDrawer
          open={exporting}
          onOpenChange={setExporting}
          project={draft}
          pack={pack}
          raw={raw}
          onRemember={(settings) =>
            edit((project) => ({ ...project, ...settings }))
          }
        />

        <TestDrawer
          open={testing}
          onOpenChange={setTesting}
          project={draft}
          pack={pack}
          raw={raw}
        />

        <div className="flex min-h-0 flex-1">
          <div className="flex min-h-0 flex-1 flex-col">
            {/* The unit's chrome floats over the view rather than taking a strip
              off the top of it. The 3D is the point of this screen. */}
            <div className="relative min-h-0 flex-1">
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-start justify-between gap-3 p-3">
                <div className="pointer-events-auto flex min-w-0 items-center gap-2 rounded-lg border border-border/60 bg-background/80 px-2 py-1.5 backdrop-blur">
                  <Blocks
                    size={16}
                    className="shrink-0 text-muted-foreground"
                  />
                  <div className="min-w-0">
                    <Input
                      value={draft.name}
                      onChange={(event) => renameUnit(event.target.value)}
                      aria-label="Unit name"
                      className="h-6 border-transparent bg-transparent px-1 text-sm font-semibold hover:border-border focus-visible:border-border"
                    />
                    <p className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
                      {draft.pieces.length}{" "}
                      {draft.pieces.length === 1 ? "piece" : "pieces"} · exports
                      as
                      <NameInput
                        value={draft.unitName}
                        onCommit={renameExport}
                        aria-label="Export name"
                        className="h-5 w-40 border-transparent bg-transparent px-1 text-xs hover:border-border focus-visible:border-border"
                      />
                    </p>
                    {imported ? (
                      <TexturePicker
                        imported={imported}
                        onChange={changeTextures}
                      />
                    ) : (
                      <AtlasPicker
                        project={draft}
                        pack={pack}
                        onChange={setAtlas}
                      />
                    )}
                  </div>
                </div>

                {/* Icons only, and no card behind them: the same viewport
                  chrome as the toolbars in the other corners, rather than a
                  panel of labelled buttons sitting on top of the model. */}
                <TooltipProvider delayDuration={300}>
                  <div className="pointer-events-auto flex items-center gap-2">
                    <ButtonGroup>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={doc.undo}
                            disabled={!doc.canUndo}
                            aria-label="Undo"
                          >
                            <Undo size={14} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          Undo ({shortcutLabel("undo")})
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={doc.redo}
                            disabled={!doc.canRedo}
                            aria-label="Redo"
                          >
                            <Redo size={14} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          Redo ({shortcutLabel("redo")})
                        </TooltipContent>
                      </Tooltip>
                    </ButtonGroup>
                    <ButtonGroup>
                      {/* The save status was a word beside this button and is
                        now a dot on it: a mark while there is work not yet on
                        disk, gone once there isn't. The word itself survives
                        in the tooltip, which is where the difference between
                        saving and saved belongs. */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => doc.save()}
                            disabled={doc.saving}
                            className="relative"
                            aria-label="Save"
                          >
                            <Save size={14} />
                            {doc.dirty || doc.saving ? (
                              <span
                                aria-hidden
                                className={cn(
                                  "absolute right-1 top-1 size-2 rounded-full bg-amber-500",
                                  doc.saving && "motion-safe:animate-pulse",
                                )}
                              />
                            ) : null}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          {doc.saving
                            ? "Saving"
                            : doc.dirty
                              ? "Unsaved changes - save now"
                              : "Saved"}
                        </TooltipContent>
                      </Tooltip>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            variant="outline"
                            onClick={() => setTesting(true)}
                            aria-label="Test in game"
                          >
                            <Rocket size={14} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">
                          Test in game
                        </TooltipContent>
                      </Tooltip>
                      {/* The one filled button here, as it was the one filled
                        button before: without its label, colour is what still
                        says this is the thing you are working towards. */}
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            size="icon"
                            onClick={() => setExporting(true)}
                            aria-label="Export"
                          >
                            <Upload size={14} />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom">Export</TooltipContent>
                      </Tooltip>
                    </ButtonGroup>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <CollapsibleTrigger asChild>
                          <Button
                            size="icon"
                            variant="outline"
                            aria-label={
                              asideOpen
                                ? "Hide the side panel"
                                : "Show the side panel"
                            }
                          >
                            {asideOpen ? (
                              <PanelRightClose size={16} />
                            ) : (
                              <PanelRightOpen size={16} />
                            )}
                          </Button>
                        </CollapsibleTrigger>
                      </TooltipTrigger>
                      <TooltipContent side="bottom">
                        {asideOpen
                          ? "Hide the side panel"
                          : "Show the side panel"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </TooltipProvider>
              </div>

              {problems.length > 0 ? (
                // Below the unit's chrome card, which is three rows tall when a
                // unit has an atlas to choose.
                <ul className="pointer-events-none absolute inset-x-0 top-24 z-10 mx-auto w-fit max-w-[80%] rounded-md border border-amber-500/40 bg-background/90 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur">
                  {problems.map((problem) => (
                    <li key={problem}>{problem}</li>
                  ))}
                </ul>
              ) : null}

              <ModelViewport
                document={{ pack, raw, project: draft }}
                selection={{
                  selectedIds,
                  onSelect: selectPiece,
                  onTransform: transformPiece,
                  onTransformMany: transformPieces,
                  hoveredId,
                  onHover: setHoveredId,
                }}
                scriptPlayback={{
                  playing,
                  scriptTimeline,
                  scriptPaused,
                  scriptFrame,
                  onScriptFrame: setScriptFrame,
                }}
                uniformScale={uniformScale}
                onGround={() =>
                  edit((project) => sitOnGround(project, pack, raw))
                }
                onReady={doc.onCapture}
                pieceActions={{
                  onDuplicate: duplicateSelection,
                  canDuplicate: transformRoots(draft, selectedIds).length > 0,
                  onPaste: () => void pasteClipboard(),
                  onSaveAsCompound: () => void saveSelectionAsCompound(),
                  // Not for an imported unit: a compound is pieces made of
                  // parts, and one saved out of raw geometry would name
                  // meshes that only mean anything inside the unit they
                  // came from.
                  canSaveAsCompound: selectedIds.length > 0 && !imported,
                  onDelete: removeSelected,
                  canDelete: transformRoots(draft, selectedIds).length > 0,
                }}
                symmetry={{ on: symmetry.on, onChange: symmetry.setOn }}
                anchorPlacement={{
                  placingAnchor,
                  onPlaceAnchor: placeAnchor,
                  onCancelAnchor: () => setPlacingAnchor(false),
                }}
                // The panel is where a volume is read and changed, so opening it
                // is what puts the handles on the volume. Nothing else has to be
                // switched on, and closing it gives them back to the pieces.
                // Putting the whole side panel away closes it too, so the handles
                // never outlive the thing that explains them.
                editCollision={collisionOpen}
                onCollisionChange={(collisionVolume) =>
                  edit((project) => ({ ...project, collisionVolume }))
                }
                // The selected piece while this panel is open, and null the
                // rest of the time, which leaves the handles on the unit's own
                // volume. See `collisionPieceId`.
                editPieceCollisionId={collisionPieceId}
                onPieceCollisionVolumeChange={(pieceId, volume) =>
                  edit((project) => ({
                    ...project,
                    pieces: project.pieces.map((piece) =>
                      piece.id === pieceId
                        ? {
                            ...piece,
                            // A dragged box keeps whether anything hits the
                            // piece, which is the switch above it in the panel
                            // and not something a drag has an opinion about.
                            collision: {
                              hit: piece.collision?.hit !== false,
                              volume,
                            },
                          }
                        : piece,
                    ),
                  }))
                }
                // The same reasoning, for the marker the aim point panel is
                // about: opening the panel draws the point it is describing.
                showAimPoint={asideOpen && aside === "aim"}
                onAimChange={setAimPoint}
              />
            </div>

            {/* Hidden for an imported unit, which has no parts to reach for: its
              UVs point onto its own texture rather than onto the pack's sheet,
              so a part dropped into it would sample the wrong image and nothing
              here could put that right. Compounds go with it, being pieces made
              of parts. See https://github.com/tomjn/coilbox/issues/712.

              Collapsible otherwise: most of a session is spent moving what is
              already there, not reaching for another part. */}
            {imported ? null : (
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
                    {stripOpen ? (
                      <ChevronDown size={16} />
                    ) : (
                      <ChevronUp size={16} />
                    )}
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
                      packId={filter.packId}
                      onPackId={filter.setPackId}
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
                        atlas={drawAtlas}
                        onInsert={addCompound}
                        onDelete={(compoundId) =>
                          void deleteCompound(compoundId)
                        }
                        onRename={(compound, name) =>
                          void saveCompound({ ...compound, name })
                        }
                      />
                    ) : filter.parts.length === 0 ? (
                      <NoMatches />
                    ) : (
                      <PartPicker
                        pack={pack}
                        parts={filter.parts}
                        atlas={drawAtlas}
                        onSelect={addPart}
                      />
                    )}
                  </div>
                ) : null}
              </div>
            )}
          </div>

          <CollapsibleContent asChild>
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
                <Button
                  size="sm"
                  variant={aside === "collision" ? "default" : "outline"}
                  onClick={() => setAside("collision")}
                  aria-pressed={aside === "collision"}
                >
                  Collision
                </Button>
                <Button
                  size="sm"
                  variant={aside === "aim" ? "default" : "outline"}
                  onClick={() => setAside("aim")}
                  aria-pressed={aside === "aim"}
                >
                  Aim
                </Button>
              </ButtonGroup>

              {aside === "aim" ? (
                <AimPointPanel
                  project={draft}
                  pack={pack}
                  raw={raw}
                  onChange={setAimPoint}
                />
              ) : aside === "collision" ? (
                <CollisionPanel
                  project={draft}
                  pack={pack}
                  raw={raw}
                  onChange={(collisionVolume) =>
                    edit((project) => {
                      if (collisionVolume)
                        return { ...project, collisionVolume };
                      // Back on the derived volume, which is the absence of the key
                      // rather than a stored copy of what was derived.
                      const { collisionVolume: _dropped, ...rest } = project;
                      return rest;
                    })
                  }
                  onPieceCollisionChange={(on) =>
                    edit((project) => {
                      if (on) return { ...project, pieceCollision: true };
                      // Off is the engine's own default, so it is the absence
                      // of the key rather than a stored false.
                      const { pieceCollision: _off, ...rest } = project;
                      return rest;
                    })
                  }
                  onPieceSelectionChange={(on) =>
                    edit((project) => {
                      if (on) return { ...project, pieceSelection: true };
                      const { pieceSelection: _off, ...rest } = project;
                      return rest;
                    })
                  }
                  selectedId={selectedId}
                  onSelectPiece={(pieceId) => setSelectedId(pieceId)}
                  onPieceVolumeChange={(pieceId, collision) =>
                    edit((project) => ({
                      ...project,
                      pieces: project.pieces.map((piece) => {
                        if (piece.id !== pieceId) return piece;
                        if (collision) return { ...piece, collision };
                        // Back on the box the engine measures, which is the
                        // absence of the key rather than a stored copy of it.
                        const { collision: _dropped, ...rest } = piece;
                        return rest;
                      }),
                    }))
                  }
                  pieceScript={pieceCollisionLua}
                />
              ) : aside === "animation" ? (
                <AnimationPanel
                  project={draft}
                  playing={playing}
                  onPlayingChange={setPlaying}
                  onChange={(animations) =>
                    edit((project) => ({ ...project, animations }))
                  }
                  onScriptTimeline={setScriptTimeline}
                  scriptPaused={scriptPaused}
                  onScriptPausedChange={setScriptPaused}
                  scriptFrame={scriptFrame}
                  onScriptFrameChange={setScriptFrame}
                  onScriptChange={(script) => {
                    stopPlayback();
                    edit((project) => ({ ...project, script }));
                  }}
                  onBuilderChange={(builder) =>
                    edit((project) => ({ ...project, builder }))
                  }
                  onScriptRelease={() => {
                    stopPlayback();
                    edit((project) => {
                      // Back on a generated script, which is the absence of the
                      // key rather than a stored copy of what was generated.
                      const { script: _dropped, ...rest } = project;
                      return rest;
                    });
                  }}
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
                  </div>

                  <div className="relative min-h-32 flex-1">
                    <div className="h-full overflow-y-auto py-1">
                      <PieceTree
                        project={draft}
                        selectedIds={selectedIds}
                        onSelect={selectPiece}
                        onReparent={reparent}
                        onToggleHidden={toggleHidden}
                        hoveredId={hoveredId}
                        onHoverChange={setHoveredId}
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

                  {selectedIds.length > 1 ? (
                    <SetPanel
                      project={draft}
                      selectedIds={selectedIds}
                      onSelect={setSelectedId}
                      onReparent={(parentId, pieceIds) =>
                        reparentAll(pieceIds, parentId)
                      }
                    />
                  ) : selected ? (
                    // Capped and scrollable, and free to shrink further still: the
                    // 55% cap is against the whole aside, so it can outgrow what
                    // is actually left once the tree has taken its own minimum.
                    // Without shrink enabled here, that excess pushed past the
                    // aside's own box and over whatever sat below it (the parts
                    // drawer) instead of scrolling.
                    <div className="max-h-[55%] min-h-0 overflow-y-auto border-t border-border px-3 py-2">
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
                        onChange={(change) =>
                          transformPiece(selected.id, change)
                        }
                        uniformScale={uniformScale}
                        onUniformScaleChange={setUniformScale}
                      />
                      {canMirror(draft, selected.id) ? (
                        <div className="mt-2">
                          <span className="text-xs text-muted-foreground">
                            Mirror
                          </span>
                          <ButtonGroup className="mt-1 flex w-full">
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1"
                              onClick={mirrorSelection}
                            >
                              <FlipHorizontal2 size={14} /> In place
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="flex-1"
                              onClick={mirrorCopyOfSelection}
                            >
                              <Copy size={14} /> As a copy
                            </Button>
                          </ButtonGroup>
                          <p className="mt-1 text-xs text-muted-foreground">
                            Across the unit's centre line, taking everything
                            under this piece with it. A copy is how one leg
                            becomes the other.
                          </p>
                        </div>
                      ) : null}

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
                              {parentOptions(draft, [selected.id]).map(
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
                              currentPivot(selectedPart, selected.pivot) ??
                              "middle"
                            }
                            onValueChange={(id) => {
                              const choice = pivotChoices(selectedPart).find(
                                (option) => option.id === id,
                              );
                              if (choice)
                                movePivot(selected.id, choice.position);
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
                            The point this piece turns about, and that its
                            children hang from. A leg wants its top, not its
                            middle.
                          </p>
                        </div>
                      ) : null}

                      <AnchorList
                        piece={selected}
                        placing={placingAnchor}
                        onPlacingChange={setPlacingAnchor}
                        onAddAtOrigin={() =>
                          edit((project) =>
                            addAnchor(
                              project,
                              selected.id,
                              selected.pivot ?? [0, 0, 0],
                              crypto.randomUUID(),
                            ),
                          )
                        }
                        onChange={(anchorId, change) =>
                          edit((project) =>
                            updateAnchor(
                              project,
                              selected.id,
                              anchorId,
                              change,
                            ),
                          )
                        }
                        onRemove={(anchorId) =>
                          edit((project) =>
                            removeAnchor(project, selected.id, anchorId),
                          )
                        }
                      />

                      <div className="mt-2">
                        <span className="text-xs text-muted-foreground">
                          Role
                        </span>
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
                          What this piece is, so the animation presets know what
                          to move.
                        </p>
                        {restAngleWarnings(selected).map((warning) => (
                          <p
                            key={warning}
                            className="mt-1 text-xs text-amber-500"
                          >
                            {warning}
                          </p>
                        ))}
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
          </CollapsibleContent>
        </div>
      </div>
    </Collapsible>
  );
}
