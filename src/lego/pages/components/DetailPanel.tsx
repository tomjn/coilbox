/**
 * Whatever is chosen in the inventory grid, beside it rather than over it, so
 * the grid stays in view while comparing (#4537).
 *
 * One frame for a part, a shape and a module: a name line, a size line, a
 * preview, a list of what it is and a row of what can be done with it. A
 * module's actions live here, where they are labelled buttons, rather than on
 * its tile. The Lego Parts page and the builder's drawer both show it.
 *
 * The preview is orbitable, unlike the grid's fixed three quarter view, because
 * checking a piece usually means looking at the face the grid hides.
 */

import { Button, cn, Input } from "@picoframe/frame";
import { Copy, Plus, X } from "lucide-react";
import {
  type DependencyList,
  Fragment,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

import { Field } from "@/components/Field";
import { ButtonGroup } from "@/components/ui/button-group";
import { useCanvas3D } from "@/lib/useCanvas3D";
import { useReduceMotion } from "../../../general/display";
import { baseAtlas, type LegoAtlas } from "../../atlas";
import { useColourwayColours } from "../../colourwayColours";
import { validateCompoundName } from "../../compounds";
import { addStandardLights, partMaterial } from "../../geometry";
import type { InventoryRef } from "../../inventory";
import { holdsLiftedPieces, liftCredits } from "../../liftPiece";
import type { LegoProject } from "../../model";
import {
  canonicalCategory,
  categorySuggestions,
  parseTags,
  withLabels,
} from "../../moduleFilter";
import {
  colourwayLabel,
  getPartGeometry,
  type LegoPartInfo,
  type LoadedPack,
  partDimensions,
  partSize,
  shapeVariants,
} from "../../pack";
import {
  disposeRawGeometry,
  loadRawGeometry,
  type RawGeometry,
} from "../../rawGeometry";
import { getShapeGeometry, SHAPE_KINDS, type ShapeKind } from "../../shapes";
import { isBuiltInModule } from "../../starterModules";
import { ColourwayChip } from "./ColourwayChip";
import {
  type ModuleLabelsDraft,
  ModuleLabelsFields,
} from "./ModuleLabelsFields";
import { buildModule } from "./TileGrid";

type Labels = { category: string | undefined; tags: string[] };

/** What can be done to a module from the panel. */
export interface ModuleActions {
  onDelete: (id: string) => void;
  onRename: (module: LegoProject, name: string) => void;
  /** Saves the user's own copy of a built in module, and hands it back. */
  onCopy: (module: LegoProject) => Promise<LegoProject>;
  /** Absent leaves out Save to file. */
  onSaveFile?: (module: LegoProject) => void;
  /** Absent leaves out Share. */
  onShare?: (module: LegoProject) => void;
  /** Absent leaves out the category and tags fields. */
  onLabels?: (module: LegoProject, labels: Labels) => void;
}

interface Props {
  pack: LoadedPack;
  /** The unit's atlas in the builder. The base pack's when absent. */
  atlas?: LegoAtlas;
  selected: InventoryRef;
  /** Every module, for finding the chosen one and checking a new name. */
  compounds: LegoProject[];
  moduleActions: ModuleActions;
  /** Choose something else, such as another colourway of the same part. */
  onSelect: (ref: InventoryRef) => void;
  onClose: () => void;
  /** The builder's Add, for a shape. Absent on the Lego Parts page. */
  onAddShape?: (shape: ShapeKind) => void;
  /** The builder's Place, for a module. Absent on the Lego Parts page. */
  onPlaceModule?: (module: LegoProject) => void;
  /** A small preview, for the builder's drawer, which is short. */
  compact?: boolean;
  className?: string;
}

/**
 * The chosen part, shape or module, or nothing when it has gone, such as a
 * module just deleted.
 */
export function DetailPanel({
  pack,
  atlas,
  selected,
  compounds,
  moduleActions,
  onSelect,
  onClose,
  onAddShape,
  onPlaceModule,
  compact = false,
  className,
}: Props) {
  const frame = { onClose, className, compact };
  if (selected.kind === "part") {
    const part = pack.byId.get(selected.id);
    if (!part) return null;
    return (
      <PartBody
        frame={frame}
        pack={pack}
        atlas={atlas}
        part={part}
        onSelect={(variant) => onSelect({ kind: "part", id: variant.id })}
      />
    );
  }
  if (selected.kind === "shape") {
    const shape = SHAPE_KINDS.find((s) => s.id === selected.id);
    if (!shape) return null;
    return (
      <ShapeBody
        frame={frame}
        pack={pack}
        atlas={atlas}
        shape={shape}
        onAdd={onAddShape}
      />
    );
  }
  const module = compounds.find((m) => m.id === selected.id);
  if (!module) return null;
  return (
    <ModuleBody
      // A new module starts its fields afresh.
      key={module.id}
      frame={frame}
      pack={pack}
      atlas={atlas}
      module={module}
      compounds={compounds}
      actions={moduleActions}
      onPlace={onPlaceModule}
      onCopied={(copy) => onSelect({ kind: "module", id: copy.id })}
      onDeleted={onClose}
    />
  );
}

interface FrameProps {
  onClose: () => void;
  className?: string;
  compact: boolean;
}

/** How tall a body's preview is, and whether it says it can be turned. */
function previewSize(frame: FrameProps, tall: boolean) {
  if (frame.compact) return { className: "h-24", hint: false };
  return tall
    ? { className: "h-50", hint: true }
    : { className: "h-30", hint: false };
}

/** The name and size lines over whichever body is showing. */
function Frame({
  frame,
  name,
  size,
  children,
}: {
  frame: FrameProps;
  name: string;
  size: ReactNode;
  children: ReactNode;
}) {
  return (
    <aside
      aria-label={`${name} details`}
      className={cn(
        "flex w-72 shrink-0 flex-col overflow-y-auto border-l border-border pl-4",
        frame.className,
      )}
    >
      <header className="flex items-start justify-between gap-2 border-b border-border pb-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium leading-tight break-words">
            {name}
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{size}</p>
        </div>
        <Button
          size="icon"
          variant="ghost"
          className="size-8 shrink-0 text-muted-foreground"
          onClick={frame.onClose}
          aria-label="Close details"
        >
          <X size={16} />
        </Button>
      </header>
      {children}
    </aside>
  );
}

function Facts({ children }: { children: ReactNode }) {
  return (
    <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-xs [&_dd]:min-w-0 [&_dt]:text-muted-foreground">
      {children}
    </dl>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="mt-3.5 flex flex-wrap gap-2 pb-3">{children}</div>;
}

function PartBody({
  frame,
  pack,
  atlas,
  part,
  onSelect,
}: {
  frame: FrameProps;
  pack: LoadedPack;
  atlas?: LegoAtlas;
  part: LegoPartInfo;
  onSelect: (part: LegoPartInfo) => void;
}) {
  const variants = shapeVariants(pack, part.shapeId);
  const colours = useColourwayColours(pack);
  return (
    <Frame
      frame={frame}
      name={part.name}
      size={partDimensions(part)
        .map((n) => n.toFixed(2))
        .join(" x ")}
    >
      <Preview
        {...previewSize(frame, true)}
        build={() => {
          const geometry = getPartGeometry(pack, part.id);
          if (!geometry) return null;
          const material = partMaterial(atlas ?? baseAtlas(pack));
          return {
            object: new THREE.Mesh(geometry, material),
            size: partSize(part),
          };
        }}
        deps={[pack, atlas, part]}
      />

      <Facts>
        {variants.length > 1 ? (
          <>
            {/* A row of its own, as three names with chips are wider than
                the column beside the labels. */}
            <dt className="col-span-2">Colourway</dt>
            <dd className="col-span-2 mb-1">
              <ButtonGroup aria-label="Colourway">
                {variants.map((variant) => (
                  <Button
                    key={variant.id}
                    size="sm"
                    variant={variant.id === part.id ? "default" : "outline"}
                    className="h-7 px-2.5 text-xs"
                    onClick={() => onSelect(variant)}
                    aria-pressed={variant.id === part.id}
                  >
                    <ColourwayChip
                      colourway={variant.colourway}
                      colours={colours}
                    />
                    {colourwayLabel(pack, variant.colourway)}
                  </Button>
                ))}
              </ButtonGroup>
            </dd>
          </>
        ) : null}

        <dt>Shape</dt>
        <dd>{part.shape}</dd>

        <dt>Tags</dt>
        <dd>{part.tags.join(", ")}</dd>

        <dt>Triangles</dt>
        <dd>
          {part.iCount / 3} from {part.vCount} vertices
        </dd>

        <dt>Atlas</dt>
        <dd>
          {part.uvBox.min.map((n) => n.toFixed(2)).join(", ")} to{" "}
          {part.uvBox.max.map((n) => n.toFixed(2)).join(", ")}
        </dd>

        {pack.library.packs.length > 1 ? (
          <>
            <dt>Pack</dt>
            <dd>{part.packId}</dd>
          </>
        ) : null}

        <dt>Part id</dt>
        <dd className="font-mono">{part.id}</dd>

        <dt>In the source</dt>
        <dd className="font-mono break-all">{part.sourceNames.join(", ")}</dd>
      </Facts>

      {part.uvIncomplete ? (
        <p className="mt-3 text-xs text-muted-foreground">
          {part.uvIncomplete} corners have no texture coordinate.
        </p>
      ) : null}
    </Frame>
  );
}

/**
 * A generated shape kind (#3337). It has no pack, colourway or part id, so it
 * shows the kind, its default size and its search tags.
 */
function ShapeBody({
  frame,
  pack,
  atlas,
  shape,
  onAdd,
}: {
  frame: FrameProps;
  pack: LoadedPack;
  atlas?: LegoAtlas;
  shape: ShapeKind;
  onAdd?: (shape: ShapeKind) => void;
}) {
  const reduceMotion = useReduceMotion();
  return (
    <Frame frame={frame} name={shape.label} size={shape.size.join(" x ")}>
      <Preview
        {...previewSize(frame, true)}
        spin={!reduceMotion}
        build={() => {
          const geometry = getShapeGeometry({
            kind: shape.kind,
            size: shape.size,
            ...(shape.options ? { options: shape.options } : {}),
          });
          if (!geometry) return null;
          const material = partMaterial(atlas ?? baseAtlas(pack));
          return {
            object: new THREE.Mesh(geometry, material),
            size: Math.max(...shape.size),
          };
        }}
        deps={[pack, atlas, shape]}
      />

      <Facts>
        <dt>Kind</dt>
        <dd className="font-mono">{shape.kind}</dd>

        <dt>Size</dt>
        <dd>{shape.size.join(" x ")}</dd>

        {Object.entries(shape.options ?? {}).map(([name, value]) => (
          <Fragment key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </Fragment>
        ))}

        <dt>Tags</dt>
        <dd>{shape.tags.join(", ")}</dd>
      </Facts>

      {onAdd ? (
        <Actions>
          <Button size="sm" onClick={() => onAdd(shape)}>
            <Plus size={14} /> Add
          </Button>
        </Actions>
      ) : null}
    </Frame>
  );
}

/** How big a module is drawn in its preview, in the preview's own units. */
const MODULE_SIZE = 2;

function labelsOf(module: LegoProject): Labels {
  return { category: module.category, tags: module.tags ?? [] };
}

function sameLabels(a: Labels, b: Labels): boolean {
  return (
    (a.category ?? "") === (b.category ?? "") &&
    a.tags.length === b.tags.length &&
    a.tags.every((tag, i) => tag === b.tags[i])
  );
}

function labelsDraft(module: LegoProject): ModuleLabelsDraft {
  return {
    category: module.category ?? "",
    tags: (module.tags ?? []).join(", "),
  };
}

/**
 * A built in module shows what it is and offers a copy. The game maker's own
 * module has its name, category and tags as fields that save as they go, and
 * Save to file, Share and Delete. One lifted from a game cannot leave the
 * machine as a file, so it has Share and Delete.
 */
function ModuleBody({
  frame,
  pack,
  atlas,
  module,
  compounds,
  actions,
  onPlace,
  onCopied,
  onDeleted,
}: {
  frame: FrameProps;
  pack: LoadedPack;
  atlas?: LegoAtlas;
  module: LegoProject;
  compounds: LegoProject[];
  actions: ModuleActions;
  onPlace?: (module: LegoProject) => void;
  onCopied: (copy: LegoProject) => void;
  onDeleted: () => void;
}) {
  const builtIn = isBuiltInModule(module);
  const liftedFrom = holdsLiftedPieces(module) ? module.game?.name : undefined;
  const credits = liftedFrom ? liftCredits(module) : [];
  const count = module.pieces.length;
  const reduceMotion = useReduceMotion();

  // The module as last saved from here. A save lands in `compounds` a moment
  // later, so a rename straight after a relabel must not write the old labels
  // back, nor the other way round.
  const latest = useRef(module);
  useEffect(() => {
    latest.current = module;
  }, [module]);

  const [name, setName] = useState(module.name);
  const [nameError, setNameError] = useState<string | null>(null);
  const [labels, setLabels] = useState(() => labelsDraft(module));
  // An edit made elsewhere shows here once it is saved.
  useEffect(() => {
    setName(module.name);
    setNameError(null);
  }, [module.name]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: the labels are what changed, read through the module
  useEffect(() => {
    setLabels(labelsDraft(module));
  }, [module.category, module.tags]);

  /**
   * Enter and leaving the field both land here. An empty or clashing name
   * keeps the field with a reason rather than reverting, so a mistyped name
   * does not quietly vanish. Escape gives up.
   */
  function commitName() {
    const error = validateCompoundName(compounds, module.id, name);
    setNameError(error);
    if (error) return;
    const trimmed = name.trim();
    if (trimmed === latest.current.name) return;
    latest.current = { ...latest.current, name: trimmed };
    actions.onRename(latest.current, trimmed);
  }

  function commitLabels(draft: ModuleLabelsDraft) {
    const onLabels = actions.onLabels;
    if (!onLabels) return;
    const next = {
      category: canonicalCategory(draft.category, compounds),
      tags: parseTags(draft.tags),
    };
    if (sameLabels(next, labelsOf(latest.current))) return;
    const base = latest.current;
    latest.current = withLabels(base, next);
    onLabels(base, next);
  }

  // Hold the raw geometry of a module lifted from a game, freed with the panel.
  const [raw, setRaw] = useState<RawGeometry | null | undefined>(undefined);
  const lifted = holdsLiftedPieces(module);
  const moduleId = module.id;
  useEffect(() => {
    if (!lifted) return;
    let live = true;
    let held: RawGeometry | null = null;
    loadRawGeometry(moduleId).then(
      (loaded) => {
        if (!live) return disposeRawGeometry(loaded);
        held = loaded;
        setRaw(loaded);
      },
      () => live && setRaw(null),
    );
    return () => {
      live = false;
      if (held) disposeRawGeometry(held);
    };
  }, [lifted, moduleId]);

  return (
    <Frame
      frame={frame}
      name={module.name}
      size={`${builtIn ? "Built in" : "Saved"} · ${count} ${count === 1 ? "piece" : "pieces"}`}
    >
      <Preview
        {...previewSize(frame, builtIn)}
        spin={!reduceMotion}
        build={() => {
          const material = partMaterial(atlas ?? baseAtlas(pack));
          const holder = buildModule(module, pack, raw, material, MODULE_SIZE);
          if (!holder) return null;
          return {
            object: holder.group,
            size: MODULE_SIZE,
            dispose: holder.dispose,
          };
        }}
        deps={[pack, atlas, module, raw]}
      />

      {builtIn ? null : (
        <div className="mt-3 flex flex-col gap-3">
          <Field label="Name">
            <Input
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setNameError(null);
              }}
              onBlur={commitName}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitName();
                } else if (event.key === "Escape" && name !== module.name) {
                  // Gives up the edit. With nothing typed, Escape closes the
                  // panel instead.
                  event.preventDefault();
                  setName(module.name);
                  setNameError(null);
                }
              }}
              aria-label="Module name"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "module-name-error" : undefined}
            />
          </Field>
          {nameError ? (
            <p
              id="module-name-error"
              className="-mt-2 text-xs text-destructive"
            >
              {nameError}
            </p>
          ) : null}
          {actions.onLabels ? (
            // biome-ignore lint/a11y/noStaticElementInteractions: Escape is caught on its way up from the fields inside
            <div
              className="flex flex-col gap-3"
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                const saved = labelsDraft(module);
                if (
                  labels.category === saved.category &&
                  labels.tags === saved.tags
                )
                  return;
                event.preventDefault();
                setLabels(saved);
              }}
            >
              <ModuleLabelsFields
                draft={labels}
                onChange={setLabels}
                suggestions={categorySuggestions(compounds)}
                onCommit={commitLabels}
              />
            </div>
          ) : null}
        </div>
      )}

      {builtIn || liftedFrom ? (
        <Facts>
          {builtIn ? (
            <>
              <dt>Category</dt>
              <dd>{module.category ?? "Uncategorised"}</dd>
              {module.tags?.length ? (
                <>
                  <dt>Tags</dt>
                  <dd>{module.tags.join(", ")}</dd>
                </>
              ) : null}
              <dt>Pieces</dt>
              <dd>{count}</dd>
            </>
          ) : null}
          {liftedFrom ? (
            <>
              <dt>Lifted from</dt>
              <dd>{liftedFrom}</dd>
              {credits.length > 0 ? (
                <>
                  <dt>Credits</dt>
                  <dd className="flex flex-col">
                    {credits.map((credit) => (
                      <span key={credit}>{credit}</span>
                    ))}
                  </dd>
                </>
              ) : null}
            </>
          ) : null}
        </Facts>
      ) : null}

      <Actions>
        {onPlace ? (
          <Button size="sm" onClick={() => onPlace(module)}>
            <Plus size={14} /> Place
          </Button>
        ) : null}
        {builtIn ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => void actions.onCopy(module).then(onCopied)}
          >
            <Copy size={14} /> Make my own copy
          </Button>
        ) : null}
        {actions.onSaveFile && !liftedFrom ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => actions.onSaveFile?.(module)}
          >
            Save to file
          </Button>
        ) : null}
        {actions.onShare && !builtIn ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => actions.onShare?.(module)}
          >
            Share
          </Button>
        ) : null}
        {builtIn ? null : (
          <Button
            size="sm"
            variant="outline"
            className="text-destructive hover:text-destructive"
            onClick={() => {
              actions.onDelete(module.id);
              onDeleted();
            }}
          >
            Delete
          </Button>
        )}
      </Actions>
    </Frame>
  );
}

/** What a preview draws, and how big it is along its longest side. */
interface Built {
  object: THREE.Object3D;
  size: number;
  dispose?: () => void;
}

/**
 * One object, framed and orbitable, turning by itself when `spin` is set.
 * Rebuilt whenever `deps` change. It carries no frame rate label: the corner
 * it would take is the panel's.
 */
function Preview({
  build,
  deps,
  spin = false,
  hint = true,
  className,
}: {
  build: () => Built | null;
  deps: DependencyList;
  spin?: boolean;
  /** Whether to say the preview can be turned by hand. */
  hint?: boolean;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useCanvas3D(
    containerRef,
    ({ renderer }) => {
      const built = build();
      if (!built) return;

      const scene = new THREE.Scene();
      addStandardLights(scene);
      scene.add(built.object);

      // Frame the object rather than the scene, so a sliver fills the view as
      // much as a hull section does.
      const radius = Math.max(built.size, 0.001);
      const camera = new THREE.PerspectiveCamera(
        35,
        1,
        radius / 100,
        radius * 100,
      );
      camera.position.set(radius * 1.6, radius * 1.2, radius * 1.9);

      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enablePan = false;
      controls.minDistance = radius * 0.8;
      controls.maxDistance = radius * 6;

      const render = () => renderer.render(scene, camera);
      controls.addEventListener("change", render);

      // `update` turns the camera and fires "change", which draws.
      controls.autoRotate = spin;
      let frame = 0;
      const turn = () => {
        controls.update();
        frame = requestAnimationFrame(turn);
      };
      if (spin) frame = requestAnimationFrame(turn);

      return {
        render,
        resize: (width, height) => {
          camera.aspect = width / height;
          camera.updateProjectionMatrix();
        },
        dispose: () => {
          cancelAnimationFrame(frame);
          controls.removeEventListener("change", render);
          controls.dispose();
          scene.remove(built.object);
          built.dispose?.();
        },
      };
    },
    [...deps, spin],
  );

  return (
    <div
      className={cn(
        "relative w-full shrink-0 border-b border-border",
        className,
      )}
    >
      <div
        ref={containerRef}
        data-frame-rate="off"
        className="absolute inset-0"
      />
      {hint ? (
        <span className="pointer-events-none absolute bottom-1.5 left-0 text-[11px] text-muted-foreground">
          Drag to turn
        </span>
      ) : null}
    </div>
  );
}
