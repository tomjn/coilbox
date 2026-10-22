/**
 * The unit's saved poses (#3355): the switch for the posing mode, a name and a
 * save for the pose being held, and a list to apply, overwrite, duplicate,
 * rename and delete them.
 *
 * A popover in the view's own controls, not a dialog, so the model stays in
 * view while it is posed.
 */

import { Plural, Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import {
  Copy,
  PersonStanding,
  Play,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { LegoPose, LegoProject } from "../../model";
import { missingPieces } from "../../pose";

interface Props {
  project: LegoProject;
  posing: boolean;
  onPosingChange: (on: boolean) => void;
  /** Whether the pose being held differs from rest. */
  changed: boolean;
  onSave: (name: string) => void;
  onApply: (id: string) => void;
  onOverwrite: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  /** Put every piece back to rest, as one step that undo takes back. */
  onReset: () => void;
}

export function PosesPopover({
  project,
  posing,
  onPosingChange,
  changed,
  onSave,
  onApply,
  onOverwrite,
  onRename,
  onDuplicate,
  onDelete,
  onReset,
}: Props) {
  const { t } = useLingui();
  const poses = project.poses ?? [];
  const [name, setName] = useState("");

  function save() {
    onSave(name);
    setName("");
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          size="icon"
          variant={posing ? "default" : "outline"}
          title={t`Poses`}
          aria-label={t`Poses`}
          aria-pressed={posing}
        >
          <PersonStanding className="size-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-80 space-y-3">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant={posing ? "default" : "outline"}
            aria-pressed={posing}
            className="flex-1"
            onClick={() => onPosingChange(!posing)}
          >
            {posing ? t`Leave posing` : t`Pose the unit`}
          </Button>
          {posing ? (
            <Button
              size="icon"
              variant="outline"
              title={t`Reset to the built shape`}
              aria-label={t`Reset to the built shape`}
              disabled={!changed}
              onClick={onReset}
            >
              <RotateCcw className="size-4" />
            </Button>
          ) : null}
        </div>

        {posing ? (
          <div className="flex items-center gap-1">
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && changed) save();
              }}
              placeholder={t`Pose name`}
              aria-label={t`Pose name`}
              className="h-8 min-w-0 flex-1 text-xs"
            />
            <Button
              size="sm"
              variant="outline"
              disabled={!changed}
              onClick={save}
            >
              <Trans>Save</Trans>
            </Button>
          </div>
        ) : null}

        {poses.length > 0 ? (
          <ul className="space-y-1">
            {poses.map((pose) => (
              <PoseRow
                key={pose.id}
                pose={pose}
                missing={missingPieces(pose, project).length}
                canOverwrite={posing && changed}
                onApply={() => onApply(pose.id)}
                onOverwrite={() => onOverwrite(pose.id)}
                onRename={(next) => onRename(pose.id, next)}
                onDuplicate={() => onDuplicate(pose.id)}
                onDelete={() => onDelete(pose.id)}
              />
            ))}
          </ul>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function PoseRow({
  pose,
  missing,
  canOverwrite,
  onApply,
  onOverwrite,
  onRename,
  onDuplicate,
  onDelete,
}: {
  pose: LegoPose;
  missing: number;
  canOverwrite: boolean;
  onApply: () => void;
  onOverwrite: () => void;
  onRename: (name: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const { t } = useLingui();
  const poseName = pose.name;
  const [name, setName] = useState(pose.name);
  useEffect(() => setName(pose.name), [pose.name]);

  function commit() {
    if (name.trim() === "" || name.trim() === pose.name) setName(pose.name);
    else onRename(name);
  }

  return (
    <li className="space-y-0.5">
      <div className="flex items-center gap-1">
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") setName(pose.name);
          }}
          aria-label={t`Name of ${poseName}`}
          className="h-7 min-w-0 flex-1 text-xs"
        />
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          title={t`Apply`}
          aria-label={t`Apply ${poseName}`}
          onClick={onApply}
        >
          <Play className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          title={t`Overwrite with the pose being held`}
          aria-label={t`Overwrite ${poseName}`}
          disabled={!canOverwrite}
          onClick={onOverwrite}
        >
          <Save className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          title={t`Duplicate`}
          aria-label={t`Duplicate ${poseName}`}
          onClick={onDuplicate}
        >
          <Copy className="size-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          title={t`Delete`}
          aria-label={t`Delete ${poseName}`}
          onClick={onDelete}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {missing > 0 ? (
        <p className="text-xs text-muted-foreground">
          <Plural
            value={missing}
            one="# piece deleted"
            other="# pieces deleted"
          />
        </p>
      ) : null}
    </li>
  );
}
