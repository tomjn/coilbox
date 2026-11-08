/**
 * Ask for several generated units at once and open the one you like (#3234).
 *
 * The form takes a body plan, a job, a size and a seed, and the grid shows a
 * batch of candidates from consecutive seeds. Reroll starts the next batch
 * where the last one stopped. Nothing is saved until a candidate is opened,
 * and then it is an ordinary unit.
 *
 * A batch of 12 costs about a quarter of a second to generate and draw, which
 * was measured for #3234, so it is done in the click rather than in a worker.
 */

import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Dices, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Field } from "@/components/Field";
import { OptionSelect } from "@/components/OptionSelect";
import { describeError } from "@/i18n/uiError";
import { onTextureArrived } from "@/lib/textureArrival";

import { baseAtlas } from "../../atlas";
import { BODY_PLANS, bodyPlanById } from "../../bodyPlans";
import { drawUnitPictures, materialReady } from "../../candidatePictures";
import {
  type CandidateBatch,
  generateCandidates,
  parseSeed,
} from "../../candidates";
import {
  GENERATOR_JOBS,
  GENERATOR_SIZES,
  type GeneratorSize,
} from "../../generate";
import { partMaterial } from "../../geometry";
import type { LegoProject } from "../../model";
import { type LoadedPack, loadPack } from "../../pack";
import { starterModules } from "../../starterModules";

/** How many candidates a batch holds. See the file comment for the cost. */
export const CANDIDATE_COUNT = 12;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The chosen candidate, for the page to save and open. */
  onOpened: (project: LegoProject) => void;
}

export function GenerateDrawer({ open, onOpenChange, onOpened }: Props) {
  const { t } = useLingui();
  const [pack, setPack] = useState<LoadedPack | null>(null);
  const [plan, setPlan] = useState(BODY_PLANS[0].id);
  const [job, setJob] = useState(GENERATOR_JOBS[0].id);
  const [size, setSize] = useState<GeneratorSize>("medium");
  const [seedText, setSeedText] = useState("");
  const [seedError, setSeedError] = useState<string | null>(null);
  const [batch, setBatch] = useState<CandidateBatch | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [pictures, setPictures] = useState<string[]>([]);
  /** Bumped when a texture arrives, so pictures drawn too early are redrawn. */
  const [arrivals, setArrivals] = useState(0);

  useEffect(() => {
    if (!open || pack) return;
    let live = true;
    loadPack().then(
      (loaded) => live && setPack(loaded),
      (error) => {
        if (!live) return;
        const reason = describeError(error);
        setProblem(t`Could not load the parts: ${reason}`);
      },
    );
    return () => {
      live = false;
    };
  }, [open, pack, t]);

  const modules = useMemo(() => (pack ? starterModules(pack) : []), [pack]);

  useEffect(() => onTextureArrived(() => setArrivals((n) => n + 1)), []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `arrivals` is only a reason to draw again
  useEffect(() => {
    if (!pack || !batch || batch.candidates.length === 0) {
      setPictures([]);
      return;
    }
    const material = partMaterial(baseAtlas(pack));
    if (!materialReady(material)) return;
    try {
      setPictures(
        drawUnitPictures(
          batch.candidates.map((c) => c.unit),
          pack,
          material,
        ),
      );
    } catch {
      // A picture is a convenience. Without WebGL the seeds still show.
      setPictures([]);
    }
  }, [pack, batch, arrivals]);

  function generate(start: number) {
    if (!pack) return;
    const chosen = bodyPlanById(plan);
    if (!chosen) return;
    setProblem(null);
    try {
      setBatch(
        generateCandidates(
          { plan: chosen, job, size },
          start,
          CANDIDATE_COUNT,
          () => ({
            id: crypto.randomUUID(),
            rootPieceId: crypto.randomUUID(),
            now: new Date().toISOString(),
            pack,
            modules,
          }),
        ),
      );
    } catch (error) {
      const reason = describeError(error);
      setBatch(null);
      setProblem(t`Could not generate units: ${reason}`);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const seed = parseSeed(seedText);
    if (seed === null) {
      setSeedError(t`A seed is a whole number.`);
      return;
    }
    setSeedError(null);
    generate(seed);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-black/55 backdrop-blur-[1px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 right-0 z-50 flex w-[720px] max-w-[92vw] flex-col border-l border-border bg-background shadow-xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right"
        >
          <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
            <DialogPrimitive.Title className="text-base font-semibold">
              <Trans>Generate units</Trans>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t`Close`}>
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
            <form
              onSubmit={submit}
              className="grid grid-cols-2 items-start gap-4"
            >
              <Field label={t`Body plan`}>
                <OptionSelect
                  value={plan}
                  onValueChange={setPlan}
                  options={BODY_PLANS.map((p) => ({
                    value: p.id,
                    label: p.label,
                  }))}
                />
              </Field>
              <Field label={t`Job`}>
                <OptionSelect
                  value={job}
                  onValueChange={setJob}
                  options={GENERATOR_JOBS.map((j) => ({
                    value: j.id,
                    label: j.label,
                  }))}
                />
              </Field>
              <Field label={t`Size`}>
                <OptionSelect
                  value={size}
                  onValueChange={(value) => setSize(value as GeneratorSize)}
                  options={GENERATOR_SIZES.map((s) => ({
                    value: s.id,
                    label: s.label,
                  }))}
                />
              </Field>
              <Field label={t`Seed`}>
                <Input
                  inputMode="numeric"
                  value={seedText}
                  onChange={(event) => setSeedText(event.target.value)}
                  placeholder={t`Random`}
                  aria-invalid={seedError ? true : undefined}
                />
                {seedError ? (
                  <span className="text-xs text-destructive">{seedError}</span>
                ) : null}
              </Field>
              <div className="col-span-2 flex gap-2">
                <Button type="submit" disabled={!pack}>
                  <Trans>Generate</Trans>
                </Button>
                {batch ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!pack}
                    onClick={() => generate(batch.next)}
                  >
                    <Dices size={16} /> <Trans>Reroll</Trans>
                  </Button>
                ) : null}
              </div>
            </form>

            {problem ? (
              <p className="text-sm text-destructive">{problem}</p>
            ) : null}
            {batch?.failed ? (
              <p className="text-sm text-destructive">{batch.failed}</p>
            ) : null}

            {batch && batch.candidates.length > 0 ? (
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(147px,1fr))] content-start gap-4">
                {batch.candidates.map((candidate, index) => {
                  const seed = candidate.seed;
                  return (
                    <li key={candidate.unit.id}>
                      <button
                        type="button"
                        onClick={() => onOpened(candidate.unit)}
                        className="block w-full rounded border border-border text-left transition-colors hover:border-foreground/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        {pictures[index] ? (
                          <img
                            src={pictures[index]}
                            alt=""
                            className="aspect-square w-full rounded-t bg-muted object-cover"
                          />
                        ) : (
                          <div className="aspect-square w-full rounded-t bg-muted" />
                        )}
                        <span className="block px-3 py-2 text-sm">
                          <Trans>Seed {seed}</Trans>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
