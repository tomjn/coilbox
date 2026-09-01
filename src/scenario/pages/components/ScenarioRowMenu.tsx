/**
 * What can be done to a scenario without opening it (issue #2182).
 *
 * The row itself is a link into the editor, because that is what nearly every
 * click on a scenario wants. A button inside a link is a link nobody can trust,
 * so the rest of the actions sit here, beside the link and above it, in one
 * menu. The menu is a button like any other: it takes focus, opens on Enter or
 * Space, and walks with the arrow keys, so nothing here is mouse-only even
 * though the trigger fades in on hover.
 *
 * Which items appear is the caller's call, since the page already works out
 * what a bundled scenario and a game's own mission may do.
 */

import { Button, useDrawer } from "@picoframe/frame";
import { MoreVertical, Pencil, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ErrorBanner } from "../../../content/pages/components/states";
import type { Scenario } from "../../model";

export function ScenarioRowMenu({
  scenario,
  editable,
  deletable,
  attached,
  onShare,
  onDelete,
}: {
  scenario: Scenario;
  /** Whether the editor may write this one back where it came from. */
  editable: boolean;
  /** Bundled scenarios and a game's own missions are never deleted from here. */
  deletable: boolean;
  /** A campaign mission carries a copy of this scenario, which changes what
   *  deleting it leaves behind, so the confirmation says so. */
  attached: boolean;
  onShare: () => void;
  onDelete: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const drawer = useDrawer();

  /** A drawer rather than a box hanging off a menu item, because the menu has
   *  closed by the time the confirmation is on screen. */
  const confirmDelete = () =>
    drawer.open({
      title: `Delete ${scenario.name}`,
      width: "24rem",
      content: (
        <DeleteScenarioForm
          scenario={scenario}
          attached={attached}
          onDelete={onDelete}
          onDone={() => drawer.close()}
        />
      ),
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-8 text-muted-foreground opacity-0 transition-opacity focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100 [@media(pointer:coarse)]:opacity-100"
          aria-label={`Actions for ${scenario.name}`}
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {editable && (
          <DropdownMenuItem
            onSelect={() => navigate(`/scenario-builder/${scenario.id}`)}
          >
            <Pencil className="size-4" aria-hidden="true" /> Edit
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={onShare}>
          <Share2 className="size-4" aria-hidden="true" /> Share
        </DropdownMenuItem>
        {deletable && (
          <DropdownMenuItem variant="destructive" onSelect={confirmDelete}>
            <Trash2 className="size-4" aria-hidden="true" /> Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The confirmation behind Delete. It reports its own failure, because the page
 *  behind the drawer is not what somebody is looking at when it fails. */
function DeleteScenarioForm({
  scenario,
  attached,
  onDelete,
  onDone,
}: {
  scenario: Scenario;
  attached: boolean;
  onDelete: () => Promise<void>;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async () => {
    setBusy(true);
    setError(null);
    try {
      await onDelete();
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm">
        Delete <span className="font-medium">{scenario.name}</span>
        {attached
          ? "? A campaign mission uses it, so its dialogue clips stay behind for that mission. This can't be undone."
          : " and its dialogue clips? This can't be undone."}
      </p>
      {error && <ErrorBanner message={error} />}
      <Button
        className="gap-1.5"
        variant="destructive"
        disabled={busy}
        onClick={() => void remove()}
      >
        <Trash2 className="size-4" aria-hidden="true" />{" "}
        {busy ? "Deleting…" : "Delete"}
      </Button>
    </div>
  );
}
