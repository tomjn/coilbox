/**
 * What can be done to a tweak project without opening it (issue #2706).
 *
 * The card used to carry five ghost icon buttons: pencil, two rectangles,
 * download, link, bin. Nothing said what any of them did, and the pencil was
 * the worst of them, because a pencil beside a project is the strongest signal
 * there is that it is how you edit the project. It renamed it. The card is what
 * opens the project.
 *
 * So the card is a link and the five actions moved in here behind one trigger,
 * where each carries the word for what it does. That is `ScenarioRowMenu`'s
 * answer to the same problem on the scenario list, and the two pages are meant
 * to read as siblings. A label settles what a tooltip only explains to somebody
 * who already hovered the right thing and waited.
 *
 * The trigger is on every card, all the time: muted at rest and full strength
 * once the card is hovered or holds focus. Fading it in from nothing leaves
 * nothing to aim at on a touch screen, which is the regression #2203 records.
 */

import { Button, Drawer } from "@picoframe/frame";
import {
  CopyPlus,
  Download,
  Link2,
  MoreVertical,
  Pencil,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { describeEdits, type ModProject } from "../../project";

export function ProjectCardMenu({
  project,
  onRename,
  onDuplicate,
  onExport,
  onCopyLink,
  onDelete,
}: {
  project: ModProject;
  onRename: () => void;
  onDuplicate: () => void;
  onExport: () => void;
  onCopyLink: () => void;
  onDelete: () => void;
}) {
  /**
   * Deleting throws away every edit in the project and undo does not reach past
   * it, so it asks first. In a drawer rather than a box hanging off the menu
   * item, for the reason `ScenarioRowMenu` gives: the menu has closed by the
   * time the confirmation is on screen.
   */
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <DropdownMenu>
        <Tooltip>
          <TooltipTrigger asChild>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="size-8 shrink-0 text-muted-foreground opacity-60 transition-opacity hover:opacity-100 group-focus-within:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                aria-label={`Actions for ${project.name}`}
              >
                <MoreVertical className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </TooltipTrigger>
          {/* Above the card rather than beside the trigger, which on a card this
              narrow put the tip over the project's own name. */}
          <TooltipContent side="top">
            Rename, duplicate, share or delete
          </TooltipContent>
        </Tooltip>
        <DropdownMenuContent align="end" className="w-52">
          <DropdownMenuItem onSelect={onRename}>
            <Pencil className="size-4" aria-hidden="true" /> Rename
          </DropdownMenuItem>
          {/* Not the two-rectangles clipboard glyph, which means copy to
              clipboard everywhere else in the app and would read as the same
              job as Copy a share link two rows down (issue #2706). */}
          <DropdownMenuItem onSelect={onDuplicate}>
            <CopyPlus className="size-4" aria-hidden="true" /> Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onExport}>
            <Download className="size-4" aria-hidden="true" /> Export as a file
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={onCopyLink}>
            <Link2 className="size-4" aria-hidden="true" /> Copy a share link
          </DropdownMenuItem>
          <DropdownMenuItem
            variant="destructive"
            onSelect={() => setConfirming(true)}
          >
            <Trash2 className="size-4" aria-hidden="true" /> Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Drawer
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete ${project.name}`}
        description="Nothing puts a deleted project back."
        width="24rem"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm">
            {describeEdits(project.edits)}. Export it first if you might want
            it.
          </p>
          <Button
            className="gap-1.5"
            variant="destructive"
            onClick={() => {
              setConfirming(false);
              onDelete();
            }}
          >
            <Trash2 className="size-4" aria-hidden="true" /> Delete
          </Button>
        </div>
      </Drawer>
    </>
  );
}
