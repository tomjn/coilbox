/**
 * Fit a body plan to the pieces a unit already has (issue #3261).
 *
 * The drawer lists the plan's bones, one highlighted. Selecting a piece, in
 * the view or the piece tree, fills that bone and highlights the next one
 * still unmatched. That is why the drawer is not modal and sits on the left:
 * the view and the tree have to stay reachable. A piece is never matched by a
 * guess. Suggestions are offered and only taken when the game maker says so.
 *
 * Nothing changes until Fit, which is one edit. Before it, the drawer says
 * which roles the fit replaces, which presets it cannot add, and which
 * proportions it cannot measure.
 */

import { Button, Input } from "@picoframe/frame";
import { X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useMemo, useRef, useState } from "react";

import { presetById, roleLabel } from "../../animPresets";
import { BODY_PLANS, type BodyPlan, type BodyPlanBone } from "../../bodyPlans";
import {
  type BonePicks,
  fitPlan,
  planBones,
  suggestPicks,
} from "../../fitPlan";
import type { LegoProject } from "../../model";

interface Props {
  project: LegoProject;
  /** The piece selected now. A change to it fills the highlighted bone. */
  selectedId: string | null;
  onSelect: (pieceId: string) => void;
  onOpenChange: (open: boolean) => void;
  /** Fits the plan to the picks, as one edit. */
  onFit: (
    plan: BodyPlan,
    counts: Record<string, number>,
    picks: BonePicks,
  ) => void;
}

/** A bone's role when no other bone of the plan has it, else its name, so
 *  every wheel of a wheeled plan reads differently. */
function boneLabel(bone: BodyPlanBone, bones: BodyPlanBone[]): string {
  const { role } = bone;
  return role && bones.filter((b) => b.role === role).length === 1
    ? roleLabel(role)
    : bone.name;
}

/** The picks with `pieceId` on `boneId`, and off any other bone. */
function withPick(picks: BonePicks, boneId: string, pieceId: string) {
  const next: BonePicks = {};
  for (const [bone, piece] of Object.entries(picks)) {
    if (piece !== pieceId) next[bone] = piece;
  }
  next[boneId] = pieceId;
  return next;
}

export function FitPlanDrawer({
  project,
  selectedId,
  onSelect,
  onOpenChange,
  onFit,
}: Props) {
  const [plan, setPlan] = useState<BodyPlan | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [picks, setPicks] = useState<BonePicks>({});
  const [active, setActive] = useState<string | null>(null);

  const bones = useMemo(
    () => (plan ? planBones(plan, counts) : []),
    [plan, counts],
  );
  const suggested = useMemo(
    () => suggestPicks(project, bones),
    [project, bones],
  );
  const fit = useMemo(
    () => (plan ? fitPlan(project, plan, counts, picks) : null),
    [project, plan, counts, picks],
  );
  const nameOf = (pieceId: string) =>
    project.pieces.find((p) => p.id === pieceId)?.name ?? pieceId;

  // The selection the drawer has already answered, so only a new one fills a
  // bone, and a row selecting its own piece to show it fills nothing.
  const answered = useRef(selectedId);
  useEffect(() => {
    if (selectedId === answered.current) return;
    answered.current = selectedId;
    if (!selectedId || !active) return;
    const next = withPick(picks, active, selectedId);
    setPicks(next);
    const at = bones.findIndex((b) => b.id === active);
    const after = [...bones.slice(at + 1), ...bones.slice(0, at)];
    setActive(after.find((b) => next[b.id] === undefined)?.id ?? null);
  }, [selectedId, active, picks, bones]);

  function choose(chosen: BodyPlan) {
    setPlan(chosen);
    setCounts({});
    setPicks({});
    setActive(planBones(chosen, {})[0]?.id ?? null);
  }

  function highlight(boneId: string) {
    setActive(boneId);
    const pieceId = picks[boneId];
    if (pieceId) {
      answered.current = pieceId;
      onSelect(pieceId);
    }
  }

  function unpick(boneId: string) {
    const { [boneId]: _gone, ...rest } = picks;
    setPicks(rest);
  }

  function takeSuggestions() {
    const taken = new Set(Object.values(picks));
    const next = { ...picks };
    for (const [bone, piece] of Object.entries(suggested)) {
      if (next[bone] === undefined && !taken.has(piece)) next[bone] = piece;
    }
    setPicks(next);
  }

  const shownBones = new Set(bones.map((b) => b.id));
  const picked = Object.keys(picks).some((id) => shownBones.has(id));
  const unusedSuggestions = Object.entries(suggested).some(
    ([bone, piece]) =>
      picks[bone] === undefined && !Object.values(picks).includes(piece),
  );
  const proportionLabel = (id: string) =>
    plan?.proportions.find((p) => p.id === id)?.label ?? id;

  return (
    <DialogPrimitive.Root open modal={false} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Clicks on the view and the tree pick pieces, so they must not
          // close it.
          onInteractOutside={(event) => event.preventDefault()}
          className="fixed inset-y-0 left-0 z-50 flex w-[340px] max-w-[92vw] flex-col border-r border-border bg-background shadow-xl"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              {plan ? `Fit ${plan.label}` : "Fit a body plan"}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label="Close">
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          {!plan ? (
            <ul className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
              {BODY_PLANS.map((option) => (
                <li key={option.id}>
                  <button
                    type="button"
                    onClick={() => choose(option)}
                    className="w-full rounded px-2 py-2 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <span className="block text-sm">{option.label}</span>
                    <span className="block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <>
              <div className="space-y-2 border-b border-border/60 px-5 py-3">
                {plan.proportions
                  .filter((p) => p.unit === "count")
                  .map((proportion) => (
                    <div
                      key={proportion.id}
                      className="flex items-center justify-between gap-2"
                    >
                      <label
                        htmlFor={`fit-${proportion.id}`}
                        className="text-xs text-muted-foreground"
                      >
                        {proportion.label}
                      </label>
                      <Input
                        id={`fit-${proportion.id}`}
                        type="number"
                        min={proportion.min}
                        max={proportion.max}
                        value={counts[proportion.id] ?? proportion.fallback}
                        onChange={(event) => {
                          const typed = Number.parseInt(event.target.value, 10);
                          if (Number.isFinite(typed))
                            setCounts({ ...counts, [proportion.id]: typed });
                        }}
                        className="h-7 w-20 px-1 text-right text-xs"
                      />
                    </div>
                  ))}
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    Select a piece for the highlighted bone
                  </p>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setPlan(null)}
                  >
                    Change plan
                  </Button>
                </div>
                {unusedSuggestions ? (
                  <Button size="sm" variant="outline" onClick={takeSuggestions}>
                    Use suggestions
                  </Button>
                ) : null}
              </div>

              <ul className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                {bones.map((bone) => {
                  const label = boneLabel(bone, bones);
                  const pieceId = picks[bone.id];
                  const suggestion = suggested[bone.id];
                  return (
                    <li key={bone.id} className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-pressed={active === bone.id}
                        onClick={() => highlight(bone.id)}
                        className="flex min-w-0 flex-1 items-baseline justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-primary/15"
                      >
                        <span className="truncate">{label}</span>
                        <span className="shrink-0 truncate text-xs text-muted-foreground">
                          {pieceId ? nameOf(pieceId) : "Unmatched"}
                        </span>
                      </button>
                      {pieceId ? (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Unmatch ${label}`}
                          onClick={() => unpick(bone.id)}
                        >
                          <X className="size-3" />
                        </Button>
                      ) : suggestion &&
                        !Object.values(picks).includes(suggestion) ? (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            setPicks(withPick(picks, bone.id, suggestion))
                          }
                        >
                          Use {nameOf(suggestion)}
                        </Button>
                      ) : null}
                    </li>
                  );
                })}
              </ul>

              <div className="space-y-2 border-t border-border/60 px-5 py-3 text-xs">
                {fit && picked ? (
                  <>
                    {fit.replaced.length > 0 ? (
                      <div>
                        <p className="text-muted-foreground">Roles replaced</p>
                        <ul>
                          {fit.replaced.map((r) => (
                            <li key={r.pieceId}>
                              {nameOf(r.pieceId)}: {roleLabel(r.from)} to{" "}
                              {roleLabel(r.to)}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {fit.presets.held.map((held) => (
                      <p key={held.presetId} className="text-destructive">
                        {presetById(held.presetId)?.label ?? held.presetId}{" "}
                        needs {held.missing.map(roleLabel).join(", ")}
                      </p>
                    ))}
                    {fit.unmeasured.length > 0 ? (
                      <p className="text-muted-foreground">
                        Not measured:{" "}
                        {fit.unmeasured.map(proportionLabel).join(", ")}
                      </p>
                    ) : null}
                  </>
                ) : null}
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    disabled={!picked}
                    onClick={() => {
                      onFit(plan, counts, picks);
                      onOpenChange(false);
                    }}
                  >
                    Fit
                  </Button>
                </div>
              </div>
            </>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
