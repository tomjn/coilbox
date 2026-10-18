/**
 * What can be done to a module from its tile (#4536).
 *
 * A module tile used to carry up to six icon buttons at its four corners. The
 * tile is 88 px now and keeps only the star, so the rest sit behind one
 * trigger, each with the word for what it does, as `ProjectCardMenu` does for
 * a tweak project. The detail panel (#4537) is where they go next.
 */

import { Button } from "@picoframe/frame";
import {
  Copy,
  FileDown,
  MoreVertical,
  Pencil,
  Share2,
  Tag,
  Trash2,
} from "lucide-react";
import { useRef, useState } from "react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { LegoProject } from "../../model";
import { ModuleLabelsPopover } from "./ModuleLabelsPopover";

export interface ModuleActions {
  onDelete: (id: string) => void;
  /** Starts the rename field on the tile's name line. */
  onStartRename: (module: LegoProject) => void;
  /** Saves the user's own copy of a built in module. */
  onCopy: (module: LegoProject) => void;
  /** Absent leaves out Save to file. */
  onSaveFile?: (module: LegoProject) => void;
  /** Absent leaves out Share. */
  onShare?: (module: LegoProject) => void;
  /** Absent leaves out Category and tags. */
  onLabels?: (
    module: LegoProject,
    labels: { category: string | undefined; tags: string[] },
  ) => void;
}

interface Props extends ModuleActions {
  module: LegoProject;
  /** Every module, for the categories in use. */
  known: LegoProject[];
  builtIn: boolean;
  /** A module lifted from a game cannot leave the machine as a file. */
  lifted: boolean;
  className?: string;
}

export function ModuleTileMenu({
  module,
  known,
  builtIn,
  lifted,
  className,
  onDelete,
  onStartRename,
  onCopy,
  onSaveFile,
  onShare,
  onLabels,
}: Props) {
  const [labelling, setLabelling] = useState(false);
  // The rename field and the labels popover take focus once the menu has
  // closed, in place of the menu handing it back to its trigger, which would
  // close them again straight away.
  const afterClose = useRef<(() => void) | null>(null);
  const trigger = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={className}
          aria-label={`Actions for the ${module.name} module`}
          title="Actions"
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-48"
        onCloseAutoFocus={(event) => {
          const next = afterClose.current;
          if (!next) return;
          afterClose.current = null;
          event.preventDefault();
          next();
        }}
      >
        {/* A built in module cannot be renamed, relabelled or deleted, so its
            one change is to become the user's own. */}
        {builtIn ? (
          <DropdownMenuItem onSelect={() => onCopy(module)}>
            <Copy className="size-4" aria-hidden="true" /> Make my own copy
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            onSelect={() => {
              afterClose.current = () => onStartRename(module);
            }}
          >
            <Pencil className="size-4" aria-hidden="true" /> Rename
          </DropdownMenuItem>
        )}
        {onLabels && !builtIn ? (
          <DropdownMenuItem
            onSelect={() => {
              afterClose.current = () => setLabelling(true);
            }}
          >
            <Tag className="size-4" aria-hidden="true" /> Category and tags
          </DropdownMenuItem>
        ) : null}
        {onSaveFile && !lifted ? (
          <DropdownMenuItem onSelect={() => onSaveFile(module)}>
            <FileDown className="size-4" aria-hidden="true" /> Save to file
          </DropdownMenuItem>
        ) : null}
        {onShare && !builtIn ? (
          <DropdownMenuItem onSelect={() => onShare(module)}>
            <Share2 className="size-4" aria-hidden="true" /> Share
          </DropdownMenuItem>
        ) : null}
        {builtIn ? null : (
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => onDelete(module.id)}
          >
            <Trash2 className="size-4" aria-hidden="true" /> Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // The top left corner of the tile, the star having the top right.
  const placed = <span className="absolute left-0 top-0">{trigger}</span>;
  if (!onLabels || builtIn) return placed;
  return (
    <ModuleLabelsPopover
      compound={module}
      known={known}
      onSave={onLabels}
      open={labelling}
      onOpenChange={setLabelling}
    >
      {placed}
    </ModuleLabelsPopover>
  );
}
