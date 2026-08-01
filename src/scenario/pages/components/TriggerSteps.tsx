/**
 * One condition or action, and the parameters it takes.
 *
 * Every field is built from the parameter's entry in `triggerTypes.ts` rather
 * than from the name of the type it belongs to, so a condition or action added
 * to that table arrives with a form and no change here. A type coilbox has never
 * heard of, which a game's `missions/extensions.lua` may declare, has no entry to
 * build a form from, so its parameters are shown as they are and kept as they
 * are rather than being dropped.
 *
 * The rule the whole panel exists for: a parameter that names something in the
 * document is a dropdown over that registry. A zone is picked, never typed, so
 * it cannot be a zone that does not exist.
 *
 * Capability gating (#765) hangs off the same table: it decides which types the
 * picker below offers and which it greys out, and needs nothing from the fields.
 */

import { Button, Input } from "@picoframe/frame";
import {
  ArrowDown,
  ArrowUp,
  MapPin,
  Plus,
  TriangleAlert,
  X,
} from "lucide-react";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import type { UnitDatasetEntry } from "@/content/bindings";
import { UnitDefSelect } from "@/content/pages/components/UnitDefSelect";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { Point, Scenario, ScenarioParam, TriggerStep } from "../../model";
import type { ParamSpec } from "../../triggerTypes";
import { OrderRow } from "./GroupControls";
import { orderOfKind, targetOptions, withOrder, withoutOrder } from "./groups";
import { TeamSelect } from "./TeamSelect";
import {
  isUnitDefParam,
  ordersParam,
  type PointTarget,
  paramOrders,
  registryOptions,
  type StepList,
  type StepRef,
  stepDefaults,
  stepLabel,
  stepTypes,
} from "./triggers";

/* -------------------------------------------------------------------------- *
 * Reading a stored parameter. The document holds JSON, so every field narrows
 * what it was given rather than trusting it.
 * -------------------------------------------------------------------------- */

const asNumber = (v: ScenarioParam | undefined): number | undefined =>
  typeof v === "number" ? v : undefined;

const asString = (v: ScenarioParam | undefined): string =>
  typeof v === "string" ? v : "";

const asStrings = (v: ScenarioParam | undefined): string[] =>
  Array.isArray(v)
    ? v.filter((item): item is string => typeof item === "string")
    : [];

function asPoint(v: ScenarioParam | undefined): Point | null {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return null;
  const { x, z } = v as Record<string, ScenarioParam>;
  return typeof x === "number" && typeof z === "number" ? { x, z } : null;
}

/** Whether the map is waiting for the point this field asked for. */
function isAsking(picking: PointTarget | null, want: PointTarget): boolean {
  return (
    picking !== null &&
    picking.param === want.param &&
    picking.order === want.order &&
    picking.ref.triggerId === want.ref.triggerId &&
    picking.ref.list === want.ref.list &&
    picking.ref.index === want.ref.index
  );
}

/* -------------------------------------------------------------------------- *
 * The step.
 * -------------------------------------------------------------------------- */

export function StepRow({
  step,
  at,
  scenario,
  units,
  unitsLoading,
  picking,
  onPick,
  onParam,
  onMove,
  onRemove,
}: {
  step: TriggerStep;
  /** Where this step sits, which is what a point pick is written back to. */
  at: StepRef;
  scenario: Scenario;
  units: UnitDatasetEntry[];
  unitsLoading: boolean;
  /** What the map is being asked for, or null when it is not waiting. */
  picking: PointTarget | null;
  onPick: (target: PointTarget | null) => void;
  /** Set one parameter, or take it out when the value is undefined. */
  onParam: (name: string, value: ScenarioParam | undefined) => void;
  /** Move the step within its list, or null where order carries no meaning. */
  onMove: ((delta: number) => void) | null;
  onRemove: () => void;
}) {
  const spec = stepTypes(at.list)[step.type];

  return (
    <li className="rounded-md border border-border/60 bg-muted/20 p-2">
      <div className="flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-xs font-medium">
          {stepLabel(step.type)}
        </span>
        {!spec && (
          <span
            className="flex items-center gap-1 text-[11px] text-amber-300"
            title="Coilbox has no form for this type, so its parameters are shown and kept as they are."
          >
            <TriangleAlert className="size-3.5" /> unknown type
          </span>
        )}
        {onMove && (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="size-7 p-0"
              aria-label="Move up"
              onClick={() => onMove(-1)}
            >
              <ArrowUp className="size-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="size-7 p-0"
              aria-label="Move down"
              onClick={() => onMove(1)}
            >
              <ArrowDown className="size-3.5" />
            </Button>
          </>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0 text-destructive hover:text-destructive"
          aria-label={`Remove ${stepLabel(step.type)}`}
          onClick={onRemove}
        >
          <X className="size-3.5" />
        </Button>
      </div>

      {spec ? (
        <div className="mt-1.5 flex flex-col gap-1.5">
          {Object.entries(spec).map(([name, param]) => (
            <ParamField
              key={name}
              // Reseed a typed box when the selection moves to another step.
              fieldKey={`${at.triggerId}#${at.list}#${at.index}#${name}`}
              name={name}
              spec={param}
              value={step.params[name]}
              type={step.type}
              at={at}
              scenario={scenario}
              units={units}
              unitsLoading={unitsLoading}
              picking={picking}
              onPick={onPick}
              onChange={(value) => onParam(name, value)}
            />
          ))}
        </div>
      ) : (
        <ul className="mt-1.5 space-y-0.5 font-mono text-[11px] text-muted-foreground">
          {Object.entries(step.params).map(([name, value]) => (
            <li key={name} className="truncate">
              {name} = {JSON.stringify(value)}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * One condition or action added to the end of a list.
 *
 * A type that cannot be used is greyed with the reason rather than left out, so
 * the list says what the runtime can do and what it would take to do the rest.
 * There are two reasons, and the runtime's comes first because it is the one the
 * author cannot fix by editing the document: the target runtime does not
 * implement the type (#765), or its references have nothing to point at yet.
 */
export function AddStep({
  list,
  scenario,
  unitDefs,
  gate,
  onAdd,
}: {
  list: StepList;
  scenario: Scenario;
  unitDefs: string[];
  /** Why each type the target runtime cannot run is unavailable, by type name. */
  gate: Record<string, string>;
  onAdd: (step: TriggerStep) => void;
}) {
  const table = stepTypes(list);
  const options = Object.entries(table).map(([type, spec]) => {
    const defaults = stepDefaults(spec, { scenario, unitDefs });
    const reason = gate[type] ?? defaults.needs;
    return {
      value: type,
      label: stepLabel(type),
      description: Object.keys(spec).join(", ") || undefined,
      trailing: reason,
      disabled: reason !== undefined,
    };
  });

  return (
    <OptionSelect
      size="sm"
      value=""
      placeholder={list === "conditions" ? "Add a condition" : "Add an action"}
      options={options}
      onValueChange={(type) => {
        if (gate[type]) return;
        const defaults = stepDefaults(table[type], { scenario, unitDefs });
        if (defaults.params) onAdd({ type, params: defaults.params });
      }}
    />
  );
}

/* -------------------------------------------------------------------------- *
 * One parameter.
 * -------------------------------------------------------------------------- */

function ParamField({
  fieldKey,
  name,
  spec,
  value,
  type,
  at,
  scenario,
  units,
  unitsLoading,
  picking,
  onPick,
  onChange,
}: {
  fieldKey: string;
  name: string;
  spec: ParamSpec;
  value: ScenarioParam | undefined;
  /** The step's type, for naming the control. */
  type: string;
  at: StepRef;
  scenario: Scenario;
  units: UnitDatasetEntry[];
  unitsLoading: boolean;
  picking: PointTarget | null;
  onPick: (target: PointTarget | null) => void;
  onChange: (value: ScenarioParam | undefined) => void;
}) {
  const label = `${stepLabel(type)} ${name}`;
  // An optional parameter that is set can be put back to whatever the runtime
  // does by default, which is what leaving it out means.
  const clearable = spec.optional === true && value !== undefined;

  return (
    <div className="flex items-start gap-2">
      <span className="w-20 shrink-0 pt-1 text-right font-mono text-[11px] text-muted-foreground">
        {name}
      </span>
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <ParamControl
          key={fieldKey}
          label={label}
          name={name}
          spec={spec}
          value={value}
          at={at}
          scenario={scenario}
          units={units}
          unitsLoading={unitsLoading}
          picking={picking}
          onPick={onPick}
          onChange={onChange}
        />
      </div>
      <Button
        size="sm"
        variant="ghost"
        className={`size-7 shrink-0 p-0 ${clearable ? "" : "invisible"}`}
        aria-label={`Clear ${label}`}
        disabled={!clearable}
        onClick={() => onChange(undefined)}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  );
}

function ParamControl({
  label,
  name,
  spec,
  value,
  at,
  scenario,
  units,
  unitsLoading,
  picking,
  onPick,
  onChange,
}: {
  label: string;
  name: string;
  spec: ParamSpec;
  value: ScenarioParam | undefined;
  at: StepRef;
  scenario: Scenario;
  units: UnitDatasetEntry[];
  unitsLoading: boolean;
  picking: PointTarget | null;
  onPick: (target: PointTarget | null) => void;
  onChange: (value: ScenarioParam | undefined) => void;
}) {
  const options = registryOptions(scenario, spec.kind);
  if (options) {
    if (spec.kind === "teamId") {
      return (
        <TeamSelect
          participants={scenario.setup.participants}
          value={asString(value)}
          onValueChange={onChange}
          className="w-full"
        />
      );
    }
    return (
      <OptionSelect
        size="sm"
        value={asString(value)}
        onValueChange={onChange}
        options={options}
        disabled={options.length === 0}
        placeholder={
          options.length === 0 ? "Nothing to pick yet" : `Pick a ${name}`
        }
      />
    );
  }

  switch (spec.kind) {
    case "number":
      return (
        <NumberField
          label={label}
          value={asNumber(value)}
          optional={spec.optional === true}
          onChange={onChange}
        />
      );
    case "boolean":
      return (
        <Switch
          aria-label={label}
          checked={value === true}
          onCheckedChange={(on) => onChange(on)}
        />
      );
    case "enum":
      return (
        <OptionSelect
          size="sm"
          value={asString(value)}
          onValueChange={onChange}
          options={(spec.values ?? []).map((v) => ({ value: v, label: v }))}
          placeholder={`Pick a ${name}`}
        />
      );
    case "point":
      return (
        <PointField
          point={asPoint(value)}
          asking={isAsking(picking, { ref: at, param: name })}
          onAsk={(on) => onPick(on ? { ref: at, param: name } : null)}
        />
      );
    case "strings":
      return (
        <StringsField
          label={label}
          values={asStrings(value)}
          units={isUnitDefParam(name) ? units : null}
          unitsLoading={unitsLoading}
          onChange={onChange}
        />
      );
    case "orders":
      return (
        <OrdersField
          name={name}
          at={at}
          scenario={scenario}
          orders={value}
          picking={picking}
          onPick={onPick}
          onChange={onChange}
        />
      );
    default:
      // A plain string. A unit type is picked from the game, because the engine
      // needs the internal name and nobody remembers "armestor".
      return isUnitDefParam(name) ? (
        <UnitDefSelect
          units={units}
          value={asString(value)}
          loading={unitsLoading}
          size="sm"
          onValueChange={onChange}
        />
      ) : (
        <TextField
          label={label}
          value={asString(value)}
          optional={spec.optional === true}
          onChange={onChange}
        />
      );
  }
}

/** A number, held while it is being typed and written when the box is left,
 *  because every change to the document is saved. An empty box clears an
 *  optional parameter and goes back to what it was for a required one. */
function NumberField({
  label,
  value,
  optional,
  onChange,
}: {
  label: string;
  value: number | undefined;
  optional: boolean;
  onChange: (value: ScenarioParam | undefined) => void;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === "") {
      if (optional) return onChange(undefined);
      return setText(value === undefined ? "" : String(value));
    }
    const next = Number(trimmed);
    if (!Number.isFinite(next)) {
      return setText(value === undefined ? "" : String(value));
    }
    setText(String(next));
    if (next !== value) onChange(next);
  };

  return (
    <Input
      aria-label={label}
      type="number"
      value={text}
      placeholder={optional ? "default" : ""}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="h-7 w-28 text-xs"
    />
  );
}

/** A string, committed the same way a number is. A required one never goes back
 *  empty, because an empty required parameter is a document that will not
 *  load. */
function TextField({
  label,
  value,
  optional,
  onChange,
}: {
  label: string;
  value: string;
  optional: boolean;
  onChange: (value: ScenarioParam | undefined) => void;
}) {
  const [text, setText] = useState(value);

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === "") {
      if (optional) return onChange(undefined);
      return setText(value);
    }
    setText(trimmed);
    if (trimmed !== value) onChange(trimmed);
  };

  return (
    <Input
      aria-label={label}
      value={text}
      placeholder={optional ? "default" : ""}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="h-7 text-xs"
    />
  );
}

/** A list of strings. Unit types are picked from the game, anything else is
 *  typed and added with Enter. */
function StringsField({
  label,
  values,
  units,
  unitsLoading,
  onChange,
}: {
  label: string;
  values: string[];
  /** The game's units when the list holds unit types, null when it does not. */
  units: UnitDatasetEntry[] | null;
  unitsLoading: boolean;
  onChange: (value: ScenarioParam) => void;
}) {
  const [typed, setTyped] = useState("");

  const add = (item: string) => {
    const next = item.trim();
    if (next && !values.includes(next)) onChange([...values, next]);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {values.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {values.map((item) => (
            <li
              key={item}
              className="flex items-center gap-1 rounded border border-border/60 bg-card px-1.5 py-0.5 font-mono text-[11px]"
            >
              {item}
              <button
                type="button"
                aria-label={`Remove ${item}`}
                className="text-muted-foreground hover:text-destructive"
                onClick={() => onChange(values.filter((v) => v !== item))}
              >
                <X className="size-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {units ? (
        <UnitDefSelect
          units={units}
          value=""
          loading={unitsLoading}
          placeholder="Add a unit type"
          size="sm"
          onValueChange={add}
        />
      ) : (
        <Input
          aria-label={label}
          value={typed}
          placeholder="Type and press Enter"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Enter") return;
            e.preventDefault();
            add(typed);
            setTyped("");
          }}
          className="h-7 text-xs"
        />
      )}
    </div>
  );
}

/** A point on the map, which is clicked rather than typed. The button arms the
 *  map through the same bar a patrol path is drawn with. */
function PointField({
  point,
  asking,
  onAsk,
}: {
  point: Point | null;
  asking: boolean;
  onAsk: (on: boolean) => void;
}) {
  return (
    <>
      <Button
        size="sm"
        variant={asking ? "default" : "outline"}
        className="h-7 gap-1.5 px-2 text-xs"
        onClick={() => onAsk(!asking)}
      >
        <MapPin className="size-3.5" />
        {asking ? "Click the map" : "Pick on the map"}
      </Button>
      <span className="font-mono text-[11px] text-muted-foreground">
        {point ? `${point.x}, ${point.z}` : "nowhere yet"}
      </span>
    </>
  );
}

/** The orders a `give_orders` action hands a group, edited with the same row a
 *  group's own orders are. */
function OrdersField({
  name,
  at,
  scenario,
  orders: raw,
  picking,
  onPick,
  onChange,
}: {
  name: string;
  at: StepRef;
  scenario: Scenario;
  orders: ScenarioParam | undefined;
  picking: PointTarget | null;
  onPick: (target: PointTarget | null) => void;
  onChange: (value: ScenarioParam) => void;
}) {
  const orders = paramOrders(raw);
  const targets = targetOptions(scenario);

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1.5">
      {orders.length === 0 && (
        <p className="text-[11px] text-muted-foreground">
          With no orders the group carries on with what it was already doing.
        </p>
      )}
      {orders.map((order, index) => (
        <OrderRow
          // biome-ignore lint/suspicious/noArrayIndexKey: an order has no id and its place in the list is what names it, in the document and in a point pick alike
          key={`${index}-${order.kind}`}
          order={order}
          targets={targets}
          drawing={isAsking(picking, { ref: at, param: name, order: index })}
          onDraw={(on) =>
            onPick(on ? { ref: at, param: name, order: index } : null)
          }
          onChange={(next) =>
            onChange(ordersParam(withOrder(orders, index, next)))
          }
          onRemove={() => {
            if (isAsking(picking, { ref: at, param: name, order: index })) {
              onPick(null);
            }
            onChange(ordersParam(withoutOrder(orders, index)));
          }}
        />
      ))}
      <Button
        size="sm"
        variant="outline"
        className="h-7 w-full gap-1.5 px-2 text-xs"
        onClick={() => onChange(ordersParam([...orders, orderOfKind("move")]))}
      >
        <Plus className="size-3.5" /> Add an order
      </Button>
    </div>
  );
}
