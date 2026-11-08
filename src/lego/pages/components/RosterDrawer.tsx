/**
 * Ask for a roster of generated units and save it as one group (#3239).
 *
 * The form takes a name, the body plans, the jobs, a count of tiers and a
 * seed, under the same style chooser as the generate screen. Generate shows
 * the roster, a row per job from the smallest tier to the largest, and Save
 * keeps every unit at once. Reroll makes the roster again from the next seed.
 * See `roster.ts` for how the units are made and named.
 */

import { Trans, useLingui } from "@lingui/react/macro";
import { Button, Input } from "@picoframe/frame";
import { Dices, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { CheckField, Field } from "@/components/Field";
import { describeError } from "@/i18n/uiError";
import { onTextureArrived } from "@/lib/textureArrival";

import { baseAtlas } from "../../atlas";
import { BODY_PLANS } from "../../bodyPlans";
import { drawUnitPictures, materialReady } from "../../candidatePictures";
import { parseSeed } from "../../candidates";
import { GENERATOR_JOBS } from "../../generate";
import { nextSeed } from "../../generateChecked";
import { useGeneratorStyles } from "../../generatorStyles";
import { partMaterial } from "../../geometry";
import type { LegoProject } from "../../model";
import { type LoadedPack, loadPack } from "../../pack";
import {
  generateRoster,
  MAX_ROSTER_TIERS,
  type RosterRequest,
  rosterRequestProblem,
} from "../../roster";
import { starterModules } from "../../starterModules";
import { GeneratorStyleSection } from "./GeneratorStyleSection";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The units already saved, so a roster's names never clash with theirs. */
  projects: readonly LegoProject[];
  /** The roster's units, for the page to save. */
  onSaved: (units: LegoProject[]) => void;
}

/** The roster on screen and the request that made it. */
interface Made {
  request: RosterRequest;
  units: LegoProject[];
}

export function RosterDrawer({ open, onOpenChange, projects, onSaved }: Props) {
  const { t } = useLingui();
  const [pack, setPack] = useState<LoadedPack | null>(null);
  const [name, setName] = useState("");
  const [plans, setPlans] = useState<string[]>([BODY_PLANS[0].id]);
  const [jobs, setJobs] = useState<string[]>(
    GENERATOR_JOBS.slice(0, 3).map((j) => j.id),
  );
  const [tiersText, setTiersText] = useState("3");
  const [seedText, setSeedText] = useState("");
  const styleStore = useGeneratorStyles();
  const [styleId, setStyleId] = useState<string | null>(null);
  const style = styleStore.styles.find((s) => s.id === styleId) ?? null;
  const [made, setMade] = useState<Made | null>(null);
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
    if (!pack || !made) {
      setPictures([]);
      return;
    }
    const material = partMaterial(baseAtlas(pack));
    if (!materialReady(material)) return;
    try {
      setPictures(drawUnitPictures(made.units, pack, material));
    } catch {
      // A picture is a convenience. Without WebGL the names still show.
      setPictures([]);
    }
  }, [pack, made, arrivals]);

  function generate(request: RosterRequest) {
    if (!pack) return;
    const refused = rosterRequestProblem(request, projects);
    if (refused) {
      setMade(null);
      setProblem(refused);
      return;
    }
    setProblem(null);
    try {
      const result = generateRoster(request, () => ({
        id: crypto.randomUUID(),
        rootPieceId: crypto.randomUUID(),
        now: new Date().toISOString(),
        pack,
        modules,
      }));
      if (result.status === "failed") {
        setMade(null);
        setProblem(result.message);
        return;
      }
      setMade({ request, units: result.units });
    } catch (error) {
      const reason = describeError(error);
      setMade(null);
      setProblem(t`Could not generate the roster: ${reason}`);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const seed = parseSeed(seedText);
    if (seed === null) {
      setMade(null);
      setProblem(t`A seed is a whole number.`);
      return;
    }
    const tiers = /^\d+$/.test(tiersText.trim())
      ? Number(tiersText)
      : Number.NaN;
    generate({
      id: crypto.randomUUID(),
      name: name.trim(),
      seed,
      plans: BODY_PLANS.filter((p) => plans.includes(p.id)),
      // In the order the jobs are listed, whatever order they were ticked in.
      jobs: GENERATOR_JOBS.filter((j) => jobs.includes(j.id)).map((j) => j.id),
      tiers,
      ...(style ? { style } : {}),
    });
  }

  function toggle(list: string[], id: string, on: boolean): string[] {
    return on ? [...list, id] : list.filter((x) => x !== id);
  }

  const rows = made
    ? made.request.jobs.map((job) => ({
        job,
        label: GENERATOR_JOBS.find((j) => j.id === job)?.label ?? job,
        units: made.units
          .map((unit, index) => ({ unit, index }))
          .filter(({ unit }) => unit.roster?.job === job),
      }))
    : [];

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
              <Trans>Generate a roster</Trans>
            </DialogPrimitive.Title>
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon" aria-label={t`Close`}>
                <X className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </div>

          <div className="flex flex-col gap-5 overflow-y-auto px-5 py-4">
            <GeneratorStyleSection
              pack={pack}
              store={styleStore}
              chosen={style}
              onChoose={setStyleId}
            />

            <form
              onSubmit={submit}
              className="grid grid-cols-3 items-start gap-4"
            >
              <Field label={t`Roster name`}>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </Field>
              <Field label={t`Tiers`}>
                <Input
                  inputMode="numeric"
                  value={tiersText}
                  onChange={(event) => setTiersText(event.target.value)}
                  placeholder={`1-${MAX_ROSTER_TIERS}`}
                />
              </Field>
              <Field label={t`Seed`}>
                <Input
                  inputMode="numeric"
                  value={seedText}
                  onChange={(event) => setSeedText(event.target.value)}
                  placeholder={t`Random`}
                />
              </Field>
              <fieldset className="col-span-3 flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">
                  <Trans>Body plans</Trans>
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {BODY_PLANS.map((p) => (
                    <CheckField
                      key={p.id}
                      label={p.label}
                      checked={plans.includes(p.id)}
                      onChange={(on) =>
                        setPlans((was) => toggle(was, p.id, on))
                      }
                    />
                  ))}
                </div>
              </fieldset>
              <fieldset className="col-span-3 flex flex-col gap-2">
                <legend className="mb-2 text-sm font-medium">
                  <Trans>Jobs</Trans>
                </legend>
                <div className="grid grid-cols-3 gap-2">
                  {GENERATOR_JOBS.map((j) => (
                    <CheckField
                      key={j.id}
                      label={j.label}
                      checked={jobs.includes(j.id)}
                      onChange={(on) => setJobs((was) => toggle(was, j.id, on))}
                    />
                  ))}
                </div>
              </fieldset>
              <div className="col-span-3 flex gap-2">
                <Button type="submit" disabled={!pack}>
                  <Trans>Generate</Trans>
                </Button>
                {made ? (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      disabled={!pack}
                      onClick={() =>
                        generate({
                          ...made.request,
                          seed: nextSeed(made.request.seed),
                        })
                      }
                    >
                      <Dices size={16} /> <Trans>Reroll</Trans>
                    </Button>
                    <Button type="button" onClick={() => onSaved(made.units)}>
                      <Trans>Save roster</Trans>
                    </Button>
                  </>
                ) : null}
              </div>
            </form>

            {problem ? (
              <p className="text-sm text-destructive">{problem}</p>
            ) : null}

            {rows.map((row) => (
              <section key={row.job} className="space-y-2">
                <h3 className="text-sm font-medium">{row.label}</h3>
                <ul className="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-3">
                  {row.units.map(({ unit, index }) => (
                    <li
                      key={unit.id}
                      className="rounded border border-border text-sm"
                    >
                      {pictures[index] ? (
                        <img
                          src={pictures[index]}
                          alt=""
                          className="aspect-square w-full rounded-t bg-muted object-cover"
                        />
                      ) : (
                        <span className="block aspect-square w-full rounded-t bg-muted" />
                      )}
                      <span className="block truncate px-2 py-1.5">
                        {unit.unitName}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
