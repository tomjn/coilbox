/**
 * The unit's loadouts, in the builder's title card (#3281): a switch for the
 * active one, and a popover to add, duplicate, rename and delete them and to
 * say whether the selected piece is shared or the loadout's own.
 *
 * Every change is an edit of its own, so each one undoes on its own.
 */

import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import {
  Columns3,
  Copy,
  Layers,
  Lock,
  LockOpen,
  Plus,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import { OptionSelect } from "@/components/OptionSelect";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  addLoadout,
  deleteLoadout,
  duplicateLoadout,
  loadoutPieceIds,
  renameLoadout,
  setInLoadout,
  switchLoadout,
} from "../../loadouts";
import {
  heldModules,
  lockReason,
  setLoadoutLocked,
  setModuleLocked,
  type UnitLock,
  unitLocks,
} from "../../locks";
import { type LegoLoadout, type LegoProject, pieceById } from "../../model";
import type { LoadedPack } from "../../pack";
import type { RawGeometry } from "../../rawGeometry";
import { type Capture, THUMBNAIL_VIEW } from "../../thumbnail";
import {
  chainOrder,
  predecessorOf,
  setUpgradesFrom,
  upgradeRefusal,
} from "../../upgradeChain";
import { LoadoutFamilyDrawer } from "./LoadoutFamilyDrawer";

interface Props {
  project: LegoProject;
  /** The piece the builder is pointed at, whose sharing the popover offers. */
  selectedId: string | null;
  onEdit: (
    change: (project: LegoProject) => LegoProject,
    options: { alone: true },
  ) => void;
  /** What the family view needs for the stats and the pictures. Without them it
   *  shows the mounts only, and no pictures. */
  pack?: LoadedPack | null;
  raw?: RawGeometry | null;
  capture?: Capture;
  /** The names of the modules by id, for saying which one locks a loadout. A
   *  module without one shows as its id. */
  moduleNames?: ReadonlyMap<string, string>;
}

/** The side of the square each loadout is photographed at, in pixels. */
const FAMILY_PICTURE_PIXELS = 160;

const NO_PREDECESSOR = "__none";

const newId = () => crypto.randomUUID();

export function LoadoutPicker({
  project,
  selectedId,
  onEdit,
  pack = null,
  raw = null,
  capture,
  moduleNames,
}: Props) {
  const { t } = useLingui();
  const loadouts = project.loadouts;
  const moduleName = (id: string) => moduleNames?.get(id) ?? id;
  const locks = unitLocks(project);
  const lockOf = (id: string | null) => locks.find((l) => l.loadoutId === id);
  const edit = (change: (project: LegoProject) => LegoProject) =>
    onEdit(change, { alone: true });
  const fromLabel = (name: string) => t`From ${name}`;
  const [comparing, setComparing] = useState(false);
  const [pictures, setPictures] = useState<Record<string, string>>({});

  // Only the loadout on the chassis can be photographed, so each is photographed
  // when it is about to leave and when the family view opens.
  function remember() {
    const id = project.activeLoadout;
    const canvas = id
      ? capture?.({
          pixels: FAMILY_PICTURE_PIXELS,
          background: null,
          view: THUMBNAIL_VIEW,
        })
      : null;
    if (id && canvas)
      setPictures((was) => ({ ...was, [id]: canvas.toDataURL("image/png") }));
  }
  function switchTo(id: string) {
    remember();
    edit((p) => switchLoadout(p, id));
  }

  return (
    <div className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
      {loadouts ? (
        <>
          <span>
            <Trans>loadout</Trans>
          </span>
          <OptionSelect
            size="sm"
            value={project.activeLoadout ?? ""}
            onValueChange={switchTo}
            options={chainOrder(loadouts).map((l) => {
              const from = predecessorOf(project, l);
              const name = l.name;
              const fromName = from?.name ?? "";
              const locked = lockOf(l.id)?.locked;
              let label = name;
              if (from && locked)
                label = t`${name} (from ${fromName}) (locked)`;
              else if (from) label = t`${name} (from ${fromName})`;
              else if (locked) label = t`${name} (locked)`;
              return { value: l.id, label };
            })}
            ariaLabel={t`Loadout`}
            className="h-5 w-40 border-transparent bg-transparent px-1 text-xs hover:border-border focus-visible:border-border"
          />
        </>
      ) : null}
      <Popover>
        <PopoverTrigger asChild>
          <Button
            size={loadouts ? "icon" : "sm"}
            variant="ghost"
            className={
              loadouts ? "size-5" : "h-5 gap-1 px-1 text-xs font-normal"
            }
            title={t`Loadouts`}
            aria-label={t`Loadouts`}
          >
            <Layers className="size-3.5" />
            {loadouts ? null : <Trans>Loadouts</Trans>}
          </Button>
        </PopoverTrigger>
        <PopoverContent side="bottom" align="start" className="w-72 space-y-3">
          {loadouts ? (
            <ul className="space-y-1">
              {chainOrder(loadouts).map((loadout) => (
                <LoadoutRow
                  key={loadout.id}
                  loadout={loadout}
                  active={loadout.id === project.activeLoadout}
                  lock={lockOf(loadout.id)}
                  moduleName={moduleName}
                  onLock={(locked) =>
                    edit((p) => setLoadoutLocked(p, loadout.id, locked))
                  }
                  fromOptions={[
                    { value: NO_PREDECESSOR, label: t`Not an upgrade` },
                    ...loadouts
                      .filter((other) => other.id !== loadout.id)
                      .map((other) => ({
                        value: other.id,
                        label: fromLabel(other.name),
                        disabled:
                          other.id !== loadout.upgradesFrom &&
                          upgradeRefusal(project, loadout.id, other.id) !==
                            null,
                      })),
                  ]}
                  onUpgradesFrom={(from) =>
                    edit((p) =>
                      setUpgradesFrom(
                        p,
                        loadout.id,
                        from === NO_PREDECESSOR ? null : from,
                      ),
                    )
                  }
                  onRename={(name) =>
                    edit((p) => renameLoadout(p, loadout.id, name))
                  }
                  onDelete={() => edit((p) => deleteLoadout(p, loadout.id))}
                />
              ))}
            </ul>
          ) : null}
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => edit((p) => addLoadout(p, { newId }))}
            >
              <Plus className="size-3.5" />
              <Trans>Add</Trans>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => edit((p) => duplicateLoadout(p, { newId }))}
            >
              <Copy className="size-3.5" />
              <Trans>Duplicate</Trans>
            </Button>
          </div>
          <PieceSharing project={project} pieceId={selectedId} onEdit={edit} />
          <ModuleLocks
            project={project}
            lock={loadouts ? undefined : lockOf(null)}
            moduleName={moduleName}
            onEdit={edit}
          />
        </PopoverContent>
      </Popover>
      {loadouts && loadouts.length > 1 ? (
        <>
          <Button
            size="icon"
            variant="ghost"
            className="size-5"
            title={t`Compare loadouts`}
            aria-label={t`Compare loadouts`}
            onClick={() => {
              remember();
              setComparing(true);
            }}
          >
            <Columns3 className="size-3.5" />
          </Button>
          <LoadoutFamilyDrawer
            open={comparing}
            onOpenChange={setComparing}
            project={project}
            pack={pack}
            raw={raw}
            pictures={pictures}
            onSwitch={switchTo}
            moduleName={moduleName}
          />
        </>
      ) : null}
    </div>
  );
}

function LoadoutRow({
  loadout,
  active,
  lock,
  moduleName,
  onLock,
  fromOptions,
  onUpgradesFrom,
  onRename,
  onDelete,
}: {
  loadout: LegoLoadout;
  active: boolean;
  lock: UnitLock | undefined;
  moduleName: (id: string) => string;
  onLock: (locked: boolean) => void;
  fromOptions: { value: string; label: string; disabled?: boolean }[];
  onUpgradesFrom: (from: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const loadoutName = loadout.name;
  const [name, setName] = useState(loadout.name);
  useEffect(() => setName(loadout.name), [loadout.name]);

  function commit() {
    if (name.trim() === "") setName(loadout.name);
    else if (name.trim() !== loadout.name) onRename(name);
  }

  return (
    <li className="space-y-1">
      <div className="flex items-center gap-1">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setName(loadout.name);
          }}
          aria-label={t`Name of ${loadoutName}`}
          aria-current={active ? "true" : undefined}
          className={`h-7 min-w-0 flex-1 text-xs ${active ? "font-semibold" : ""}`}
        />
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          title={t`Locked until a campaign grants it`}
          aria-label={t`Lock ${loadoutName}`}
          aria-pressed={loadout.locked === true}
          onClick={() => onLock(loadout.locked !== true)}
        >
          {loadout.locked ? (
            <Lock className="size-3.5" />
          ) : (
            <LockOpen className="size-3.5" />
          )}
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          title={t`Delete`}
          aria-label={t`Delete ${loadoutName}`}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {lock?.locked ? (
        <p className="truncate text-xs text-amber-300">
          {lockReason(lock, moduleName)}
        </p>
      ) : null}
      {fromOptions.length > 2 ? (
        <OptionSelect
          size="sm"
          value={loadout.upgradesFrom ?? NO_PREDECESSOR}
          onValueChange={onUpgradesFrom}
          options={fromOptions}
          ariaLabel={t`Upgrade of, for ${loadoutName}`}
          className="h-6 w-full text-xs"
        />
      ) : null}
    </li>
  );
}

/**
 * Shared or this loadout's own, for the selected piece. Only a piece hanging
 * straight off the chassis can change: one under a loadout piece goes with it.
 */
function PieceSharing({
  project,
  pieceId,
  onEdit,
}: {
  project: LegoProject;
  pieceId: string | null;
  onEdit: (change: (project: LegoProject) => LegoProject) => void;
}) {
  const { t } = useLingui();
  const active = project.loadouts?.find((l) => l.id === project.activeLoadout);
  const piece = pieceId ? pieceById(project, pieceId) : undefined;
  if (!active || !piece || piece.id === project.rootPieceId) return null;
  const owned = loadoutPieceIds(project);
  if (piece.parentId && owned.has(piece.parentId)) return null;
  const own = owned.has(piece.id);
  const activeName = active.name;

  return (
    <div className="space-y-1">
      <p className="truncate text-xs text-muted-foreground">{piece.name}</p>
      <div className="flex items-center gap-1">
        {[
          { value: false, label: t`Every loadout` },
          { value: true, label: t`Only ${activeName}` },
        ].map((option) => (
          <Button
            key={option.label}
            size="sm"
            variant={own === option.value ? "default" : "outline"}
            aria-pressed={own === option.value}
            className="min-w-0 flex-1 truncate"
            onClick={() =>
              onEdit((p) => setInLoadout(p, piece.id, option.value))
            }
          >
            {option.label}
          </Button>
        ))}
      </div>
    </div>
  );
}

/**
 * A lock for each module the unit holds. A locked module locks every loadout
 * that holds it. For a unit without loadouts it locks the unit, and `lock` says
 * so.
 */
function ModuleLocks({
  project,
  lock,
  moduleName,
  onEdit,
}: {
  project: LegoProject;
  lock: UnitLock | undefined;
  moduleName: (id: string) => string;
  onEdit: (change: (project: LegoProject) => LegoProject) => void;
}) {
  const { t } = useLingui();
  const held = heldModules(project);
  if (held.length === 0) return null;
  const locked = new Set(project.lockedModules ?? []);
  const lockModuleLabel = (name: string) => t`Lock module ${name}`;
  const unitName = project.unitName;
  const reason = lock?.locked
    ? (lockReason(lock, moduleName)?.toLowerCase() ?? "")
    : "";
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">
        <Trans>Modules locked until a campaign grants them</Trans>
      </p>
      <ul className="space-y-0.5">
        {held.map((id) => (
          <li key={id} className="flex items-center gap-1 text-xs">
            <span className="min-w-0 flex-1 truncate">{moduleName(id)}</span>
            <Button
              size="icon"
              variant="ghost"
              className="size-6"
              title={t`Locks every loadout that holds it`}
              aria-label={lockModuleLabel(moduleName(id))}
              aria-pressed={locked.has(id)}
              onClick={() =>
                onEdit((p) => setModuleLocked(p, id, !locked.has(id)))
              }
            >
              {locked.has(id) ? (
                <Lock className="size-3.5" />
              ) : (
                <LockOpen className="size-3.5" />
              )}
            </Button>
          </li>
        ))}
      </ul>
      {lock?.locked ? (
        <p className="text-xs text-amber-300">
          <Trans>
            {unitName} is {reason}
          </Trans>
        </p>
      ) : null}
    </div>
  );
}
