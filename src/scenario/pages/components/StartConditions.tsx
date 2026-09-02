/**
 * What each participant starts the mission with: the document's `teams` block.
 *
 * Part of the setup panel rather than a panel of its own, because every field
 * here is keyed by a `setup.participants` id. The list of participants is the
 * thing this section is a column of, and the same panel is where removing one
 * already asks what becomes of its start units and its bank.
 *
 * Three of the four fields are economy. The fourth, "no automatic commander
 * for this team", is the adoption contract: it is what a vendoring game reads
 * through `GG.CoilboxMission.suppressesStart`, and marking every team is what
 * makes `suppressesEveryStart()` true and keeps a game's faction and start spot
 * pickers out of a mission that is already playing. So the switch says what it
 * does in place, and a setup that marks some teams and not others is warned
 * about rather than left to be discovered in game.
 *
 * The document edits are in `teams.ts`.
 */

import { Button, Input } from "@picoframe/frame";
import { Flag, X } from "lucide-react";
import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { UnitDatasetEntry } from "@/content/bindings";
import { UnitPickerButton } from "@/content/pages/components/UnitPicker";
import { useGameUnits } from "@/content/useGameUnits";
import type { Participant } from "@/play/config";
import type { Scenario, ScenarioTeam } from "../../model";
import {
  type Amount,
  type AmountField,
  addStartUnit,
  clampStartCount,
  MAX_START_UNITS,
  removeStartUnit,
  setStartUnitCount,
  setTeamAmount,
  setTeamNoCommander,
  startsWarning,
  startUnits,
  teamOf,
} from "./teams";

export function StartConditions({
  scenario,
  participants,
  onChange,
}: {
  scenario: Scenario;
  /** The participants as the table above is showing them, so a row appears the
   *  moment an AI is added rather than after the edit has been written. */
  participants: Participant[];
  onChange: (next: Scenario) => void;
}) {
  const units = useGameUnits(scenario.setup.gameName);
  const warning = startsWarning(scenario);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border/50 p-3">
      <div className="flex items-center gap-2">
        <Flag className="size-4 shrink-0 text-muted-foreground" />
        <h3 className="text-xs font-medium">Start conditions</h3>
      </div>

      <p className="text-xs text-muted-foreground">
        What each participant opens the mission with, which the skirmish setup
        cannot say. Start units arrive on that team's start position, so they
        are an opening force rather than a group placed where you clicked. A
        team the mission declares opens on the bank set here and nothing else:
        leaving both empty is a team with no metal and no energy, not one on the
        game's usual allowance.
      </p>

      {warning && (
        <p className="rounded bg-amber-950/60 px-2 py-1.5 text-[11px] text-amber-200">
          {warning}
        </p>
      )}

      {participants.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Add a participant above and its start conditions appear here.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {participants.map((participant) => (
            <li key={participant.id}>
              <TeamStart
                participant={participant}
                team={teamOf(scenario, participant.id)}
                units={units.units}
                unitsLoading={units.loading}
                onAddUnit={(def) =>
                  onChange(addStartUnit(scenario, participant.id, def))
                }
                onCount={(def, count) =>
                  onChange(
                    setStartUnitCount(scenario, participant.id, def, count),
                  )
                }
                onRemoveUnit={(def) =>
                  onChange(removeStartUnit(scenario, participant.id, def))
                }
                onAmount={(field, which, value) =>
                  onChange(
                    setTeamAmount(
                      scenario,
                      participant.id,
                      field,
                      which,
                      value,
                    ),
                  )
                }
                onNoCommander={(on) =>
                  onChange(setTeamNoCommander(scenario, participant.id, on))
                }
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One participant's start: who it is, what it opens with, and whether the
 *  mission owns its start. */
function TeamStart({
  participant,
  team,
  units,
  unitsLoading,
  onAddUnit,
  onCount,
  onRemoveUnit,
  onAmount,
  onNoCommander,
}: {
  participant: Participant;
  team: ScenarioTeam;
  units: UnitDatasetEntry[];
  unitsLoading: boolean;
  onAddUnit: (def: string) => void;
  onCount: (def: string, count: number) => void;
  onRemoveUnit: (def: string) => void;
  onAmount: (field: AmountField, which: Amount, value: number | null) => void;
  onNoCommander: (on: boolean) => void;
}) {
  const counts = startUnits(team);
  const [r, g, b] = participant.color;
  const switchId = `no-commander-${participant.id}`;

  return (
    <div className="flex flex-col gap-2.5 rounded-md border border-border/40 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="size-3 shrink-0 rounded-sm border border-border/60"
          style={{ backgroundColor: `rgb(${r * 255} ${g * 255} ${b * 255})` }}
        />
        <span className="text-xs font-medium">{participant.name}</span>
        <div className="ml-auto flex items-center gap-2">
          <Label htmlFor={switchId} className="text-xs font-normal">
            No automatic commander for this team
          </Label>
          <Switch
            id={switchId}
            checked={team.noCommander === true}
            onCheckedChange={onNoCommander}
          />
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="w-20 shrink-0 text-[11px] text-muted-foreground">
          Start units
        </span>
        {counts.map((entry) => (
          <span
            key={entry.def}
            className="flex items-center gap-1 rounded-md border border-border/50 py-0.5 pr-0.5 pl-2 font-mono text-xs"
          >
            {entry.def}
            <CountBox
              label={`How many ${entry.def} for ${participant.name}`}
              count={entry.count}
              onCommit={(count) => onCount(entry.def, count)}
            />
            <Button
              size="sm"
              variant="ghost"
              className="size-6 p-0 text-destructive hover:text-destructive"
              aria-label={`Take ${entry.def} off ${participant.name}'s start`}
              onClick={() => onRemoveUnit(entry.def)}
            >
              <X className="size-3.5" />
            </Button>
          </span>
        ))}
        <AddStartUnit
          units={units}
          loading={unitsLoading}
          label={`Add a start unit for ${participant.name}`}
          onAdd={onAddUnit}
        />
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <AmountPair
          label="Bank"
          who={participant.name}
          field="resources"
          pair={team.resources}
          onAmount={onAmount}
        />
        <AmountPair
          label="Income"
          who={participant.name}
          field="income"
          pair={team.income}
          suffix="per second"
          onAmount={onAmount}
        />
      </div>
    </div>
  );
}

/** How many of one unit type the team starts with. Committed when the box is
 *  left, so typing "12" is one write rather than two. */
function CountBox({
  label,
  count,
  onCommit,
}: {
  label: string;
  count: number;
  onCommit: (count: number) => void;
}) {
  const [text, setText] = useState(String(count));
  const [seen, setSeen] = useState(count);
  if (seen !== count) {
    setSeen(count);
    setText(String(count));
  }

  return (
    <Input
      aria-label={label}
      type="number"
      min={1}
      max={MAX_START_UNITS}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = clampStartCount(Number(text));
        setText(String(next));
        if (next !== count) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="h-6 w-14 text-xs"
    />
  );
}

/** Add one more unit type to a team's start. The picker empties itself again,
 *  so adding three types in a row is three picks and nothing else. */
function AddStartUnit({
  units,
  loading,
  label,
  onAdd,
}: {
  units: UnitDatasetEntry[];
  loading: boolean;
  label: string;
  onAdd: (def: string) => void;
}) {
  const [def, setDef] = useState("");

  return (
    <UnitPickerButton
      units={units}
      value={def}
      loading={loading}
      placeholder={label}
      size="sm"
      className="w-56"
      onValueChange={(next) => {
        setDef("");
        onAdd(next);
      }}
    />
  );
}

/** The metal and energy of one field, either of which may be unset. */
function AmountPair({
  label,
  who,
  field,
  pair,
  suffix,
  onAmount,
}: {
  label: string;
  who: string;
  field: AmountField;
  pair: { metal?: number; energy?: number } | undefined;
  suffix?: string;
  onAmount: (field: AmountField, which: Amount, value: number | null) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="w-20 shrink-0 text-[11px] text-muted-foreground">
        {label}
      </span>
      <AmountBox
        label={`${label} metal for ${who}`}
        placeholder="Metal"
        value={pair?.metal}
        onCommit={(value) => onAmount(field, "metal", value)}
      />
      <AmountBox
        label={`${label} energy for ${who}`}
        placeholder="Energy"
        value={pair?.energy}
        onCommit={(value) => onAmount(field, "energy", value)}
      />
      {suffix && (
        <span className="text-[11px] text-muted-foreground">{suffix}</span>
      )}
    </div>
  );
}

/**
 * One number that may be unset.
 *
 * Held locally while it is typed and written when the box is left, because every
 * change to the document is a disk write and a step in the undo history. An
 * empty box clears the number rather than storing a zero: the two mean the same
 * thing to the bank and different things to the income, and the document should
 * say what its author set.
 */
function AmountBox({
  label,
  placeholder,
  value,
  onCommit,
}: {
  label: string;
  placeholder: string;
  value: number | undefined;
  onCommit: (value: number | null) => void;
}) {
  const stored = value === undefined ? "" : String(value);
  const [text, setText] = useState(stored);
  // Re-seeded when the document's number changes under the box, which is what an
  // undo, a preset or a participant being handed over looks like from here.
  const [seen, setSeen] = useState(stored);
  if (seen !== stored) {
    setSeen(stored);
    setText(stored);
  }

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === "") {
      if (value !== undefined) onCommit(null);
      return;
    }
    const next = Number(trimmed);
    if (!Number.isFinite(next)) return setText(stored);
    if (next !== value) onCommit(next);
  };

  return (
    <Input
      aria-label={label}
      type="number"
      min={0}
      placeholder={placeholder}
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="h-7 w-24 text-xs"
    />
  );
}
