import { plural } from "@lingui/core/macro";
import { Trans, useLingui } from "@lingui/react/macro";
import { ChevronRight } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { ConfigOption } from "@/content/bindings";
import { describeError } from "@/i18n/uiError";
import {
  allSlots,
  type DecodedSlot,
  slotTitle,
  workshopDecodeTweakSet,
} from "@/workshop/decodeTweakSet";
import {
  type OptionChange,
  type OptionChanges,
  optionChanges,
  tweakSlotUnits,
} from "./optionChanges";

/**
 * The list a part of a preset opens onto in `PresetPartsView`: what it changes,
 * not how many things it holds.
 *
 * The rows follow the workshop's disk diff, a bordered block of mono text rows,
 * and the list opens in place under its part rather than in a second drawer.
 */

/** A part's list behind a trigger, closed until asked for. The children mount
 *  only once it opens, so a tweak slot decode costs nothing until then. */
export function ChangesDisclosure({ children }: { children: ReactNode }) {
  return (
    <Collapsible className="ml-7 mt-1.5">
      <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1 rounded text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        <Trans>What it changes</Trans>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1.5">{children}</CollapsibleContent>
    </Collapsible>
  );
}

const LIST_CLASS =
  "divide-y divide-border/50 overflow-hidden rounded-lg border border-border/50 text-xs";

function ChangeRow({ change }: { change: OptionChange }) {
  const { t } = useLingui();
  const { value, defaultValue, current } = change;
  return (
    <li className="flex flex-col gap-0.5 px-3 py-2">
      <span className="font-medium" title={change.key}>
        {change.name}
      </span>
      <span className="font-mono text-muted-foreground">
        {t`Preset ${value}, default ${defaultValue}`}
      </span>
      {current && (
        <span
          className={
            current.same ? "font-mono text-muted-foreground" : "font-mono"
          }
        >
          {current.same ? t`Already set this way` : t`Now ${current.value}`}
        </span>
      )}
    </li>
  );
}

/**
 * The options one part changes. `subject` names the game or map whose defaults
 * they were compared with, for saying so when that could not be read.
 */
export function OptionChangesList({
  result,
  subject,
}: {
  result: OptionChanges;
  subject: string;
}) {
  if (result.status === "unavailable") {
    return (
      <p className="text-xs text-muted-foreground">
        <Trans>
          The options for {subject} are not available, so this cannot be
          compared with its defaults. It may not be installed.
        </Trans>
      </p>
    );
  }
  const { changes, undeclared } = result;
  return (
    <div className="flex flex-col gap-2">
      {changes.length > 0 ? (
        <ul className={LIST_CLASS}>
          {changes.map((change) => (
            <ChangeRow key={change.key} change={change} />
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted-foreground">
          {undeclared.length === 0 ? (
            <Trans>Changes nothing from the defaults.</Trans>
          ) : (
            <Trans>No option it declares differs from its default.</Trans>
          )}
        </p>
      )}
      {undeclared.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="text-xs text-muted-foreground">
            {plural(undeclared.length, {
              one: `${subject} does not declare this option:`,
              other: `${subject} does not declare these # options:`,
            })}
          </p>
          <ul className={LIST_CLASS}>
            {undeclared.map(({ key, value }) => (
              <li
                key={key}
                className="flex items-baseline justify-between gap-3 px-3 py-1.5 font-mono"
              >
                <span className="truncate">{key}</span>
                <span className="truncate text-muted-foreground">{value}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** The comparison and its list in one, so the work happens only once the part
 *  is opened. */
export function PresetOptionChanges({
  schema,
  presetValues,
  currentValues,
  subject,
}: {
  schema: ConfigOption[] | undefined;
  presetValues: Record<string, string>;
  currentValues?: Record<string, string>;
  subject: string;
}) {
  return (
    <OptionChangesList
      result={optionChanges(schema, presetValues, currentValues)}
      subject={subject}
    />
  );
}

function RawText({ text }: { text: string }) {
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex cursor-pointer items-center gap-1 rounded text-muted-foreground hover:text-foreground">
        <ChevronRight className="size-3.5 shrink-0 transition-transform group-data-[state=open]:rotate-90" />
        <Trans>Raw text</Trans>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono">
          {text}
        </pre>
      </CollapsibleContent>
    </Collapsible>
  );
}

function SlotChanges({
  slot,
  stored,
}: {
  slot: DecodedSlot | null;
  /** The key and raw value the preset holds, for a slot the decode did not
   *  report back. */
  stored: { key: string; value: string };
}) {
  const units = slot ? tweakSlotUnits(slot) : null;
  const error = slot?.error;
  return (
    <li className="flex flex-col gap-1.5 px-3 py-2">
      <span className="font-medium" title={stored.key}>
        {slot ? slotTitle(slot) : stored.key}
      </span>
      {units ? (
        units.length === 0 ? (
          <span className="text-muted-foreground">
            <Trans>Changes no units.</Trans>
          </span>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {units.map(({ unit, fields }) => (
              <li key={unit} className="flex flex-col gap-0.5">
                <span className="font-mono">
                  {unit}{" "}
                  <span className="text-muted-foreground">
                    {plural(fields.length, {
                      one: "# field",
                      other: "# fields",
                    })}
                  </span>
                </span>
                {fields.map(({ path, value }) => (
                  <span
                    key={path}
                    className="break-all pl-3 font-mono text-muted-foreground"
                  >
                    {path === "" ? value : `${path} = ${value}`}
                  </span>
                ))}
              </li>
            ))}
          </ul>
        )
      ) : (
        <>
          <span className="text-muted-foreground">
            {error ? (
              <Trans>Could not be decoded: {error}</Trans>
            ) : (
              <Trans>
                Cannot be listed as changes to units. It is a program or a shape
                coilbox does not read.
              </Trans>
            )}
          </span>
          <RawText text={slot?.lua ?? stored.value} />
        </>
      )}
    </li>
  );
}

type Phase =
  | { state: "decoding" }
  | { state: "done"; slots: DecodedSlot[] }
  | { state: "failed"; message: string };

/**
 * Each tweak slot a preset holds with the units and fields it sets, read by the
 * workshop's decode command. A slot that is not a data table shows its raw text
 * instead, and so does every slot if the command itself fails.
 */
export function TweakSlotChangesList({
  values,
}: {
  /** The preset's non-empty tweak slots, by option key. */
  values: Record<string, string>;
}) {
  const [phase, setPhase] = useState<Phase>({ state: "decoding" });
  const valuesKey = JSON.stringify(values);

  // biome-ignore lint/correctness/useExhaustiveDependencies: valuesKey is the serialised values
  useEffect(() => {
    if (Object.keys(values).length === 0) return;
    let cancelled = false;
    setPhase({ state: "decoding" });
    workshopDecodeTweakSet({ entries: values })
      .then((set) => {
        if (!cancelled) setPhase({ state: "done", slots: allSlots(set) });
      })
      .catch((error) => {
        if (!cancelled)
          setPhase({ state: "failed", message: describeError(error) });
      });
    return () => {
      cancelled = true;
    };
  }, [valuesKey]);

  if (Object.keys(values).length === 0)
    return (
      <p className="text-xs text-muted-foreground">
        <Trans>Changes nothing: every slot is empty.</Trans>
      </p>
    );
  if (phase.state === "decoding")
    return (
      <p className="text-xs text-muted-foreground">
        <Trans>Reading the slots…</Trans>
      </p>
    );

  const entries = Object.entries(values);
  // A slot the decode did not report back still has text worth offering.
  const reported = phase.state === "done" ? phase.slots : [];
  const missing = entries.filter(
    ([key]) => !reported.some((slot) => slot.key === key),
  );

  return (
    <div className="flex flex-col gap-2">
      {phase.state === "failed" && (
        <p className="text-xs text-destructive">{phase.message}</p>
      )}
      <ul className={LIST_CLASS}>
        {reported.map((slot) => (
          <SlotChanges
            key={slot.key}
            slot={slot}
            stored={{ key: slot.key, value: values[slot.key] ?? "" }}
          />
        ))}
        {missing.map(([key, value]) => (
          <SlotChanges key={key} slot={null} stored={{ key, value }} />
        ))}
      </ul>
    </div>
  );
}
