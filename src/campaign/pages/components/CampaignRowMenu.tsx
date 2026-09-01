/**
 * What can be done to a campaign without opening it (issue #2188).
 *
 * The row itself is a link into the editor, because that is what nearly every
 * click on a campaign wants. A button inside a link is a link nobody can trust,
 * so Edit, Export and Delete sit here, beside the link and above it, in one
 * menu. The menu is a button like any other: it takes focus, opens on Enter or
 * Space, and walks with the arrow keys, so nothing here is mouse-only.
 *
 * The trigger is on every row it belongs to, all the time. It is muted at rest
 * and full strength once the row is hovered or holds focus, which is a change
 * of emphasis rather than of existence. A control that only appears on hover
 * has no affordance at rest, cannot be found on a touch screen, and is the
 * regression issue #2203 records against the scenario list's version of this.
 *
 * Only local campaigns get a menu, because a bundled one has nothing here it is
 * allowed to do. That is the page's call, not this component's. Issue #2191
 * wants Export offered on bundled rows too, which is where the split between
 * "may be edited" and "may be exported" will first be worth having.
 */

import { Button, useDrawer } from "@picoframe/frame";
import { MoreVertical, Pencil, Trash2, Upload } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ErrorBanner } from "../../../content/pages/components/states";
import type { Campaign } from "../../model";

export function CampaignRowMenu({
  campaign,
  onExport,
  onDelete,
}: {
  campaign: Campaign;
  onExport: () => void;
  onDelete: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const drawer = useDrawer();

  /** A drawer rather than a box hanging off a menu item, because the menu has
   *  closed by the time the confirmation is on screen. */
  const confirmDelete = () =>
    drawer.open({
      title: `Delete ${campaign.title}`,
      width: "24rem",
      content: (
        <DeleteCampaignForm
          campaign={campaign}
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
          className="size-8 shrink-0 text-muted-foreground opacity-60 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 data-[state=open]:opacity-100"
          aria-label={`Actions for ${campaign.title}`}
        >
          <MoreVertical className="size-4" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem
          onSelect={() => navigate(`/campaign-builder/${campaign.id}`)}
        >
          <Pencil className="size-4" aria-hidden="true" /> Edit
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onExport}>
          <Upload className="size-4" aria-hidden="true" /> Export
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onSelect={confirmDelete}>
          <Trash2 className="size-4" aria-hidden="true" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** The confirmation behind Delete. It reports its own failure, because the page
 *  behind the drawer is not what somebody is looking at when it fails. */
function DeleteCampaignForm({
  campaign,
  onDelete,
  onDone,
}: {
  campaign: Campaign;
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
        Delete <span className="font-medium">{campaign.title}</span> and its
        images? This can't be undone.
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
