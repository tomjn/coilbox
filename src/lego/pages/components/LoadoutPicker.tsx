/**
 * The unit's loadouts, in the builder's title card (#3281): a switch for the
 * active one, and a popover to add, duplicate, rename and delete them and to
 * say whether the selected piece is shared or the loadout's own.
 *
 * Every change is an edit of its own, so each one undoes on its own.
 */

import { Button, Input } from "@picoframe/frame";
import { Columns3, Copy, Layers, Plus, Trash2 } from "lucide-react";
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
}: Props) {
  const loadouts = project.loadouts;
  const edit = (change: (project: LegoProject) => LegoProject) =>
    onEdit(change, { alone: true });
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
          <span>loadout</span>
          <OptionSelect
            size="sm"
            value={project.activeLoadout ?? ""}
            onValueChange={switchTo}
            options={chainOrder(loadouts).map((l) => {
              const from = predecessorOf(project, l);
              return {
                value: l.id,
                label: from ? `${l.name} (from ${from.name})` : l.name,
              };
            })}
            ariaLabel="Loadout"
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
            title="Loadouts"
            aria-label="Loadouts"
          >
            <Layers className="size-3.5" />
            {loadouts ? null : "Loadouts"}
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
                  fromOptions={[
                    { value: NO_PREDECESSOR, label: "Not an upgrade" },
                    ...loadouts
                      .filter((other) => other.id !== loadout.id)
                      .map((other) => ({
                        value: other.id,
                        label: `From ${other.name}`,
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
              Add
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="flex-1"
              onClick={() => edit((p) => duplicateLoadout(p, { newId }))}
            >
              <Copy className="size-3.5" />
              Duplicate
            </Button>
          </div>
          <PieceSharing project={project} pieceId={selectedId} onEdit={edit} />
        </PopoverContent>
      </Popover>
      {loadouts && loadouts.length > 1 ? (
        <>
          <Button
            size="icon"
            variant="ghost"
            className="size-5"
            title="Compare loadouts"
            aria-label="Compare loadouts"
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
          />
        </>
      ) : null}
    </div>
  );
}

function LoadoutRow({
  loadout,
  active,
  fromOptions,
  onUpgradesFrom,
  onRename,
  onDelete,
}: {
  loadout: LegoLoadout;
  active: boolean;
  fromOptions: { value: string; label: string; disabled?: boolean }[];
  onUpgradesFrom: (from: string) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
}) {
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
          aria-label={`Name of ${loadout.name}`}
          aria-current={active ? "true" : undefined}
          className={`h-7 min-w-0 flex-1 text-xs ${active ? "font-semibold" : ""}`}
        />
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          title="Delete"
          aria-label={`Delete ${loadout.name}`}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {fromOptions.length > 2 ? (
        <OptionSelect
          size="sm"
          value={loadout.upgradesFrom ?? NO_PREDECESSOR}
          onValueChange={onUpgradesFrom}
          options={fromOptions}
          ariaLabel={`Upgrade of, for ${loadout.name}`}
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
  const active = project.loadouts?.find((l) => l.id === project.activeLoadout);
  const piece = pieceId ? pieceById(project, pieceId) : undefined;
  if (!active || !piece || piece.id === project.rootPieceId) return null;
  const owned = loadoutPieceIds(project);
  if (piece.parentId && owned.has(piece.parentId)) return null;
  const own = owned.has(piece.id);

  return (
    <div className="space-y-1">
      <p className="truncate text-xs text-muted-foreground">{piece.name}</p>
      <div className="flex items-center gap-1">
        {[
          { value: false, label: "Every loadout" },
          { value: true, label: `Only ${active.name}` },
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
