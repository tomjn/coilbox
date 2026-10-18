/**
 * The unit's loadouts, in the builder's title card (#3281): a switch for the
 * active one, and a popover to add, duplicate, rename and delete them and to
 * say whether the selected piece is shared or the loadout's own.
 *
 * Every change is an edit of its own, so each one undoes on its own.
 */

import { Button, Input } from "@picoframe/frame";
import { Copy, Layers, Plus, Trash2 } from "lucide-react";
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

interface Props {
  project: LegoProject;
  /** The piece the builder is pointed at, whose sharing the popover offers. */
  selectedId: string | null;
  onEdit: (
    change: (project: LegoProject) => LegoProject,
    options: { alone: true },
  ) => void;
}

const newId = () => crypto.randomUUID();

export function LoadoutPicker({ project, selectedId, onEdit }: Props) {
  const loadouts = project.loadouts;
  const edit = (change: (project: LegoProject) => LegoProject) =>
    onEdit(change, { alone: true });

  return (
    <div className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
      {loadouts ? (
        <>
          <span>loadout</span>
          <OptionSelect
            size="sm"
            value={project.activeLoadout ?? ""}
            onValueChange={(id) => edit((p) => switchLoadout(p, id))}
            options={loadouts.map((l) => ({ value: l.id, label: l.name }))}
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
              {loadouts.map((loadout) => (
                <LoadoutRow
                  key={loadout.id}
                  loadout={loadout}
                  active={loadout.id === project.activeLoadout}
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
    </div>
  );
}

function LoadoutRow({
  loadout,
  active,
  onRename,
  onDelete,
}: {
  loadout: LegoLoadout;
  active: boolean;
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
    <li className="flex items-center gap-1">
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
