import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { Plus, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { LegoProject } from "@/lego/model";
import { useLegoProjects } from "@/lego/projects";
import type { CampaignUnit } from "../../model";
import { UnitPickerList } from "./CampaignUnits";

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
 * #4518). Each is copied when it begins. Nothing shows when the library has no
 * units, so a player who never builds one sees the setup as it was.
 */
export function StartingUnits({
  label,
  picked,
  onChange,
  disabled = false,
}: {
  label: ReactNode;
  picked: readonly LegoProject[];
  onChange: (next: LegoProject[]) => void;
  disabled?: boolean;
}) {
  const { t } = useLingui();
  const { projects } = useLegoProjects();
  const [open, setOpen] = useState(false);
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
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-medium">{p.name}</span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {p.unitName}
                  </span>
                </div>
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
