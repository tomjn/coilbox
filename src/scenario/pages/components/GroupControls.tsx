/**
 * What a selected group is, beyond where it stands: whose it is, what it is made
 * of, whether it starts on the map, and what it is told to do.
 *
 * Team is on the bar because it is the one an author changes while looking at
 * the map. The unit list and the orders are behind popovers of their own: both
 * are lists that grow, and a bar wide enough for either would cover the map they
 * describe.
 *
 * Counts are held here while they are being typed and written when the box is
 * left, because every change to the document is saved and a keystroke per file
 * write is not what typing "12" should mean. Mount this keyed by the group's id
 * so moving the selection reseeds them.
 *
 * The team select, the difficulty range and each order's target also carry
 * what the validator found wrong with them, next to the field rather than
 * left to the problems drawer alone: a team the setup no longer has, a range
 * that can never apply at any setting, and an order aimed at something the
 * document no longer places (issue #2307, extending #2287's pattern from the
 * Triggers panel).
 *
 * A group standing off the map is said the same way, but as a row-level note
 * rather than a field problem (issue #2343): its position is dragged on the
 * map, not typed here, so there is no control for `aria-invalid` to sit on.
 * One of the group's own unit rows naming a def the game has not got is a
 * row-level note under that row for the same reason: the picker sets the def
 * once and adds a row, it does not edit one (issue #2346).
 */

import { Button, Input } from "@picoframe/frame";
import { Boxes, Pencil, Plus, Route, Trash2, X } from "lucide-react";
import { useId, useState } from "react";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { UnitDatasetEntry } from "@/content/bindings";
import { UnitPickerButton } from "@/content/pages/components/UnitPicker";
import { useFieldText } from "@/lib/useFieldText";
import type { Participant } from "@/play/config";
import { OptionSelect } from "@/uberstress/pages/components/OptionSelect";
import type { GroupUnit, ScenarioGroup, ScenarioOrder } from "../../model";
import type { MissionIssue } from "../../validate";
import { DifficultyRangeFields } from "./DifficultyRangeFields";
import {
  clampCount,
  groupSize,
  ORDER_KINDS,
  type OrderKind,
  orderOfKind,
  plusUnit,
  type TargetOption,
  withOrder,
  withoutOrder,
  withoutUnit,
  withUnit,
} from "./groups";
import { FieldProblem, RowProblem } from "./panels";
import { TeamSelect } from "./TeamSelect";
import { entryFieldProblem } from "./triggerProblems";

/** What each order kind does, in the words an author would use. */
const ORDER_LABELS: Record<OrderKind, string> = {
  move: "Move along",
  patrol: "Patrol",
  fight: "Fight along",
  guard: "Guard",
  attack: "Attack",
};

export function GroupControls({
  group,
  participants,
  units,
  unitsLoading,
  targets,
  issues,
  onEdit,
  onDelete,
  drawing,
  onDraw,
}: {
  group: ScenarioGroup;
  participants: Participant[];
  /** The game's units, for adding one more type to the group. */
  units: UnitDatasetEntry[];
  unitsLoading: boolean;
  /** Everything a guard or attack order can be pointed at. */
  targets: TargetOption[];
  /** What the validator has found wrong with the mission (issue #2307). */
  issues: MissionIssue[];
  /** Change the group's own fields, as {@link editGroup} takes them. */
  onEdit: (patch: Partial<Omit<ScenarioGroup, "id">>) => void;
  /** Delete the whole group, units, orders and all. */
  onDelete: () => void;
  /** Which order the map is putting waypoints into, or null for none. */
  drawing: number | null;
  onDraw: (order: number | null) => void;
}) {
  const size = groupSize(group);
  const teamDescribedBy = useId();
  const teamProblem = entryFieldProblem(issues, "groups", group.id, "team");
  const posProblem = entryFieldProblem(issues, "groups", group.id, "pos");

  return (
    <>
      <div className="flex flex-col gap-0.5">
        <TeamSelect
          participants={participants}
          value={group.team}
          onValueChange={(team) => onEdit({ team })}
          className="w-32"
          ariaLabel="Team"
          ariaInvalid={teamProblem !== null}
          describedBy={teamDescribedBy}
        />
        <FieldProblem id={teamDescribedBy} problem={teamProblem} />
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs"
          >
            <Boxes className="size-3.5" /> {size} unit{size === 1 ? "" : "s"}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-80 space-y-3">
          <RowProblem problem={posProblem} />
          <div className="space-y-1.5">
            {group.units.map((entry, index) => (
              <UnitRow
                key={entry.def}
                entry={entry}
                problem={entryFieldProblem(
                  issues,
                  "groups",
                  group.id,
                  `units[${index}].def`,
                )}
                onCount={(count) =>
                  onEdit({ units: withUnit(group.units, index, { count }) })
                }
                onRemove={() =>
                  onEdit({ units: withoutUnit(group.units, index) })
                }
              />
            ))}
          </div>

          <AddUnit
            units={units}
            loading={unitsLoading}
            onAdd={(def) => onEdit({ units: plusUnit(group.units, def) })}
          />

          <div className="flex items-center justify-between gap-3 border-t border-border/60 pt-3">
            <Label htmlFor="group-dormant" className="text-xs font-medium">
              Waits for a trigger to spawn it
            </Label>
            <Switch
              id="group-dormant"
              checked={group.dormant}
              onCheckedChange={(dormant) => onEdit({ dormant })}
            />
          </div>

          {/* Which difficulties this group exists at (issue #2164). A group the
              range leaves out is not placed at the start and is not placed by
              spawn_group or wake_group either, so "the second wave only comes
              on hard" is set here rather than on every trigger that sends it. */}
          <div className="border-t border-border/60 pt-3">
            <DifficultyRangeFields
              value={group.difficulty}
              onChange={(difficulty) => onEdit({ difficulty })}
              problem={entryFieldProblem(
                issues,
                "groups",
                group.id,
                "difficulty",
              )}
            />
          </div>

          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-full gap-1.5 px-2 text-xs text-destructive hover:text-destructive"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" /> Delete the whole group
          </Button>
        </PopoverContent>
      </Popover>

      <Popover>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 px-2 text-xs"
          >
            <Route className="size-3.5" />
            {group.orders.length === 0
              ? "No orders"
              : `${group.orders.length} order${group.orders.length === 1 ? "" : "s"}`}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-96 space-y-2">
          {group.orders.length === 0 && (
            <p className="text-xs text-muted-foreground">
              With no orders a group holds its ground where it spawns.
            </p>
          )}
          {group.orders.map((order, index) => (
            <OrderRow
              // biome-ignore lint/suspicious/noArrayIndexKey: an order has no id and its index is what names it, in the document and in the drawn path alike
              key={`${index}-${order.kind}`}
              order={order}
              targets={targets}
              drawing={drawing === index}
              problem={entryFieldProblem(
                issues,
                "groups",
                group.id,
                `orders[${index}].target`,
              )}
              onDraw={(on) => onDraw(on ? index : null)}
              onChange={(next) =>
                onEdit({ orders: withOrder(group.orders, index, next) })
              }
              onRemove={() => {
                if (drawing === index) onDraw(null);
                onEdit({ orders: withoutOrder(group.orders, index) });
              }}
            />
          ))}
          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full gap-1.5 px-2 text-xs"
            onClick={() =>
              onEdit({ orders: [...group.orders, orderOfKind("move")] })
            }
          >
            <Plus className="size-3.5" /> Add an order
          </Button>
        </PopoverContent>
      </Popover>
    </>
  );
}

/**
 * One unit type in the group: what it is, and how many of it.
 *
 * The box follows the count when the count changes on its own, which is what an
 * undo does (issue #2185). The row is keyed by the unit type rather than by the
 * count, so nothing remounts it when the count moves: the box carried on showing
 * the count from before the step back, and the next keystroke wrote it over the
 * restored one.
 */
export function UnitRow({
  entry,
  problem = null,
  onCount,
  onRemove,
}: {
  entry: GroupUnit;
  /** What the validator found wrong with this unit type, in its own words
   *  (issue #2346): a def the game has not got. There is no control here for
   *  `aria-invalid` to sit on, so this is a row-level note instead. */
  problem?: string | null;
  onCount: (count: number) => void;
  onRemove: () => void;
}) {
  const [count, setCount] = useFieldText(String(entry.count));

  const commit = () => {
    const next = clampCount(Number(count));
    setCount(String(next));
    if (next !== entry.count) onCount(next);
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-xs">
          {entry.def}
        </span>
        <Input
          aria-label={`How many ${entry.def}`}
          type="number"
          min={1}
          value={count}
          onChange={(e) => setCount(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
          }}
          className="h-7 w-16 text-xs"
        />
        <Button
          size="sm"
          variant="ghost"
          className="size-7 p-0 text-destructive hover:text-destructive"
          aria-label={`Remove ${entry.def}`}
          onClick={onRemove}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      <RowProblem problem={problem} />
    </div>
  );
}

/** Add one more unit type to the group. The picker empties itself again, so
 *  adding three types in a row is three picks and nothing else. */
function AddUnit({
  units,
  loading,
  onAdd,
}: {
  units: UnitDatasetEntry[];
  loading: boolean;
  onAdd: (def: string) => void;
}) {
  const [def, setDef] = useState("");

  return (
    <UnitPickerButton
      units={units}
      value={def}
      loading={loading}
      placeholder="Add a unit type"
      size="sm"
      onValueChange={(next) => {
        setDef("");
        onAdd(next);
      }}
    />
  );
}

/**
 * One order: what kind it is, and the one thing that kind needs.
 *
 * A path is drawn on the map rather than typed, so what is here is the count of
 * points, the way to start adding more and the way to clear them. A target is
 * picked by name, because the document holds an id and nobody can read one.
 *
 * Shared with the trigger panel, where a `give_orders` action carries the same
 * list of orders and edits it the same way.
 */
export function OrderRow({
  order,
  targets,
  drawing,
  problem = null,
  onDraw,
  onChange,
  onRemove,
}: {
  order: ScenarioOrder;
  targets: TargetOption[];
  drawing: boolean;
  /** Why this order's target is wrong, in the validator's own words (issue
   *  #2307, `checkOrders` in `validate.ts`): nothing given, or nothing the
   *  document still places by that name. Null for a path order, which
   *  `checkOrders` does not check. */
  problem?: string | null;
  onDraw: (on: boolean) => void;
  onChange: (next: ScenarioOrder) => void;
  onRemove: () => void;
}) {
  // Narrowed by the shape rather than by the kind, the way the model splits it:
  // an order either carries a path or carries a target.
  const path = "waypoints" in order ? order : null;
  const aimed = "waypoints" in order ? null : order;
  const describedBy = useId();

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5">
        <OptionSelect
          size="sm"
          className="w-28 shrink-0"
          value={order.kind}
          onValueChange={(kind) => {
            if (kind !== "move" && kind !== "patrol" && kind !== "fight") {
              onDraw(false);
            }
            onChange(orderOfKind(kind as OrderKind, order));
          }}
          options={ORDER_KINDS.map((kind) => ({
            value: kind,
            label: ORDER_LABELS[kind],
          }))}
        />

        {path ? (
          <>
            <Button
              size="sm"
              variant={drawing ? "default" : "outline"}
              className="h-7 shrink-0 gap-1.5 px-2 text-xs"
              onClick={() => onDraw(!drawing)}
            >
              <Pencil className="size-3.5" />
              {drawing ? "Click the map" : "Draw"}
            </Button>
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {path.waypoints.length === 0
                ? "no points yet"
                : `${path.waypoints.length} point${path.waypoints.length === 1 ? "" : "s"}`}
            </span>
            {path.waypoints.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2 text-xs"
                onClick={() => onChange({ ...path, waypoints: [] })}
              >
                Clear
              </Button>
            )}
          </>
        ) : (
          aimed && (
            <OptionSelect
              size="sm"
              className="min-w-0 flex-1"
              value={aimed.target}
              onValueChange={(target) => onChange({ ...aimed, target })}
              placeholder={
                targets.length ? "Pick a target" : "Nothing to point at"
              }
              disabled={targets.length === 0}
              options={targets}
              ariaLabel="Order target"
              ariaInvalid={problem !== null}
              describedBy={describedBy}
            />
          )
        )}

        <Button
          size="sm"
          variant="ghost"
          className="size-7 shrink-0 p-0 text-destructive hover:text-destructive"
          aria-label="Remove this order"
          onClick={onRemove}
        >
          <X className="size-3.5" />
        </Button>
      </div>
      {aimed && <FieldProblem id={describedBy} problem={problem} />}
    </div>
  );
}
