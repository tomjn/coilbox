import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Plus, X } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import type { GameItem } from "@/content/bindings";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { LegoProject } from "@/lego/model";
import { useLegoProjects } from "@/lego/projects";
import { forGame, unitGame } from "@/lego/unitGame";
import type { CampaignUnit } from "../../model";
import { UnitPickerList, UnitThumbnail } from "./CampaignUnits";

/** The entries a pick list stands for, so the picker can refuse a clash. */
function pickedEntries(picked: readonly LegoProject[]): CampaignUnit[] {
  return picked.map((p) => ({
    unitName: p.unitName,
    projectId: p.id,
    name: p.name,
    builtBy: p.builtBy ?? [],
    copiedAt: "",
  }));
}

/**
 * The units from the unit builder a conquest or warpath run begins with (issue
 * #4518). Each is copied when it begins. Only units for the run's game, or for
 * no game, are offered. Nothing shows when the library has none of those, so a
 * player who never builds one sees the setup as it was.
 */
export function StartingUnits({
  label,
  game,
  installed,
  picked,
  onChange,
  disabled = false,
}: {
  label: ReactNode;
  /** The game the run plays, or null before it is known. */
  game: GameItem | null;
  installed: readonly GameItem[];
  picked: readonly LegoProject[];
  onChange: (next: LegoProject[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const { projects: all } = useLegoProjects();
  const [open, setOpen] = useState(false);
  const fits = (p: LegoProject) =>
    game ? forGame(p, game, installed) : !unitGame(p);
  const projects = all.filter(fits);
  const kept = picked.filter(fits);
  const dropped = kept.length !== picked.length;

  // A warpath's game can change after units are picked. Units for the old game
  // go, rather than sit in the list and fail when the run starts.
  useEffect(() => {
    if (dropped) onChange(kept);
  }, [dropped, kept, onChange]);

  if (projects.length === 0) return null;

  return (
    <div className="flex flex-col gap-1.5">
      {label}
      {picked.length > 0 && (
        <ul className="flex flex-col gap-1">
          {picked.map((p) => {
            const name = p.name;
            return (
              <li
                key={p.id}
                className="flex items-center gap-2 rounded-md border border-border/50 bg-card px-2.5 py-1.5"
              >
                <UnitThumbnail projectId={p.id} className="size-10" />
                <span className="min-w-0 flex-1 truncate text-sm font-medium">
                  {p.name}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t`Remove ${name}`}
                  disabled={disabled}
                  onClick={() => onChange(picked.filter((q) => q.id !== p.id))}
                >
                  <X className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 self-start"
            disabled={disabled}
          >
            <Plus className="size-4" /> <Trans>Add unit</Trans>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80">
          <UnitPickerList
            owner={{ units: pickedEntries(picked) }}
            projects={projects}
            onPick={(project) => {
              onChange([...picked, project]);
              setOpen(false);
            }}
            onLeave={() => setOpen(false)}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
