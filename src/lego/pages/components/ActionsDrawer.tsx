/**
 * The timeline of one action (#3356): its keys in order, each a saved pose and
 * the seconds to reach it, what starts it and whether it loops.
 *
 * Not modal, so the unit stays in view and the preview can play beside it.
 * Every change is one edit of the document, so the preview runs again from the
 * script the edit writes.
 */

import { Button, Input } from "@picoframe/frame";
import { ArrowDown, ArrowUp, Play, Trash2, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useMemo, useState } from "react";

import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  actionClashes,
  actionHooks,
  addKey,
  blendOf,
  emitActions,
  isHookTrigger,
  liveSteps,
  moveKey,
  removeKey,
  renameAction,
  STOP_CALLIN,
  setActionBlend,
  setActionLoop,
  setActionTrigger,
  setKeyPose,
  setKeySeconds,
  sharedOutcome,
  soloActionProject,
  triggerProblem,
} from "../../actions";
import type { LegoProject } from "../../model";

/** The trigger Select's entry for a function of the action's own. */
const OWN_FUNCTION = "own";

interface Props {
  project: LegoProject;
  actionId: string;
  onOpenChange: (open: boolean) => void;
  onEdit: (change: (project: LegoProject) => LegoProject) => void;
  /** Plays the action in the preview. */
  onPlay: (actionId: string) => void;
  /** Whether the preview is playing this action now. */
  playing: boolean;
  /** Disables Play while a run is starting or the system asks for no motion. */
  playDisabled?: boolean;
}

export function ActionsDrawer({
  project,
  actionId,
  onOpenChange,
  onEdit,
  onPlay,
  playing,
  playDisabled,
}: Props) {
  const action = project.actions?.find((a) => a.id === actionId);
  const [name, setName] = useState(action?.name ?? "");
  useEffect(() => setName(action?.name ?? ""), [action?.name]);
  const [own, setOwn] = useState(action?.trigger ?? "");
  useEffect(() => {
    if (action && !isHookTrigger(project, action.trigger)) {
      setOwn(action.trigger);
    }
  }, [action, project]);

  const lines = useMemo(() => {
    if (!action) return 0;
    const written = emitActions(
      soloActionProject(project, action.id),
      (piece) => piece.name,
    );
    return (
      written.signals.length +
      written.functions.filter((line) => line !== "").length +
      Object.values(written.hooks).flat().length +
      written.own.filter((line) => line !== "").length
    );
  }, [action, project]);

  if (!action) return null;

  const poses = project.poses ?? [];
  const hooks = actionHooks(project);
  const isOwn = !isHookTrigger(project, action.trigger);
  const stop = STOP_CALLIN[action.trigger];
  const seconds = liveSteps(action, project).reduce(
    (sum, step) => sum + step.seconds,
    0,
  );
  const clashes = actionClashes(project).filter(
    (clash) => clash.action.id === action.id,
  );
  const clashText = [
    ...new Set(clashes.map((clash) => `${clash.piece.name} (${clash.with})`)),
  ];
  const blend = blendOf(action, project);
  const edit = (change: (p: LegoProject) => LegoProject) => onEdit(change);
  const ownProblem = isOwn ? triggerProblem(project, action.trigger) : null;

  function commitName() {
    if (name.trim() === "" || name.trim() === action?.name) {
      setName(action?.name ?? "");
    } else {
      edit((p) => renameAction(p, actionId, name));
    }
  }

  function commitOwn() {
    const next = own.trim();
    if (next === "") return;
    edit((p) => setActionTrigger(p, actionId, next));
  }

  return (
    <DialogPrimitive.Root open modal={false} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Clicks on the view and the panel pick pieces and play the preview,
          // so they must not close it.
          onInteractOutside={(event) => event.preventDefault()}
          className="fixed inset-y-0 left-0 z-50 flex w-[360px] max-w-[92vw] flex-col border-r border-border bg-background shadow-xl"
        >
          <div className="flex items-center justify-between gap-2 border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              Action timeline
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-4">
            <Field label="Name">
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                onBlur={commitName}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setName(action.name);
                }}
                aria-label="Action name"
              />
            </Field>

            <Field label="Starts on">
              <OptionSelect
                ariaLabel="Starts on"
                value={isOwn ? OWN_FUNCTION : action.trigger}
                options={[
                  ...hooks.map((hook) => ({ value: hook, label: hook })),
                  { value: OWN_FUNCTION, label: "A function of its own" },
                ]}
                onValueChange={(value) => {
                  if (value !== OWN_FUNCTION) {
                    edit((p) => setActionTrigger(p, actionId, value));
                    return;
                  }
                  // Keeps what was typed, or offers a name that is free.
                  const free = own.trim() === "" ? "RunAction" : own.trim();
                  setOwn(free);
                  edit((p) => setActionTrigger(p, actionId, free));
                }}
              />
              {isOwn ? (
                <Input
                  value={own}
                  onChange={(event) => setOwn(event.target.value)}
                  onBlur={commitOwn}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  aria-label="Function name"
                  aria-invalid={ownProblem !== null}
                />
              ) : null}
              {ownProblem ? (
                <span className="text-xs text-destructive">{ownProblem}</span>
              ) : null}
            </Field>

            <div className="flex items-start justify-between gap-3">
              <Label htmlFor="action-loop" className="flex flex-col gap-0.5">
                <span className="font-medium">Loops</span>
                <span className="text-xs font-normal text-muted-foreground">
                  {action.loop
                    ? stop
                      ? `Stops on ${stop}.`
                      : isOwn
                        ? `Stops when ${action.trigger}Stop is called.`
                        : "Runs until it is started again."
                    : "Plays once and holds the last pose."}
                </span>
              </Label>
              <Switch
                id="action-loop"
                checked={action.loop}
                onCheckedChange={(on) =>
                  edit((p) => setActionLoop(p, actionId, on))
                }
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              {(["blendIn", "blendOut"] as const).map((which) => (
                <Field
                  key={which}
                  label={which === "blendIn" ? "Blend in (s)" : "Blend out (s)"}
                >
                  <Input
                    type="number"
                    min={0}
                    step={0.1}
                    value={action[which] ?? ""}
                    placeholder={String(blend[which])}
                    onChange={(event) => {
                      // Read now: the edit runs later, when the event's
                      // input has gone back to the stored value.
                      const next =
                        event.target.value === ""
                          ? null
                          : Number(event.target.value);
                      edit((p) => setActionBlend(p, actionId, which, next));
                    }}
                    aria-label={
                      which === "blendIn"
                        ? "Seconds to ease in from where the pieces are"
                        : "Seconds to ease back to rest"
                    }
                    title={
                      which === "blendIn"
                        ? "Seconds to reach the first key from wherever the pieces are. Empty uses the unit's time."
                        : "Seconds to return to rest when it stops. Empty uses the unit's time."
                    }
                    className="h-8 text-xs"
                  />
                </Field>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">Keys</span>
                <span className="text-muted-foreground">
                  {seconds === 0
                    ? "No time yet"
                    : `${Number(seconds.toFixed(2))} s`}
                </span>
              </div>
              {action.keys.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {poses.length === 0
                    ? "Save a pose first, from Poses in the view controls."
                    : "Add a pose below."}
                </p>
              ) : null}
              <ol className="flex flex-col gap-1.5">
                {action.keys.map((key, index) => {
                  const known = poses.some((pose) => pose.id === key.pose);
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: a key has no identity of its own, only its place
                    <li key={index} className="flex items-center gap-1">
                      <span className="w-4 text-xs tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <OptionSelect
                          size="sm"
                          ariaLabel={`Pose of key ${index + 1}`}
                          value={key.pose}
                          options={[
                            ...(known
                              ? []
                              : [
                                  {
                                    value: key.pose,
                                    label: "Deleted pose",
                                    disabled: true,
                                  },
                                ]),
                            ...poses.map((pose) => ({
                              value: pose.id,
                              label: pose.name,
                            })),
                          ]}
                          onValueChange={(value) =>
                            edit((p) => setKeyPose(p, actionId, index, value))
                          }
                        />
                      </div>
                      <Input
                        type="number"
                        min={0}
                        step={0.1}
                        value={key.seconds}
                        onChange={(event) => {
                          // Read now: the edit runs later, when the event's
                          // input has gone back to the stored value.
                          const next =
                            event.target.value === ""
                              ? Number.NaN
                              : Number(event.target.value);
                          edit((p) => setKeySeconds(p, actionId, index, next));
                        }}
                        aria-label={`Seconds to reach key ${index + 1}`}
                        title={
                          index === 0
                            ? "Seconds from rest, or from the last key when it loops"
                            : "Seconds from the key before"
                        }
                        className="h-8 w-16 text-xs"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        title="Move earlier"
                        aria-label={`Move key ${index + 1} earlier`}
                        disabled={index === 0}
                        onClick={() =>
                          edit((p) => moveKey(p, actionId, index, -1))
                        }
                      >
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        title="Move later"
                        aria-label={`Move key ${index + 1} later`}
                        disabled={index === action.keys.length - 1}
                        onClick={() =>
                          edit((p) => moveKey(p, actionId, index, 1))
                        }
                      >
                        <ArrowDown className="size-3.5" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="size-7"
                        title="Remove"
                        aria-label={`Remove key ${index + 1}`}
                        onClick={() =>
                          edit((p) => removeKey(p, actionId, index))
                        }
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </li>
                  );
                })}
              </ol>
              {poses.length > 0 ? (
                <OptionSelect
                  size="sm"
                  ariaLabel="Add a pose as a key"
                  value=""
                  placeholder="Add a pose"
                  options={poses.map((pose) => ({
                    value: pose.id,
                    label: pose.name,
                  }))}
                  onValueChange={(value) =>
                    edit((p) => addKey(p, actionId, value))
                  }
                />
              ) : null}
            </div>

            {clashText.length > 0 ? (
              <p className="text-xs text-muted-foreground">
                Also moved by something else: {clashText.join(", ")}.{" "}
                {sharedOutcome(project)}
              </p>
            ) : null}
          </div>

          <div className="flex items-center justify-between gap-2 border-t border-border/60 px-5 py-3">
            <span className="text-xs text-muted-foreground">
              {lines === 0
                ? "Writes nothing yet"
                : `${lines} ${lines === 1 ? "line" : "lines"} of Lua`}
            </span>
            <Button
              size="sm"
              variant={playing ? "default" : "outline"}
              disabled={playDisabled || lines === 0}
              aria-pressed={playing}
              onClick={() => onPlay(action.id)}
            >
              <Play size={14} /> Play
            </Button>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
