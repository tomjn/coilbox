import { Button, cn, Input, useHideSidebar } from "@picoframe/frame";
import {
  Blocks,
  Bone,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Copy,
  Crosshair,
  FlipHorizontal2,
  FlipVertical2,
  ImageIcon,
  Maximize2,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  Redo,
  Rocket,
  Save,
  Sparkles,
  Undo,
  Upload,
  Wrench,
  X,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router";

import { TipButton } from "@/components/TipButton";
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
import { type ArrangeAction, arrange } from "../align";
import { addAnchor, removeAnchor, updateAnchor } from "../anchors";
import { presetById, ROLES, restAngleWarnings } from "../animPresets";
import { unitAtlas } from "../atlas";
import { balanceProblem, checkBalance } from "../balance";
import { legoTexturePrune } from "../bindings";
import { addBuildArm, builderKind, pickArmParts } from "../buildArm";
import { pictureIsStale } from "../buildPicture";
import {
  parseClipboardPiece,
  pastedForUnit,
  serializeClipboardPiece,
} from "../clipboard";
import { reanchorCollisionVolume } from "../collisionVolume";
import { describePresets, selectionAsCompound } from "../compounds";
import {
  describeJoin,
  disconnectPiece,
  type JoinSummary,
  pieceConnectors,
  pieceOwnBox,
  setJoinPlace,
} from "../connectors";
import { planById } from "../describedPlan";
import {
  DEFAULT_GROUND,
  footprintWidth,
  type GroundChoice,
  groundShape,
  unitUp,
} from "../environment";
import { fitPlan } from "../fitPlan";
import { checkFootprint, footprintProblems } from "../footprint";
import {
  applyGroupTransform,
  type PieceTransform,
  transformRoots,
} from "../groupTransform";
import { useInventoryView } from "../inventory";
import { liftIntoUnit, pasteIntoUnit } from "../liftIntoUnit";
import {
  holdsLiftedPieces,
  liftCredit,
  liftedModuleRefusal,
  openedFrom,
  withMeshBoxes,
} from "../liftPiece";
import { fitToSteps } from "../measure";
import { canFixMesh, DEFAULT_SMOOTHING_ANGLE_DEG } from "../meshFix";
import {
  canMirror,
  mirrorCopy,
  mirrorPiece,
  unpairPiece,
  withoutDanglingTwins,
} from "../mirror";
import {
  descendantIds,
  type LegoCompiledScript,
  type LegoImported,
  type LegoMount,
  type LegoPiece,
  type LegoProject,
  type LegoUnitGame,
  normalisePieceName,
  pieceById,
  pieceKind,
  projectProblems,
  type SkeletonTarget,
  type StaleExport,
  uniquePieceName,
} from "../model";
import { swapCandidates, withLabels } from "../moduleFilter";
import { defaultMount, moduleConnectors, placeModule } from "../moduleMount";
import { type ModuleUpdate, moduleUpdates } from "../moduleUpdates";
import { checkOverlap, overlapProblems } from "../overlap";
import {
  type LegoPartInfo,
  type LoadedPack,
  loadPack,
  partUnit,
  projectPackProblems,
} from "../pack";
import { usePanelHeight, usePanelOpen } from "../panels";
import { attachToBone } from "../partOnBone";
import { buildPieceCollisionScript } from "../pieceCollisionScript";
import { currentPivot, pivotChoices, setPivot } from "../pivot";
import { attachToFreeFace, type FaceTarget, placePart } from "../placePart";
import { type Problem, type ProblemSource, problem } from "../problems";
import {
  deleteCompound,
  saveCompound,
  useLegoCompounds,
  useLegoProjects,
  useModules,
} from "../projects";
import { rawGeometryProblems } from "../rawGeometry";
import { texturesInUse } from "../rawImport";
import { parentOptions, reparentPiece } from "../reparent";
import { unringPiece } from "../ring";
import { ringMembers } from "../ringSet";
import { bakedPieces, sitOnGround, unitBounds } from "../s3oBuild";
import type {
  NanoStyle,
  ScriptTimeline,
  StandInTrack,
} from "../scriptPlayback";
import { dragPiece, freeMoved, type Seat, typedTransform } from "../seat";
import { isShortcut, shortcutLabel } from "../shortcuts";
import { skeletonProblems } from "../skeletonChecks";
import { applyProportions } from "../skeletonEdit";
import { applyTarget } from "../skeletonSize";
import { swapModule } from "../swapModule";
import { swapPart } from "../swapPart";
import { useEditShortcuts } from "../useEditShortcuts";
import { useLegoDocument } from "../useLegoDocument";
import { useModuleFiles } from "../useModuleFiles";
import { useShareModule } from "../useModuleShare";
import { useRawGeometry } from "../useRawGeometry";
import { useSymmetry } from "../useSymmetry";
import { addWeaponModule, pickWeaponParts } from "../weaponModule";
import { AimPointPanel } from "./components/AimPointPanel";
import { AnchorList } from "./components/AnchorList";
import { AnimationPanel } from "./components/AnimationPanel";
import { AtlasPicker } from "./components/AtlasPicker";
import { BuildPictureDrawer } from "./components/BuildPictureDrawer";
import { CollisionPanel } from "./components/CollisionPanel";
import { ExportDrawer } from "./components/ExportDrawer";
import { FitPlanDrawer } from "./components/FitPlanDrawer";
import { GameUnitBrowser } from "./components/GameUnitBrowser";
import { InventoryFilters, InventoryGrids } from "./components/Inventory";
import { JoinedTo } from "./components/JoinedTo";
import { PieceSize } from "./components/MeasureReadout";
import { ModelViewport } from "./components/ModelViewport";
import { ModuleUpdateBanner } from "./components/ModuleUpdateBanner";
import { NameInput } from "./components/NameInput";
import { collisionHandlePieceId } from "./components/PieceCollisionFields";
import { PieceTree } from "./components/PieceTree";
import { ProblemErrors } from "./components/ProblemErrors";
import type { CheckStatus } from "./components/ProblemsButton";
import { ProportionsPanel } from "./components/ProportionsPanel";
import type { Placing } from "./components/placeByFace";
import type { ReferenceUnit } from "./components/ReferencePicker";
import type {
  ModuleLabels,
  MountOptions,
} from "./components/SaveCompoundPopover";
import { SaveModelPopover } from "./components/SaveModelPopover";
import { ScriptTab } from "./components/ScriptTab";
import { SetPanel } from "./components/SetPanel";
import { StripResizer } from "./components/StripResizer";
import { SwapModuleDrawer } from "./components/SwapModuleDrawer";
import { SwapPartDrawer } from "./components/SwapPartDrawer";
import { TestDrawer } from "./components/TestDrawer";
import { TextureBuilderPanel } from "./components/TextureBuilderPanel";
import { TexturePicker } from "./components/TexturePicker";
import { TransformFields } from "./components/TransformFields";
import { UnitGamePicker } from "./components/UnitGamePicker";
import { useBuiltUnitDef } from "./components/useBuiltUnitDef";
import { useEffectBitmaps } from "./components/useEffectBitmaps";
import { useMoreBelow } from "./components/useMoreBelow";

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
  const [pack, setPack] = useState<LoadedPack | null>(null);
  // Its own flag, because a null pack is both "still reading the library" and
  // "the library would not read". Without it the wait showed as a failure for
  // however long the read took, which is the first thing anybody saw.
  const [packFailed, setPackFailed] = useState(false);
  // The document has the pack so an edit can place the pieces joined by
  // connectors to the parts it changes (#3273).
  const doc = useLegoDocument(id, pack);
  const { edit, selectedId, selectedIds, select: setSelectedId } = doc;
  const draft = doc.project;
  // The skeleton's body plan, and the proportion a slider or handle is showing
  // before it is let go. The preview is not an edit: it only changes what the
  // viewport and the panel show.
  const skeletonPlan = draft?.skeleton
    ? planById(draft.skeleton.plan)
    : undefined;
  const [proportionPreview, setProportionPreview] = useState<{
    id: string;
    value: number;
  } | null>(null);
  const shown = useMemo(
    () =>
      draft && skeletonPlan && proportionPreview
        ? applyProportions(
            draft,
            skeletonPlan,
            { [proportionPreview.id]: proportionPreview.value },
            () => crypto.randomUUID(),
          ).project
        : draft,
    [draft, skeletonPlan, proportionPreview],
  );
  // One edit however many bones move, so one undo step.
  const changeProportions = useCallback(
    (values: Record<string, number>) => {
      setProportionPreview(null);
      if (!skeletonPlan) return;
      edit(
        (project) =>
          applyProportions(project, skeletonPlan, values, () =>
            crypto.randomUUID(),
          ).project,
      );
    },
    [edit, skeletonPlan],
  );
  // Fits the skeleton to a footprint and height and keeps them as its target.
  const changeTarget = useCallback(
    (target: SkeletonTarget) => {
      setProportionPreview(null);
      if (!skeletonPlan) return;
      edit((project) =>
        applyTarget(project, skeletonPlan, target, () => crypto.randomUUID()),
      );
    },
    [edit, skeletonPlan],
  );
  // The document as it is now, for an edit made after waiting on a file.
  const docRef = useRef(doc);
  docRef.current = doc;
  // The unit's file in its game, which is where a factory's yardmap would be.
  const { def: builtDef } = useBuiltUnitDef(draft);
  // The names this unit has stopped exporting under, whose files are still in
  // the game folder (issue #2680). Held steady, because the export drawer reads
  // it in an effect and a fresh function each render would loop.
  const setStaleExports = useCallback(
    (staleExports: StaleExport[]) =>
      edit((project) => ({ ...project, staleExports })),
    [edit],
  );
  // The built in modules first, then the user's own.
  const compounds = useModules(pack);
  const moduleFiles = useModuleFiles(pack, compounds);
  const shareModule = useShareModule();
  const { loading: modulesLoading } = useLegoCompounds();
  // Only for the keep-set when a texture changes: the store is shared, so
  // nothing can decide a key is dead by looking at one unit.
  const { projects } = useLegoProjects();

  // The meshes of a unit imported from somebody else's model. Read once
  // alongside the document, and null for a unit built out of parts.
  const geometry = useRawGeometry(draft);
  const raw = geometry.raw;
  // A lifted piece saved before #3269 has no box for its mesh, and so no
  // connectors or pivot choices. The geometry has the box, so it is filled in
  // as a unit opens, and again whenever the document changes, because a paste
  // adds pieces after the geometry they name has arrived. It is not an edit
  // (#4354).
  const { fill } = doc;
  useEffect(() => {
    if (raw && draft) fill((project) => withMeshBoxes(project, raw));
  }, [raw, draft, fill]);
  const effectBitmaps = useEffectBitmaps(draft);
  // A unit imported whole has no parts and no atlas, so the parts library, the
  // compound library and the atlas picker are all hidden for it. Its UVs point
  // onto its own texture rather than onto the pack's sheet, so a part dropped
  // into it would sample the wrong image and nothing could put that right.
  const imported = draft?.imported ?? null;
  const [strip, setStrip] = useState<"inventory" | "script">("inventory");
  // Parts and Compounds have nothing for a unit imported whole (issue #712):
  // it has no parts to build with. Script is the one tab that still applies,
  // since an imported unit is usually the one carrying its game's own script.
  const effectiveStrip = imported ? "script" : strip;
  // Open or closed is remembered between runs. Which tab is showing is not, so
  // the side panel always comes back on Pieces. See `../panels`.
  const [stripOpen, setStripOpen] = usePanelOpen("strip");
  // How tall the drawer is comes back too, brought inside this window by the
  // resizer's own measurement. Whether it was covering the model view does
  // not: see `../panels`.
  const [stripHeight, setStripHeight] = usePanelHeight("strip");
  const [stripFull, setStripFull] = useState(false);
  // The model view and the drawer share this, and it is what a drag is
  // measured against.
  const columnRef = useRef<HTMLDivElement | null>(null);
  // The module is made once, when the step opens, because its pieces get new
  // ids each time and the mount names one of them.
  const liftedRef = useRef<LegoProject | null>(null);
  const [asideOpen, setAsideOpen] = usePanelOpen("aside");
  const [aside, setAside] = useState<
    "pieces" | "animation" | "collision" | "aim" | "texture" | "skeleton"
  >("pieces");
  /** The game unit standing beside the build, which the stats compare with. */
  const [referenceUnit, setReferenceUnit] = useState<ReferenceUnit | null>(
    null,
  );
  const [exporting, setExporting] = useState(false);
  const [testing, setTesting] = useState(false);
  const [picturing, setPicturing] = useState(false);
  /** Whether the drawer that fits a body plan to the unit's pieces is open. */
  const [fitting, setFitting] = useState(false);
  /** Whether the part picker for "Change part" is open, and what the last
   *  swap left behind. */
  const [swapping, setSwapping] = useState(false);
  const [showFreeFaces, setShowFreeFaces] = useState(false);
  const [swapNote, setSwapNote] = useState<string | null>(null);
  /** Whether the module picker for "Swap module" is open. */
  const [swappingModule, setSwappingModule] = useState(false);
  /** What the module update banner was dismissed at (#3304). */
  const [dismissedUpdates, setDismissedUpdates] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  /**
   * What playing means for a unit that owns its script: the poses a run of that
   * script produced, rather than the presets it no longer has.
   */
  const [scriptTimeline, setScriptTimeline] = useState<ScriptTimeline | null>(
    null,
  );
  /**
   * The last run the Animation panel produced, whatever it managed rather
   * than only a playable one. `scriptTimeline` above is null the moment a run
   * fails before its first frame, which is exactly the run the Script tab's
   * checks most need to see, so the two are kept apart.
   */
  const [lastScriptRun, setLastScriptRun] = useState<ScriptTimeline | null>(
    null,
  );
  /** The stand-in the running scenario asks for, and the pieces it sits on.
   *  Empty whenever nothing is playing or the scenario places none. */
  const [standIn, setStandIn] = useState<{
    track: StandInTrack | null;
    attachPieces: Map<string, string>;
    nano?: NanoStyle | null;
  }>({ track: null, attachPieces: new Map() });
  /**
   * Whether a script run's clock is frozen on `scriptFrame` rather than
   * advancing, and the frame it is either frozen on or, while running,
   * reported to be showing.
   */
  const [scriptPaused, setScriptPaused] = useState(false);
  const [scriptFrame, setScriptFrame] = useState(0);
  /** What the unit stands on in the viewport. Held here rather than in the
   *  viewport because the script preview is told about the same ground. A
   *  view setting for the session, never saved with the unit. */
  const [groundChoice, setGroundChoice] =
    useState<GroundChoice>(DEFAULT_GROUND);
  /** A preference, not part of the unit, so it lives with the session. */
  const [uniformScale, setUniformScale] = useState(true);
  /** What the next "Recalculate normals" click uses, for an imported unit.
   *  Starts on the engine's own smoothing rule. A preference for the session
   *  rather than something the unit carries, until it is applied to a piece
   *  and stored there as `normalsAngle`. */
  const [normalsAngle, setNormalsAngle] = useState(DEFAULT_SMOOTHING_ANGLE_DEG);
  /** Shared between the viewport and the tree, so hovering a piece in either
   *  highlights it in the other. */
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [treeScrollRef, treeMoreBelow] = useMoreBelow();
  /** The tree's folded branches. Here rather than in the tree, which unmounts
   *  whenever the sidebar shows another tab. */
  /** Whether the selected piece's panel is unfolded under the tree. */
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  // A piece picked in the viewport can be inside a folded branch, and a
  // selection with no row to show it is one nobody can see. Unfold its
  // ancestors, and leave every other branch as it was. Only on a change of
  // selection. The unit is read through a ref, or every edit would unfold a
  // branch folded round the selected piece a moment ago.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(() => {
    const draft = draftRef.current;
    if (!draft || selectedIds.length === 0) return;
    setCollapsedIds((was) => {
      const next = new Set(was);
      for (const id of selectedIds) {
        let parentId = pieceById(draft, id)?.parentId ?? null;
        while (parentId) {
          next.delete(parentId);
          parentId = pieceById(draft, parentId)?.parentId ?? null;
        }
      }
      return next.size === was.size ? was : next;
    });
  }, [selectedIds]);
  /** Whether the next click in the viewport drops a snap anchor. */
  const [placingAnchor, setPlacingAnchor] = useState(false);
  /** The part chosen in the strip, waiting for a face to be clicked. */
  const [placingPart, setPlacingPart] = useState<Placing | null>(null);
  /**
   * Symmetry mode: a piece added now gets a mirrored twin the first time it is
   * put somewhere off the centre line, and the twin then follows it for as long
   * as it stays selected. A preference for the session, like the scale lock
   * above, rather than something the unit carries. See `../useSymmetry`.
   */
  const symmetry = useSymmetry({ project: draft, edit, pack });
  const { queueTwin, place } = symmetry;
  const inventoryView = useInventoryView(pack, compounds);

  useEffect(() => {
    loadPack().then(setPack, () => setPackFailed(true));
  }, []);

  const moduleOffers = useMemo(
    () =>
      draft && pack && !modulesLoading ? moduleUpdates(draft, compounds) : null,
    [draft, pack, compounds, modulesLoading],
  );
  // A dismissal holds for these instances at these module stamps, so it lapses
  // when a module changes again or another unit is opened.
  const offerKey = moduleOffers
    ? `${draft?.id}:${moduleOffers.outdated.map((u) => `${u.instance}@${u.stamp}`).join(",")}`
    : "";
  const missingModuleIds = useMemo(
    () => new Set(moduleOffers?.missing.map((m) => m.moduleId)),
    [moduleOffers],
  );
  // The document's own problems, plus anything wrong between it and the packs
  // installed. Both are things to say rather than reasons to refuse the unit.
  const documentProblems = useMemo<Problem[]>(
    () =>
      draft
        ? [
            ...projectProblems(draft),
            // A unit imported whole names no parts and no atlas, so the pack
            // has nothing to say about it. Its own geometry does, and so does
            // a unit of parts holding pieces lifted from a game.
            ...(!draft.imported && pack
              ? projectPackProblems(draft, pack)
              : []),
            ...(draft.imported || draft.pieces.some((piece) => piece.meshId)
              ? [
                  ...(geometry.error
                    ? [problem("geometry", "error", geometry.error)]
                    : []),
                  ...geometry.missingTextures.map((texture) =>
                    problem("geometry", "warning", texture),
                  ),
                  ...rawGeometryProblems(draft.pieces, geometry.raw),
                ]
              : []),
          ]
        : [],
    [draft, pack, geometry.error, geometry.raw, geometry.missingTextures],
  );

  // The two checks that cost the most run on the deferred copy of the document,
  // so React paints an edit first and checks after it. They look at the rest pose only: while
  // a script preview moves the pieces, the support and the overlaps change with
  // them, and the checks would be about a pose that is not the unit's.
  const checkedDraft = useDeferredValue(draft);
  const checksCurrent = checkedDraft === draft;
  const atRest = !playing && scriptTimeline === null;
  const balance = useMemo(
    () =>
      checkedDraft && pack && atRest
        ? checkBalance(checkedDraft, pack, raw)
        : null,
    [checkedDraft, pack, raw, atRest],
  );
  const balanceNote = useMemo(
    () => (balance ? balanceProblem(balance) : null),
    [balance],
  );

  const overlap = useMemo(
    () =>
      checkedDraft && pack && atRest
        ? checkOverlap(checkedDraft, pack, raw)
        : null,
    [checkedDraft, pack, raw, atRest],
  );
  const overlapNotes = useMemo(
    () =>
      overlap && checkedDraft ? overlapProblems(checkedDraft, overlap) : [],
    [overlap, checkedDraft],
  );

  const skeletonNotes = useMemo(
    () =>
      checkedDraft && pack && atRest
        ? skeletonProblems(checkedDraft, pack, raw)
        : [],
    [checkedDraft, pack, raw, atRest],
  );

  // Whether the base footprint leaves out a barrel, flare, aim point and build
  // nozzle. The problems below do not depend on it: they judge the whole unit.
  const [footprintLeaveOut, setFootprintLeaveOut] = useState(true);
  const footprint = useMemo(
    () =>
      draft && pack
        ? checkFootprint(draft, pack, raw, footprintLeaveOut)
        : null,
    [draft, pack, raw, footprintLeaveOut],
  );
  const footprintNotes = useMemo(
    () => (footprint ? footprintProblems(footprint) : []),
    [footprint],
  );

  const problems = useMemo<Problem[]>(
    () => [
      ...documentProblems,
      ...(balanceNote ? [balanceNote] : []),
      ...footprintNotes,
      ...overlapNotes,
      ...skeletonNotes,
    ],
    [
      documentProblems,
      balanceNote,
      footprintNotes,
      overlapNotes,
      skeletonNotes,
    ],
  );
  const checkStatuses: Partial<Record<ProblemSource, CheckStatus>> = atRest
    ? checksCurrent
      ? {}
      : { balance: "checking", overlap: "checking", skeleton: "checking" }
    : { balance: "paused", overlap: "paused", skeleton: "paused" };

  function addPart(part: LegoPartInfo) {
    inventoryView.inventory.record({ kind: "part", id: part.id });
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

  /**
   * Choosing a part under a bone lays it along the bone from the joint. Under
   * another piece it joins a free face of that piece when it has faces. Either
   * way it is one edit, with its twin when symmetry is on. Otherwise it starts
   * placing the part by hovering a face, and choosing it again stops. Alt adds
   * the part at the selected piece's origin, as it was before.
   */
  function startPlacing(part: LegoPartInfo, now = false) {
    setPlacingAnchor(false);
    const parentId = selectedId;
    if (parentId && draft && pieceById(draft, parentId)?.bone !== undefined) {
      setPlacingPart(null);
      if (now) {
        addPart(part);
        return;
      }
      const pieceId = crypto.randomUUID();
      queueTwin(pieceId);
      place([pieceId], (project) => {
        return attachToBone(project, part, parentId, pieceId) ?? project;
      });
      inventoryView.inventory.record({ kind: "part", id: part.id });
      return;
    }
    if (parentId && draft && pack) {
      const pieceId = crypto.randomUUID();
      if (attachToFreeFace(draft, pack, part, parentId, pieceId)) {
        queueTwin(pieceId);
        place([pieceId], (project) => {
          return (
            attachToFreeFace(project, pack, part, parentId, pieceId)?.project ??
            project
          );
        });
        inventoryView.inventory.record({ kind: "part", id: part.id });
        setPlacingPart(null);
        return;
      }
    }
    setPlacingPart((was) =>
      was && "part" in was && was.part.id === part.id
        ? null
        : { part, cycle: 0, twist: 0 },
    );
  }

  /**
   * Choosing a module starts placing it on a connector. Alt, or a unit with no
   * part to hover yet, adds it to the selected piece straight away.
   */
  function startPlacingModule(module: LegoProject, now: boolean) {
    if (refuseLifted(module)) return;
    setPlacingAnchor(false);
    // A lifted piece's meshes go into the unit first, so it has faces to join
    // by and a ghost to draw, like any module.
    if (holdsLiftedPieces(module)) {
      setPlacingPart(null);
      void takeInLifted(module, "Add module").then((placed) => {
        if (placed) beginPlacingModule(placed, now);
      });
      return;
    }
    beginPlacingModule(module, now);
  }

  function beginPlacingModule(module: LegoProject, now: boolean) {
    // Read off the document, because a lifted module gets here after a wait.
    const current = docRef.current.project;
    if (
      now ||
      !current?.pieces.some(
        (piece) => piece.partId || piece.shape || piece.meshBox,
      )
    ) {
      addCompound(module, docRef.current);
      setPlacingPart(null);
      return;
    }
    setPlacingPart((was) =>
      was && "module" in was && was.module.id === module.id
        ? null
        : { module, cycle: 0, twist: 0 },
    );
  }

  /**
   * A click while placing. A face adds the part joined to it, in one edit with
   * its twin when symmetry is on. A click that hit nothing adds the part at the
   * selected piece's origin, but only in a unit with no part yet, where there
   * is no face to click.
   */
  function placeOnFace(target: FaceTarget | null) {
    if (!placingPart || !draft || !pack) return;
    if ("module" in placingPart) {
      if (!target) return;
      const { module } = placingPart;
      const inserted = placeModule(
        draft,
        module,
        pack,
        target,
        placingPart,
        () => crypto.randomUUID(),
      );
      if (!inserted) return;
      edit(() => inserted.project);
      doc.selectMany(inserted.rootPieceIds);
      for (const pieceId of inserted.rootPieceIds)
        queueTwin(pieceId, inserted.presets.held);
      inventoryView.inventory.record({ kind: "module", id: module.id });
      setPlacingPart(null);
      return;
    }
    if (!target) {
      if (draft.pieces.some((piece) => piece.partId || piece.shape)) return;
      addPart(placingPart.part);
      setPlacingPart(null);
      return;
    }
    const pieceId = crypto.randomUUID();
    if (!placePart(draft, pack, placingPart.part, target, placingPart, pieceId))
      return;
    queueTwin(pieceId);
    place([pieceId], (project) => {
      return (
        placePart(
          project,
          pack,
          placingPart.part,
          target,
          placingPart,
          pieceId,
        ) ?? project
      );
    });
    inventoryView.inventory.record({ kind: "part", id: placingPart.part.id });
    setPlacingPart(null);
  }

  // Arming an anchor takes over the click, so a part waiting for a face stops.
  useEffect(() => {
    if (placingAnchor) setPlacingPart(null);
  }, [placingAnchor]);

  // Only while placing, so these keys stay free everywhere else.
  useEffect(() => {
    if (!placingPart) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (isShortcut("place-stop", event)) setPlacingPart(null);
      else if (isShortcut("place-face", event)) {
        setPlacingPart((was) => was && { ...was, cycle: was.cycle + 1 });
      } else if (isShortcut("place-twist", event)) {
        setPlacingPart((was) => was && { ...was, twist: was.twist + 1 });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [placingPart]);

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

  /** The build arm module: arm, nozzle and nano point with their presets. */
  function addArm() {
    if (!draft || !pack) return;
    const parts = pickArmParts(pack.parts);
    if (!parts) {
      void notify({
        title: "Could not add a build arm",
        body: "This parts library has no block and beam to make one from.",
        level: "error",
      });
      return;
    }
    const added = addBuildArm(draft, parts, {
      parentId: selectedId ?? draft.rootPieceId,
      factory: builderKind(draft, builtDef)?.kind === "factory",
      newId: () => crypto.randomUUID(),
      now: new Date().toISOString(),
    });
    // One edit, so the pieces and their presets undo together.
    edit(() => added.project);
    doc.selectMany(added.rootPieceIds);
    for (const pieceId of added.rootPieceIds) queueTwin(pieceId);
  }

  /** The weapon module: turret, barrel and flare with their presets. */
  function addWeapon() {
    if (!draft || !pack) return;
    const parts = pickWeaponParts(pack.parts);
    if (!parts) {
      void notify({
        title: "Could not add a weapon",
        body: "This parts library has no block and beam to make one from.",
        level: "error",
      });
      return;
    }
    const added = addWeaponModule(draft, parts, {
      parentId: selectedId ?? draft.rootPieceId,
      newId: () => crypto.randomUUID(),
      now: new Date().toISOString(),
    });
    // One edit, so the pieces and their presets undo together.
    edit(() => added.project);
    doc.selectMany(added.rootPieceIds);
    for (const pieceId of added.rootPieceIds) queueTwin(pieceId);
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
    edit((project) =>
      withoutDanglingTwins({
        ...project,
        pieces: project.pieces.filter((piece) => !doomed.has(piece.id)),
      }),
    );
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

  function selectProblem(pieceIds: string[]) {
    doc.selectMany(pieceIds);
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

  // One edit, so one undo step. The piece stays where it is.
  function detach(pieceId: string) {
    edit((project) => disconnectPiece(project, pieceId));
  }

  // Typing an offset or twist is one edit, resolved through the join.
  function placeJoin(
    pieceId: string,
    change: { offset?: [number, number]; twist?: number },
  ) {
    if (!pack) return;
    edit((project) => setJoinPlace(project, pack, pieceId, change));
  }

  function liftSelection(): LegoProject | null {
    if (!draft) return null;
    return selectionAsCompound(draft, selectedIds, {
      id: crypto.randomUUID(),
      now: new Date().toISOString(),
      newId: () => crypto.randomUUID(),
    });
  }

  // What the save step offers as the mount: the connectors of the module the
  // selection would become, opening on the default.
  function compoundMounts(): MountOptions | null {
    const compound = liftSelection();
    liftedRef.current = compound;
    if (!compound || !pack) return null;
    return {
      choices: moduleConnectors(compound, pack),
      initial: defaultMount(compound, pack),
      known: compounds,
    };
  }

  async function saveSelectionAsCompound(
    mount: LegoMount | null,
    labels: ModuleLabels,
  ) {
    const compound = liftedRef.current ?? liftSelection();
    liftedRef.current = null;
    if (!compound) return;
    await saveCompound(
      withLabels(mount ? { ...compound, mount } : compound, labels),
    );
    // Showing where it went is the only confirmation the save needs.
    setStrip("inventory");
    inventoryView.setKind("modules");
    inventoryView.setList("all");
  }

  /**
   * Whether a module holding pieces lifted from a game has to stay out of this
   * unit, saying why when it does. See `liftedModuleRefusal`.
   */
  function refuseLifted(module: LegoProject, title = "Add module"): boolean {
    const refused = draft ? liftedModuleRefusal(draft, module) : null;
    if (refused) void notify({ title, body: refused, level: "warning" });
    return refused !== null;
  }

  function addCompound(compound: LegoProject, into = doc) {
    const project = into.project;
    if (!project) return;
    const inserted = into.insert(
      compound,
      into.selectedId ?? project.rootPieceId,
      true,
    );
    if (inserted.rootPieceIds.length === 0) return;
    inventoryView.inventory.record({ kind: "module", id: compound.id });
    into.selectMany(inserted.rootPieceIds);
    for (const pieceId of inserted.rootPieceIds)
      queueTwin(pieceId, inserted.held);
  }

  /**
   * Copy a lifted module's meshes into this unit's geometry file, then hand
   * back the module as it goes in. Null, having said why, when the files could
   * not be read or written, and then nothing has changed. See `liftIntoUnit`.
   */
  async function takeInLifted(
    module: LegoProject,
    title: string,
  ): Promise<LegoProject | null> {
    const unitId = docRef.current.project?.id;
    if (!unitId) return null;
    try {
      const taken = await liftIntoUnit(unitId, module);
      if (taken.raw) geometry.adopt(taken.raw);
      return taken.module;
    } catch (error) {
      void notify({
        title,
        body: error instanceof Error ? error.message : String(error),
        level: "error",
      });
      return null;
    }
  }

  function transformPiece(
    pieceId: string,
    change: Partial<LegoPiece>,
    seat?: Seat | null,
    slide?: [number, number] | null,
  ) {
    // Where a placement lands, whether it came from the gizmo or from typing a
    // number into the panel, so symmetry only has to watch this one spot.
    //
    // A `seat` (or null for a drag that seated nothing) says this is a drag,
    // which saves the join it ended on and frees a piece it moved off its join.
    // Typing a number is not a drag, but it frees a joined piece it moves or
    // turns all the same.
    place([pieceId], (project) =>
      seat !== undefined && pack && change.position && change.rotation
        ? dragPiece(
            project,
            pack,
            pieceId,
            {
              position: change.position,
              rotation: change.rotation,
              scale: change.scale ?? [1, 1, 1],
            },
            seat,
            slide ?? null,
          )
        : typedTransform(project, pieceId, change),
    );
  }

  /** A whole set moved at once, so it is one edit and one undo step. */
  function transformPieces(changes: Map<string, PieceTransform>) {
    // A set that is dragged leaves any join its pieces had, as a single piece
    // does, or the next edit would put them back.
    place([...changes.keys()], (project) =>
      freeMoved(project, applyGroupTransform(project, changes)),
    );
  }

  /** Align or distribute the selection as one edit. Answers who was freed. */
  function arrangeSet(action: ArrangeAction): string[] {
    if (!draft || !pack) return [];
    const { changes, detached } = arrange(
      draft,
      pack,
      raw,
      selectedIds,
      action,
    );
    if (changes.size === 0) return [];
    transformPieces(changes);
    return detached;
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

  // An ordinary edit, so undo takes it back. `UnitGamePicker` has already
  // refused a change the unit's pieces do not allow.
  function setGame(game: LegoUnitGame | null) {
    edit((project) => ({ ...project, game }));
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
        // A lifted piece in the inventory draws with a game's texture too.
        ...texturesInUse([...projects, ...compounds]),
        ...[next.texture, next.texture2].flatMap((texture) =>
          texture?.key ? [texture.key] : [],
        ),
      ],
    }).catch(() => {
      // A store that could not be swept is a disk-space question rather than a
      // correctness one, and the unit is already pointing at the new texture.
    });
  }

  function changePart(pieceId: string, part: LegoPartInfo) {
    setSwapping(false);
    if (!draft || !pack) return;
    const result = swapPart(draft, pack, pieceId, part.id);
    if (!result) return;
    edit(
      (project) =>
        swapPart(project, pack, pieceId, part.id)?.project ?? project,
    );
    const notes = [
      result.droppedAnchors.length > 0
        ? `Dropped ${result.droppedAnchors.length === 1 ? "an anchor" : `${result.droppedAnchors.length} anchors`} outside the new part: ${result.droppedAnchors.join(", ")}.`
        : null,
      result.broken.length > 0
        ? "A join lost its connector. See the problems list."
        : null,
    ].filter(Boolean);
    setSwapNote(notes.length > 0 ? notes.join(" ") : null);
  }

  /**
   * Put another module where the selected piece's module is. One edit, so one
   * undo. What the swap did to kept pieces and presets is told in a notice.
   */
  function changeModule(
    pieceId: string,
    module: LegoProject,
    title = "Swap module",
  ) {
    setSwappingModule(false);
    if (!draft || !pack || refuseLifted(module, title)) return;
    if (holdsLiftedPieces(module)) {
      void takeInLifted(module, title).then((placed) => {
        const now = docRef.current.project;
        if (placed && now) applyModuleSwap(now, pieceId, placed, title);
      });
      return;
    }
    applyModuleSwap(draft, pieceId, module, title);
  }

  function applyModuleSwap(
    project: LegoProject,
    pieceId: string,
    module: LegoProject,
    title: string,
  ) {
    if (!pack) return;
    const result = swapModule(project, pack, pieceId, module, () =>
      crypto.randomUUID(),
    );
    if (!result) return;
    docRef.current.edit(() => result.project);
    docRef.current.selectMany(result.rootPieceIds);
    const said = [
      result.moved.length > 0
        ? `Moved ${result.moved.join(", ")} to the new root.`
        : null,
      result.removedPresets.length > 0
        ? `Removed ${result.removedPresets.map((id) => presetById(id)?.label ?? id).join(", ")}, no piece uses it now.`
        : null,
      describePresets(result.presets),
      result.broken.length > 0
        ? "A join lost its connector. See the problems list."
        : null,
    ].filter(Boolean);
    if (said.length > 0)
      void notify({
        title,
        body: said.join(" "),
        level: "info",
      });
  }

  /** Update one out of date instance to the module as it is now. */
  function updateInstance(update: ModuleUpdate) {
    const module = compounds.find((c) => c.id === update.moduleId);
    if (module) changeModule(update.rootPieceId, module, "Update module");
  }

  function movePivot(pieceId: string, pivot: [number, number, number]) {
    edit((project) => setPivot(project, pieceId, pivot));
  }

  // Placing is one anchor at a time: the click is aimed at a spot, and staying
  // armed afterwards would put a second anchor wherever the next click landed.
  function placeAnchor(
    pieceId: string,
    position: [number, number, number],
    facing?: [number, number, number],
  ) {
    edit((project) =>
      addAnchor(project, pieceId, position, crypto.randomUUID(), facing),
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
      if (isShortcut("place-stop", event)) setPlacingAnchor(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [placingAnchor]);

  async function copySelection() {
    const lifted = doc.lift(selectedIds);
    if (!lifted) return;
    try {
      await navigator.clipboard.writeText(
        serializeClipboardPiece(
          lifted,
          draft?.id,
          draft ? openedFrom(draft) : null,
        ),
      );
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
    // Pasting is the other way pieces lifted from a game get into a unit, so it
    // meets the same refusal as adding the module from the inventory.
    const pasted = pastedForUnit(result.piece, draft.id);
    if (refuseLifted(pasted, "Couldn't paste")) return;
    try {
      const raw = await pasteIntoUnit(
        draft.id,
        result.piece.sourceUnitId,
        pasted,
      );
      if (raw) geometry.adopt(raw);
    } catch (e) {
      void notify({
        title: "Couldn't paste",
        body: e instanceof Error ? e.message : String(e),
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

    const inserted = doc.insert(pasted, selectedId ?? draft.rootPieceId);
    if (inserted.rootPieceIds.length === 0) return;
    doc.selectMany(inserted.rootPieceIds);
    for (const pieceId of inserted.rootPieceIds)
      queueTwin(pieceId, inserted.held);
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
    edit((project) => mirrorPiece(project, selectedId, pack));
  }

  // A copy, because the case this is for is one leg becoming the other and the
  // first leg is meant to stay.
  function mirrorCopyOfSelection() {
    if (!draft || !selectedId) return;
    const copy = mirrorCopy(
      draft,
      selectedId,
      () => crypto.randomUUID(),
      undefined,
      pack,
    );
    if (!copy) return;
    edit(() => copy.project);
    setSelectedId(copy.pieceId);
  }

  /**
   * Flip or mirror the UVs of geometry pieces this fix reaches: the selected
   * piece alone, or every geometry piece in the unit. A part from the pack is
   * skipped either way, since it arrives mapped and has nothing to fix. See
   * `meshFix.ts`.
   *
   * Toggles rather than sets, so a second click on the same scope undoes the
   * first without a trip to the undo button, and a "whole model" pass on a
   * freshly imported unit (where every flag starts unset) still lands every
   * piece on the same, flipped state in one step.
   */
  function fixSelectedUv(kind: "flip" | "mirror", scope: "piece" | "model") {
    edit((project) => {
      let changed = false;
      const pieces = project.pieces.map((piece) => {
        if (piece.meshId === undefined) return piece;
        if (scope === "piece" && piece.id !== selectedId) return piece;
        changed = true;
        return kind === "flip"
          ? { ...piece, uvFlip: !piece.uvFlip }
          : { ...piece, uvMirror: !piece.uvMirror };
      });
      return changed ? { ...project, pieces } : project;
    });
  }

  /** Recompute normals, at the angle the panel's own field currently holds,
   *  for the selected piece alone or for every geometry piece in the unit. */
  function recalcSelectedNormals(scope: "piece" | "model") {
    edit((project) => {
      let changed = false;
      const pieces = project.pieces.map((piece) => {
        if (piece.meshId === undefined) return piece;
        if (scope === "piece" && piece.id !== selectedId) return piece;
        changed = true;
        return { ...piece, normalsAngle };
      });
      return changed ? { ...project, pieces } : project;
    });
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
      pieces: project.pieces.map((piece) => {
        if (piece.id !== selectedId) return piece;
        // A deliberate rename overrides whatever name the file it was
        // imported from used, so that preserved original stops applying: see
        // `LegoPiece.originalName` (#2613).
        const { originalName: _dropped, ...rest } = piece;
        return { ...rest, name: normalisePieceName(name) };
      }),
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
  const joins = useMemo(() => {
    const found = new Map<string, JoinSummary>();
    if (!draft || !pack) return found;
    for (const piece of draft.pieces) {
      const join = describeJoin(draft, pack, piece);
      if (join) found.set(piece.id, join);
    }
    return found;
  }, [draft, pack]);

  const pieceCollisionLua = useMemo(
    () =>
      draft && pack && collisionOpen
        ? buildPieceCollisionScript(draft, bakedPieces(draft, pack, raw).pieces)
        : "",
    [draft, pack, raw, collisionOpen],
  );
  // Whether "Sit on the ground" would move anything. `sitOnGround` hands back
  // the same project when the unit already rests on y = 0 or has no geometry.
  const canGround = useMemo(
    () =>
      draft !== null &&
      pack !== null &&
      sitOnGround(draft, pack, raw) !== draft,
    [draft, pack, raw],
  );
  // Only measured for uneven ground that follows the unit's footprint, since
  // measuring bakes every piece and nothing else here needs it.
  const groundFootprint = useMemo(
    () =>
      draft !== null &&
      pack !== null &&
      groundChoice.id === "uneven" &&
      groundChoice.width === null
        ? footprintWidth(unitBounds(draft, pack, raw))
        : 0,
    [draft, pack, raw, groundChoice.id, groundChoice.width],
  );
  // Kept apart from the upright switch, so flipping it does not lay the
  // ground again.
  const {
    id: groundId,
    degrees: groundDegrees,
    width: groundWidth,
  } = groundChoice;
  const groundSurface = useMemo(
    () =>
      groundShape(
        { id: groundId, degrees: groundDegrees, width: groundWidth },
        groundFootprint,
      ),
    [groundId, groundDegrees, groundWidth, groundFootprint],
  );
  const ground = useMemo(
    () => ({
      choice: groundChoice,
      onChange: setGroundChoice,
      shape: groundSurface,
      up: unitUp(groundSurface, groundChoice.upright),
    }),
    [groundChoice, groundSurface],
  );
  // The piece the viewport puts its collision handles on: whichever is
  // selected while the collision panel is open. Selecting a piece is the whole
  // gesture, rather than a switch on top of it, because picking the thing you
  // want to change is already how everything else in the builder works.
  //
  // Nothing selected leaves them on the unit's own volume, which is also the
  // way back from a piece. See `collisionHandlePieceId` for why the root
  // counts as nothing selected here too.
  const collisionPieceId =
    draft && collisionOpen ? collisionHandlePieceId(draft, selectedId) : null;

  /** Stop the preview. Whatever is on screen describes the unit before a script
   *  change: the presets it just stopped using, or the script it just left. */
  function stopPlayback() {
    setPlaying(false);
    setScriptTimeline(null);
    setLastScriptRun(null);
    setStandIn({ track: null, attachPieces: new Map() });
    setScriptPaused(false);
    setScriptFrame(0);
  }

  /** Stores the unit's own Lua. The first call is the unit taking it over. */
  function changeScript(script: string) {
    stopPlayback();
    edit((project) => ({ ...project, script }));
  }

  /**
   * Takes the game's compiled script again, for a unit read out of an SDD
   * somebody is still editing. Playback stops for the same reason an edit
   * stops it: what is on screen is no longer what ran.
   */
  function reloadCompiled(compiledScript: LegoCompiledScript) {
    stopPlayback();
    edit((project) => ({ ...project, compiledScript }));
  }

  /** Drops the stored Lua, so the unit goes back to a script generated from
   *  its animation presets. */
  function releaseScript() {
    stopPlayback();
    edit((project) => {
      // Back on a generated script, which is the absence of the key rather
      // than a stored copy of what was generated.
      const { script: _dropped, ...rest } = project;
      return rest;
    });
  }

  if (doc.loading || !draft || !pack) {
    // A document that finished loading with nothing to show did not load, and
    // so did the parts library when its own read threw. Everything else here
    // is a read still in flight.
    const failed = (!doc.loading && !draft) || packFailed;
    return (
      <p className="px-6 py-10 text-center text-sm text-muted-foreground">
        {failed ? "This unit could not be opened." : "Opening the unit."}
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
  // What the pivot choices are measured from: the part's box, a shape's, or for
  // a lifted piece the box of its mesh.
  const selectedBox = selected ? pieceOwnBox(pack, selected) : undefined;
  const pivotBox = selectedBox ? { bbox: selectedBox } : null;
  // Whether "whole model" flip, mirror and recalculate normals have anything
  // to reach: an imported unit with every geometry piece deleted has none,
  // same as a unit built out of parts.
  const hasImportedGeometry = draft.pieces.some(
    (piece) => piece.meshId !== undefined,
  );

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
          onStale={setStaleExports}
        />

        <BuildPictureDrawer
          open={picturing}
          onOpenChange={setPicturing}
          project={draft}
          capture={doc.capture}
          onTaken={(picture) => edit((project) => ({ ...project, picture }))}
        />

        {selected && selectedPart ? (
          <SwapPartDrawer
            open={swapping}
            onOpenChange={setSwapping}
            pack={pack}
            current={selectedPart}
            atlas={drawAtlas}
            onPick={(part) => changePart(selected.id, part)}
          />
        ) : null}

        {selected?.module ? (
          <SwapModuleDrawer
            open={swappingModule}
            onOpenChange={setSwappingModule}
            modules={swapCandidates(
              compounds,
              selected.module.id,
              compounds.find((c) => c.id === selected.module?.id)?.category,
            )}
            category={
              compounds.find((c) => c.id === selected.module?.id)?.category
            }
            onPick={(module) => changeModule(selected.id, module)}
          />
        ) : null}

        {fitting ? (
          <FitPlanDrawer
            project={draft}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onOpenChange={setFitting}
            onFit={(plan, counts, picks) =>
              edit((project) => fitPlan(project, plan, counts, picks).project)
            }
          />
        ) : null}

        <TestDrawer
          open={testing}
          onOpenChange={setTesting}
          project={draft}
          pack={pack}
          raw={raw}
        />

        <div className="flex min-h-0 flex-1">
          <div ref={columnRef} className="flex min-h-0 flex-1 flex-col">
            {/* The unit's chrome floats over the view rather than taking a strip
              off the top of it. The 3D is the point of this screen.

              Hidden rather than unmounted while the drawer covers it, so the
              renderer keeps its context and the camera is where you left it.
              `useCanvas3D` ignores a host with no size, so nothing redraws
              until it comes back. */}
            <div
              className={cn(
                "relative min-h-0 flex-1",
                stripOpen && stripFull && "hidden",
              )}
            >
              <ModelViewport
                showFreeFaces={showFreeFaces}
                onReferenceUnit={setReferenceUnit}
                ground={ground}
                chrome={
                  <>
                    <div className="pointer-events-none flex items-start justify-between gap-3">
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
                            {draft.pieces.length === 1 ? "piece" : "pieces"} ·
                            exports as
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
                          <UnitGamePicker project={draft} onChange={setGame} />
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
                                <TipButton
                                  size="icon"
                                  variant="outline"
                                  onClick={doc.undo}
                                  disabled={!doc.canUndo}
                                  aria-label="Undo"
                                >
                                  <Undo size={14} />
                                </TipButton>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">
                                Undo ({shortcutLabel("undo")})
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <TipButton
                                  size="icon"
                                  variant="outline"
                                  onClick={doc.redo}
                                  disabled={!doc.canRedo}
                                  aria-label="Redo"
                                >
                                  <Redo size={14} />
                                </TipButton>
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
                                <TipButton
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
                                        doc.saving &&
                                          "motion-safe:animate-pulse",
                                      )}
                                    />
                                  ) : null}
                                </TipButton>
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
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  onClick={() => {
                                    // A selection made after this picks a
                                    // piece, so none is left over from before.
                                    setSelectedId(null);
                                    setFitting(true);
                                  }}
                                  aria-label="Fit a body plan"
                                >
                                  <Bone size={14} />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">
                                Fit a body plan
                              </TooltipContent>
                            </Tooltip>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  size="icon"
                                  variant="outline"
                                  className="relative"
                                  onClick={() => setPicturing(true)}
                                  aria-label="Build picture"
                                >
                                  <ImageIcon size={14} />
                                  {pictureIsStale(draft) ? (
                                    <span
                                      aria-hidden="true"
                                      className="absolute top-1 right-1 size-2 rounded-full bg-primary"
                                    />
                                  ) : null}
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="bottom">
                                {pictureIsStale(draft)
                                  ? "Build picture - the unit has changed since it was taken"
                                  : "Build picture"}
                              </TooltipContent>
                            </Tooltip>
                            {/* Only a unit that came from a file has a model to save
                          back to. One built out of parts has no such file, and
                          Export is the only way it ever leaves the builder. */}
                            {imported ? (
                              <SaveModelPopover
                                project={draft}
                                imported={imported}
                                pack={pack}
                                raw={raw}
                              />
                            ) : null}
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
                              <TooltipContent side="bottom">
                                Export
                              </TooltipContent>
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

                    {moduleOffers &&
                    moduleOffers.outdated.length > 0 &&
                    dismissedUpdates !== offerKey ? (
                      <ModuleUpdateBanner
                        updates={moduleOffers.outdated}
                        onUpdate={updateInstance}
                        onDismiss={() => setDismissedUpdates(offerKey)}
                      />
                    ) : null}

                    <ProblemErrors problems={problems} />
                  </>
                }
                document={{
                  pack,
                  raw,
                  project: shown ?? draft,
                  balance,
                  overlap,
                }}
                footprint={{
                  result: footprint,
                  leaveOut: footprintLeaveOut,
                  onLeaveOutChange: setFootprintLeaveOut,
                }}
                problems={{
                  items: problems,
                  statuses: checkStatuses,
                  onSelect: selectProblem,
                }}
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
                  standIn: { ...standIn, show: true },
                }}
                effectsAtlas={effectBitmaps.atlas}
                uniformScale={uniformScale}
                onGround={() =>
                  edit((project) => sitOnGround(project, pack, raw))
                }
                canGround={canGround}
                onReady={doc.onCapture}
                pieceActions={{
                  onDuplicate: duplicateSelection,
                  canDuplicate: transformRoots(draft, selectedIds).length > 0,
                  onPaste: () => void pasteClipboard(),
                  // Not for an imported unit: a compound is pieces made of
                  // parts, and one saved out of raw geometry would name
                  // meshes that only mean anything inside the unit they
                  // came from. It can never have one, so the button goes.
                  onSaveAsCompound: imported
                    ? undefined
                    : (mount, labels) =>
                        void saveSelectionAsCompound(mount, labels),
                  compoundMounts,
                  // Nor a selection holding a lifted piece: a module keeps its
                  // meshes in a file of its own, and these are in the unit's.
                  canSaveAsCompound:
                    selectedIds.length > 0 &&
                    !selectedIds
                      .flatMap((pieceId) => descendantIds(draft, pieceId))
                      .some((pieceId) => pieceById(draft, pieceId)?.meshId),
                  onDelete: removeSelected,
                  canDelete: transformRoots(draft, selectedIds).length > 0,
                }}
                symmetry={{
                  on: symmetry.on,
                  onChange: symmetry.setOn,
                  mode: symmetry.mode,
                  onModeChange: symmetry.setMode,
                  count: symmetry.count,
                  // A selected piece that is in a ring has the ring resized too.
                  onCountChange: (count) =>
                    symmetry.setCount(count, selectedId ?? undefined),
                }}
                anchorPlacement={{
                  placingAnchor,
                  onPlaceAnchor: placeAnchor,
                  onCancelAnchor: () => setPlacingAnchor(false),
                }}
                partPlacement={{
                  placing: placingPart,
                  onPlace: placeOnFace,
                }}
                collisionEditing={{
                  // The panel is where a volume is read and changed, so
                  // opening it is what puts the handles on the volume.
                  // Nothing else has to be switched on, and closing it gives
                  // them back to the pieces. Putting the whole side panel
                  // away closes it too, so the handles never outlive the
                  // thing that explains them.
                  editCollision: collisionOpen,
                  onCollisionChange: (collisionVolume) =>
                    edit((project) => ({ ...project, collisionVolume })),
                  // The selected piece while this panel is open, and null
                  // the rest of the time, which leaves the handles on the
                  // unit's own volume. See `collisionPieceId`.
                  editPieceCollisionId: collisionPieceId,
                  onPieceCollisionVolumeChange: (pieceId, volume) =>
                    edit((project) => ({
                      ...project,
                      pieces: project.pieces.map((piece) =>
                        piece.id === pieceId
                          ? {
                              ...piece,
                              // A dragged box keeps whether anything hits the
                              // piece, which is the switch above it in the
                              // panel and not something a drag has an
                              // opinion about.
                              collision: {
                                hit: piece.collision?.hit !== false,
                                volume,
                              },
                            }
                          : piece,
                      ),
                    })),
                }}
                proportions={
                  asideOpen && aside === "skeleton" && skeletonPlan
                    ? {
                        plan: skeletonPlan,
                        onDrag: (id, value) =>
                          setProportionPreview({ id, value }),
                        onDragEnd: (id, value) =>
                          changeProportions({ [id]: value }),
                      }
                    : undefined
                }
                aimPoint={{
                  // The same reasoning, for the marker the aim point panel
                  // is about: opening the panel draws the point it is
                  // describing.
                  showAimPoint: asideOpen && aside === "aim",
                  onAimChange: setAimPoint,
                }}
                guides={{ onEdit: edit }}
              />
            </div>

            {/* Parts and Compounds are hidden for an imported unit, which has no
              parts to reach for: its UVs point onto its own texture rather than
              onto the pack's sheet, so a part dropped into it would sample the
              wrong image and nothing here could put that right. See
              https://github.com/tomjn/coilbox/issues/712. Script stays, since
              an imported unit is usually the one carrying its game's own.

              Collapsible otherwise: most of a session is spent moving what is
              already there, not reaching for another part. */}
            <div
              id="lego-strip"
              className={cn(
                "relative flex flex-col border-t border-border",
                stripOpen && stripFull ? "min-h-0 flex-1" : "shrink-0",
              )}
              style={
                stripOpen && !stripFull ? { height: stripHeight } : undefined
              }
            >
              {/* On the top edge, over the border, out of the layout. Whatever
                the tabs put in the row below stays where it is. */}
              {stripOpen && !stripFull ? (
                <StripResizer
                  height={stripHeight}
                  onHeight={setStripHeight}
                  columnRef={columnRef}
                  controls="lego-strip"
                />
              ) : null}

              <div className="flex items-center gap-2 px-2 py-1">
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => {
                    setStripOpen(!stripOpen);
                    // Reopening to a drawer still covering the whole window
                    // would read as the model having gone missing.
                    setStripFull(false);
                  }}
                  aria-expanded={stripOpen}
                  aria-label={
                    stripOpen
                      ? effectiveStrip === "script"
                        ? "Hide the script"
                        : "Hide the parts"
                      : effectiveStrip === "script"
                        ? "Show the script"
                        : "Show the parts"
                  }
                >
                  {stripOpen ? (
                    <ChevronDown size={16} />
                  ) : (
                    <ChevronUp size={16} />
                  )}
                </Button>

                <ButtonGroup>
                  {imported ? null : (
                    <>
                      <Button
                        size="sm"
                        variant={strip === "inventory" ? "default" : "outline"}
                        onClick={() => {
                          setStrip("inventory");
                          setStripOpen(true);
                        }}
                        aria-pressed={strip === "inventory"}
                      >
                        Inventory
                      </Button>
                    </>
                  )}
                  <Button
                    size="sm"
                    variant={
                      effectiveStrip === "script" ? "default" : "outline"
                    }
                    onClick={() => {
                      setStrip("script");
                      setStripOpen(true);
                    }}
                    aria-pressed={effectiveStrip === "script"}
                  >
                    Script
                  </Button>
                </ButtonGroup>

                {stripOpen && effectiveStrip === "inventory" && pack ? (
                  <InventoryFilters
                    onLoadModuleFile={moduleFiles.loadFile}
                    view={inventoryView}
                    pack={pack}
                    compounds={compounds}
                    showGameUnits
                    className="flex-1"
                  />
                ) : null}

                {stripOpen ? (
                  <Button
                    size="icon"
                    variant="ghost"
                    className="ml-auto"
                    onClick={() => setStripFull(!stripFull)}
                    aria-pressed={stripFull}
                    aria-label={
                      stripFull
                        ? "Bring the model back"
                        : "Fill the window with this panel"
                    }
                  >
                    {stripFull ? (
                      <Minimize2 size={16} />
                    ) : (
                      <Maximize2 size={16} />
                    )}
                  </Button>
                ) : null}
              </div>

              {/* Flex, not block: the picker sizes itself with flex-1 and its contents
                are absolutely positioned, so in a block parent it collapses to
                nothing and the panel looks empty. */}
              {stripOpen ? (
                <div className="flex min-h-0 flex-1 border-t border-border">
                  {effectiveStrip === "script" ? (
                    <ScriptTab
                      project={draft}
                      onScriptChange={changeScript}
                      onScriptRelease={releaseScript}
                      onCompiledReload={reloadCompiled}
                      lastRun={lastScriptRun}
                    />
                  ) : pack ? (
                    <InventoryGrids
                      view={inventoryView}
                      pack={pack}
                      compounds={compounds}
                      atlas={drawAtlas}
                      selectedPartId={
                        placingPart && "part" in placingPart
                          ? placingPart.part.id
                          : undefined
                      }
                      onSelectPart={startPlacing}
                      onInsertModule={startPlacingModule}
                      placingModuleId={
                        placingPart && "module" in placingPart
                          ? placingPart.module.id
                          : undefined
                      }
                      onDeleteModule={(compoundId) =>
                        void deleteCompound(compoundId)
                      }
                      onRenameModule={(compound, name) =>
                        void saveCompound({ ...compound, name })
                      }
                      onCopyModule={(compound) => void saveCompound(compound)}
                      onSaveModuleFile={moduleFiles.saveFile}
                      onShareModule={shareModule}
                      onLabelsModule={(compound, labels) =>
                        void saveCompound(withLabels(compound, labels))
                      }
                      gameUnits={
                        <GameUnitBrowser
                          project={draft}
                          query={inventoryView.query}
                          onLift={async (module) => {
                            await saveCompound(module);
                          }}
                        />
                      }
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
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
                {draft.skeleton ? (
                  <Button
                    size="sm"
                    variant={aside === "skeleton" ? "default" : "outline"}
                    onClick={() => setAside("skeleton")}
                    aria-pressed={aside === "skeleton"}
                  >
                    Skeleton
                  </Button>
                ) : null}
                {/* Only for a unit imported whole: a parts-pack unit draws
                  with a shared atlas rather than its own two textures, and
                  there is nothing here for it to build. See #2574. */}
                {imported ? (
                  <Button
                    size="sm"
                    variant={aside === "texture" ? "default" : "outline"}
                    onClick={() => setAside("texture")}
                    aria-pressed={aside === "texture"}
                  >
                    Texture
                  </Button>
                ) : null}
              </ButtonGroup>

              {aside === "texture" && imported ? (
                <TextureBuilderPanel
                  imported={imported}
                  unitName={draft.unitName}
                  onChange={changeTextures}
                />
              ) : aside === "skeleton" && skeletonPlan ? (
                <ProportionsPanel
                  project={draft}
                  plan={skeletonPlan}
                  onChange={changeProportions}
                  onTarget={changeTarget}
                  onPreview={setProportionPreview}
                  preview={proportionPreview}
                />
              ) : aside === "aim" ? (
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
                  referenceUnit={referenceUnit}
                  playing={playing}
                  onPlayingChange={setPlaying}
                  onChange={(animations) =>
                    edit((project) => ({ ...project, animations }))
                  }
                  onScriptTimeline={setScriptTimeline}
                  onScriptRun={setLastScriptRun}
                  pack={loaded}
                  raw={raw}
                  onStandIn={setStandIn}
                  ground={ground}
                  scriptPaused={scriptPaused}
                  onScriptPausedChange={setScriptPaused}
                  scriptFrame={scriptFrame}
                  onScriptFrameChange={setScriptFrame}
                  onShowScript={() => {
                    setStrip("script");
                    setStripOpen(true);
                  }}
                  onBuilderChange={(builder) =>
                    edit((project) => ({ ...project, builder }))
                  }
                  onMovementChange={(movement) =>
                    edit(({ movement: _old, ...project }) =>
                      movement ? { ...project, movement } : project,
                    )
                  }
                  onWorthChange={(worth) =>
                    edit((project) => ({ ...project, worth }))
                  }
                  onWeaponChange={(pieceId, weapon) =>
                    edit((project) => ({
                      ...project,
                      pieces: project.pieces.map((piece) =>
                        piece.id === pieceId ? { ...piece, weapon } : piece,
                      ),
                    }))
                  }
                  effectsNote={effectBitmaps.note}
                />
              ) : (
                <>
                  <div className="flex items-center gap-1 border-b border-border px-3 py-2">
                    <h2 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                      Pieces
                    </h2>
                    {pack && !draft.imported ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        onClick={addArm}
                        aria-label="Add a build arm"
                        title="Add a build arm with its nozzle and nano point, and the build presets"
                      >
                        <Wrench size={14} />
                      </Button>
                    ) : null}
                    {pack && !draft.imported ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={addWeapon}
                        aria-label="Add a weapon"
                        title="Add a turret with its barrel and muzzle flare, and the aiming and recoil presets"
                      >
                        <Crosshair size={14} />
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className={
                        pack && !draft.imported ? undefined : "ml-auto"
                      }
                      onClick={addEmpty}
                      title="Add an empty piece, which is how flares and aim points are made"
                    >
                      <Plus size={14} />
                    </Button>
                  </div>

                  <div className="relative min-h-32 flex-1">
                    <div
                      ref={treeScrollRef}
                      className="h-full overflow-y-auto py-1"
                    >
                      <PieceTree
                        project={draft}
                        raw={raw}
                        selectedIds={selectedIds}
                        onSelect={selectPiece}
                        onReparent={reparent}
                        joins={joins}
                        onToggleHidden={toggleHidden}
                        hoveredId={hoveredId}
                        onHoverChange={setHoveredId}
                        collapsedIds={collapsedIds}
                        onToggleCollapsed={(pieceId) =>
                          setCollapsedIds((was) => {
                            const next = new Set(was);
                            if (!next.delete(pieceId)) next.add(pieceId);
                            return next;
                          })
                        }
                      />
                    </div>
                    {/* Fades the last row rather than clipping it mid-line, so a
                    partly visible row reads as "more below" rather than a
                    rendering fault. Gone at the end of the list, where there
                    is nothing below and it only dimmed the last row. */}
                    {treeMoreBelow ? (
                      <div
                        aria-hidden
                        className="pointer-events-none absolute inset-x-0 bottom-0 h-7 bg-gradient-to-t from-background to-transparent"
                      />
                    ) : null}
                  </div>

                  {selectedIds.length > 1 ? (
                    <SetPanel
                      project={draft}
                      selectedIds={selectedIds}
                      onSelect={setSelectedId}
                      onReparent={(parentId, pieceIds) =>
                        reparentAll(pieceIds, parentId)
                      }
                      onAlign={(axis, edge) =>
                        arrangeSet({ kind: "align", axis, edge })
                      }
                      onDistribute={(axis) =>
                        arrangeSet({ kind: "distribute", axis })
                      }
                    />
                  ) : selected ? (
                    // Capped and scrollable, and free to shrink further still: the
                    // 55% cap is against the whole aside, so it can outgrow what
                    // is actually left once the tree has taken its own minimum.
                    // Without shrink enabled here, that excess pushed past the
                    // aside's own box and over whatever sat below it (the parts
                    // drawer) instead of scrolling.
                    <div className="flex max-h-[55%] min-h-0 flex-col border-t border-border">
                      {/* Folds away to give the tree the room, and closes by
                        clearing the selection, which is what the panel is
                        about. */}
                      <div className="flex items-center gap-1 px-1 py-1">
                        <button
                          type="button"
                          onClick={() => setDetailsOpen((open) => !open)}
                          aria-expanded={detailsOpen}
                          className="flex min-w-0 flex-1 items-center gap-1 rounded px-2 py-1 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {detailsOpen ? (
                            <ChevronDown size={14} className="shrink-0" />
                          ) : (
                            <ChevronRight size={14} className="shrink-0" />
                          )}
                          <span className="truncate">{selected.name}</span>
                        </button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 shrink-0"
                          onClick={() => setSelectedId(null)}
                          aria-label="Close and deselect"
                          title="Close and deselect"
                        >
                          <X size={14} />
                        </Button>
                      </div>
                      {detailsOpen ? (
                        <div className="min-h-0 overflow-y-auto px-3 pb-2">
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
                          {selected.lifted ? (
                            <p className="mt-1 text-xs text-muted-foreground">
                              {liftCredit(selected.lifted)}
                            </p>
                          ) : null}

                          <TransformFields
                            piece={selected}
                            onChange={(change) =>
                              transformPiece(selected.id, change)
                            }
                            uniformScale={uniformScale}
                            onUniformScaleChange={setUniformScale}
                          />
                          <PieceSize
                            project={draft}
                            pack={pack}
                            raw={raw}
                            pieceId={selected.id}
                          />
                          {selected.meshBox ? (
                            <Button
                              size="sm"
                              variant="outline"
                              className="mt-2 w-full"
                              onClick={() =>
                                edit((project) =>
                                  fitToSteps(
                                    project,
                                    pack,
                                    raw,
                                    selected.id,
                                    partUnit(pack),
                                  ),
                                )
                              }
                            >
                              Fit to steps
                            </Button>
                          ) : null}
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

                          {/* Only for a unit imported whole: a part from the pack
                        arrives mapped, so there is nothing here for it to fix,
                        and this whole section would be a question with no
                        honest answer for it. See #2575. */}
                          {imported ? (
                            <div className="mt-2">
                              <span className="text-xs text-muted-foreground">
                                Fix UVs and normals
                              </span>
                              <p className="mt-1 text-xs text-muted-foreground">
                                For a model imported from somewhere else, whose
                                UVs or lighting arrived wrong.
                              </p>
                              <div className="mt-1 grid grid-cols-[1fr_auto_auto] items-center gap-x-1.5 gap-y-1.5">
                                <span />
                                <span className="text-center text-[10px] uppercase text-muted-foreground">
                                  This piece
                                </span>
                                <span className="text-center text-[10px] uppercase text-muted-foreground">
                                  Whole model
                                </span>

                                <span className="flex items-center gap-1 text-xs">
                                  <FlipVertical2 size={12} /> Flip UVs
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!canFixMesh(selected)}
                                  onClick={() => fixSelectedUv("flip", "piece")}
                                >
                                  Flip
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!hasImportedGeometry}
                                  onClick={() => fixSelectedUv("flip", "model")}
                                >
                                  Flip
                                </Button>

                                <span className="flex items-center gap-1 text-xs">
                                  <FlipHorizontal2 size={12} /> Mirror UVs
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!canFixMesh(selected)}
                                  onClick={() =>
                                    fixSelectedUv("mirror", "piece")
                                  }
                                >
                                  Mirror
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!hasImportedGeometry}
                                  onClick={() =>
                                    fixSelectedUv("mirror", "model")
                                  }
                                >
                                  Mirror
                                </Button>

                                <span className="flex items-center gap-1 text-xs">
                                  <Sparkles size={12} /> Recalc normals
                                </span>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!canFixMesh(selected)}
                                  onClick={() => recalcSelectedNormals("piece")}
                                >
                                  Fix
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  disabled={!hasImportedGeometry}
                                  onClick={() => recalcSelectedNormals("model")}
                                >
                                  Fix
                                </Button>
                              </div>
                              <div className="mt-1.5 flex items-center gap-2">
                                <label
                                  htmlFor="lego-normals-angle"
                                  className="text-xs text-muted-foreground"
                                >
                                  Smoothing angle
                                </label>
                                <Input
                                  id="lego-normals-angle"
                                  inputMode="decimal"
                                  value={String(normalsAngle)}
                                  onChange={(event) => {
                                    const value = Number(event.target.value);
                                    if (Number.isFinite(value))
                                      setNormalsAngle(value);
                                  }}
                                  className="h-6 w-16 text-right"
                                />
                                <span className="text-xs text-muted-foreground">
                                  degrees, for the next recalculation
                                </span>
                              </div>
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

                          {selected.id === draft.rootPieceId ? null : (
                            <JoinedTo
                              join={joins.get(selected.id) ?? null}
                              onDetach={() => detach(selected.id)}
                              onPlace={(change) =>
                                placeJoin(selected.id, change)
                              }
                              showFree={showFreeFaces}
                              onShowFreeChange={setShowFreeFaces}
                            />
                          )}

                          {selected.twin && pieceById(draft, selected.twin) ? (
                            <div className="mt-2 flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground">
                                Twin
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                {pieceById(draft, selected.twin)?.name}
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-xs"
                                onClick={() =>
                                  edit((project) =>
                                    unpairPiece(project, selected.id),
                                  )
                                }
                              >
                                Break
                              </Button>
                            </div>
                          ) : null}
                          {selected.ring &&
                          ringMembers(draft.pieces, selected.id) ? (
                            <div className="mt-2 flex items-center gap-2 text-xs">
                              <span className="text-muted-foreground">
                                Ring
                              </span>
                              <span className="min-w-0 flex-1 truncate">
                                {selected.ring.count} copies
                              </span>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-6 px-2 text-xs"
                                onClick={() =>
                                  edit((project) =>
                                    unringPiece(project, selected.id),
                                  )
                                }
                              >
                                Break
                              </Button>
                            </div>
                          ) : null}

                          {selectedPart ? (
                            <div className="mt-2">
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full"
                                onClick={() => {
                                  setSwapNote(null);
                                  setSwapping(true);
                                }}
                              >
                                Change part
                              </Button>
                              {swapNote ? (
                                <p className="mt-1 text-xs text-muted-foreground">
                                  {swapNote}
                                </p>
                              ) : null}
                            </div>
                          ) : null}

                          {selected.module ? (
                            <div className="mt-2">
                              {missingModuleIds.has(selected.module.id) ? (
                                <p className="mb-1 text-xs text-muted-foreground">
                                  Module missing
                                </p>
                              ) : null}
                              <Button
                                size="sm"
                                variant="outline"
                                className="w-full"
                                onClick={() => setSwappingModule(true)}
                              >
                                Swap module
                              </Button>
                            </div>
                          ) : null}

                          {pivotBox ? (
                            <div className="mt-2">
                              <span className="text-xs text-muted-foreground">
                                Turns about
                              </span>
                              <Select
                                value={
                                  currentPivot(pivotBox, selected.pivot) ??
                                  "middle"
                                }
                                onValueChange={(id) => {
                                  const choice = pivotChoices(pivotBox).find(
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
                                  {pivotChoices(pivotBox).map((choice) => (
                                    <SelectItem
                                      key={choice.id}
                                      value={choice.id}
                                    >
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
                            connectors={
                              pack ? pieceConnectors(pack, selected) : []
                            }
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
                              What this piece is, so the animation presets know
                              what to move.
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
                            {pieceKind(selected, raw) === "geometry"
                              ? "Geometry."
                              : "Empty, so it carries other pieces and can be an emit point."}
                          </p>
                        </div>
                      ) : null}
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
