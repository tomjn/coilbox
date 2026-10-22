/**
 * Which of the unit's game's builders build it (issue #4515). A mutator adds
 * the unit to the end of each one's build list, so a launch through it can
 * build the unit from those factories rather than spawn it with cheats. The
 * builders are read from the unit's own game, as the build menu section does.
 */

import { Trans, useLingui } from "@lingui/react/macro";
import { Button } from "@picoframe/frame";
import { ChevronsUpDown, X } from "lucide-react";
import { useMemo, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { buildersOf } from "../../buildMenuVariants";
import type { LegoProject } from "../../model";
import { useBuildMenuSource } from "./useBuildMenuSource";

interface Props {
  project: LegoProject;
  onBuiltByChange: (builtBy: string[]) => void;
}

export function BuiltBySection({ project, onBuiltByChange }: Props) {
  const { t } = useLingui();
  const source = useBuildMenuSource(project);
  const [open, setOpen] = useState(false);
  const builders = useMemo(
    () => (source.units ? buildersOf(source.units) : []),
    [source.units],
  );
  const chosen = project.builtBy ?? [];
  const nameOf = (key: string) => {
    const name = builders.find((b) => b.key.toLowerCase() === key)?.name;
    return name && name !== key ? `${name} (${key})` : key;
  };
  const offered = builders.filter((b) => !chosen.includes(b.key.toLowerCase()));

  return (
    <div className="flex flex-col gap-2 border-b border-border/60 px-3 py-2">
      <p className="text-sm font-medium">
        <Trans>Built by</Trans>
      </p>
      {chosen.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {chosen.map((key) => {
            const builderName = nameOf(key);
            return (
              <li key={key} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{nameOf(key)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t`Remove ${builderName}`}
                  title={t`Remove`}
                  onClick={() =>
                    onBuiltByChange(chosen.filter((k) => k !== key))
                  }
                >
                  <X className="size-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      ) : null}
      {source.unavailable ? (
        <p className="text-xs text-muted-foreground">{source.unavailable}</p>
      ) : !source.units ? (
        <p className="text-xs text-muted-foreground">
          <Trans>Reading the game.</Trans>
        </p>
      ) : builders.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          <Trans>The game has no builders.</Trans>
        </p>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              aria-expanded={open}
              className="justify-between font-normal"
            >
              <span className="truncate text-muted-foreground">
                <Trans>Add a builder</Trans>
              </span>
              <ChevronsUpDown className="ml-2 size-4 shrink-0 opacity-50" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-0">
            <Command>
              <CommandInput placeholder={t`Search builders…`} />
              <CommandList>
                <CommandEmpty>
                  <Trans>No builder matches that.</Trans>
                </CommandEmpty>
                <CommandGroup>
                  {offered.map((b) => (
                    <CommandItem
                      key={b.key}
                      value={`${b.name} ${b.key}`}
                      onSelect={() => {
                        onBuiltByChange([...chosen, b.key.toLowerCase()]);
                        setOpen(false);
                      }}
                    >
                      {b.name === b.key ? b.key : `${b.name} (${b.key})`}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
