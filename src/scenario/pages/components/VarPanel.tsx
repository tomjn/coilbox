/**
 * The variables panel: what a mission counts, and what it starts at.
 *
 * A row rather than a list and a form, because a variable is a name and a
 * number and there is nothing else to put in a form beside it.
 *
 * Variables are numbers, deliberately, so `add_var` always has something to add
 * to. A variable a trigger reads but nothing declares is 0 and the runtime says
 * so once, so declaring one here is about saying what it starts at rather than
 * about making it exist. Declaring it is also what puts it in the trigger
 * picker's list, which is the practical reason to.
 */

import { Button, Input } from "@picoframe/frame";
import { Plus, Trash2, Variable } from "lucide-react";
import { useFieldText } from "@/lib/useFieldText";
import type { ExtensionTypes } from "../../extensions";
import type { Scenario } from "../../model";
import { notifyDeleted } from "./deleteNotice";
import { EditorPanel, NameField } from "./panels";
import {
  addVar,
  nextVarName,
  removeVar,
  renameVar,
  setVar,
} from "./registries";

export function VarPanel({
  scenario,
  onChange,
  extensions,
  onUndo,
}: {
  scenario: Scenario;
  onChange: (next: Scenario) => void;
  /** The types the scenario's game declares, so a rename carries over a
   *  reference one of its own parameters holds (issue #913). */
  extensions: ExtensionTypes;
  /** The page's own step back, the same one Cmd+Z and the map toolbar call.
   *  Handed to an undeclare's undo notice so that button does exactly what
   *  the shortcut does rather than a second way of getting there (issue
   *  #2280). */
  onUndo: () => void;
}) {
  const names = Object.keys(scenario.vars);

  return (
    <EditorPanel
      title="Variables"
      icon={Variable}
      summary={
        names.length === 0
          ? "Nothing counted yet"
          : `${names.length} variable${names.length === 1 ? "" : "s"}`
      }
    >
      <div className="flex max-w-xl flex-col gap-2">
        {names.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            A variable is a number the mission counts with: waves sent,
            prisoners freed, whether the bridge is down. Triggers read it with
            the <code>var</code> condition and move it with <code>set_var</code>{" "}
            and <code>add_var</code>.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {names.map((name) => (
              <li key={name} className="flex items-center gap-2">
                <NameField
                  name={name}
                  label={`Name of ${name}`}
                  className="h-7 w-full font-mono text-xs"
                  onRename={(wanted) => {
                    const next = renameVar(scenario, name, wanted, extensions);
                    if (next !== scenario) {
                      onChange(next);
                      return null;
                    }
                    const trimmed = wanted.trim();
                    return trimmed
                      ? `A variable called ${trimmed} already exists`
                      : "A variable needs a name";
                  }}
                />
                <ValueField
                  key={`${name}-value`}
                  value={scenario.vars[name]}
                  label={`Starting value of ${name}`}
                  onCommit={(value) => onChange(setVar(scenario, name, value))}
                />
                <Button
                  size="sm"
                  variant="ghost"
                  className="size-7 shrink-0 p-0 text-destructive hover:text-destructive"
                  aria-label={`Undeclare ${name}`}
                  onClick={() => {
                    onChange(removeVar(scenario, name));
                    notifyDeleted(`Undeclared variable "${name}".`, onUndo);
                  }}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <Button
          size="sm"
          variant="outline"
          className="h-7 w-fit gap-1.5 px-2 text-xs"
          onClick={() => onChange(addVar(scenario, nextVarName(scenario.vars)))}
        >
          <Plus className="size-3.5" /> New variable
        </Button>

        {names.length > 0 && (
          <p className="text-[11px] text-muted-foreground">
            Renaming one carries the triggers that read it over. Undeclaring one
            leaves them alone, and they read it as 0.
          </p>
        )}
      </div>
    </EditorPanel>
  );
}

/**
 * What a variable starts at. Committed when the box is left, and put back when
 * what was typed is not a number: `parseVars` drops a value that is not one,
 * which would take the declaration with it.
 *
 * The box follows the value when the value changes on its own, which is what an
 * undo does (issue #2185). It is mounted keyed by the variable's name, so a
 * rename reseeds it and a change of value does not: the box carried on showing
 * the value from before the step back, and the next keystroke wrote it over the
 * restored one.
 */
function ValueField({
  value,
  label,
  onCommit,
}: {
  value: number;
  label: string;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useFieldText(String(value));

  return (
    <Input
      aria-label={label}
      type="number"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = Number(text.trim());
        if (text.trim() === "" || !Number.isFinite(next)) {
          return setText(String(value));
        }
        setText(String(next));
        if (next !== value) onCommit(next);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="h-7 w-24 shrink-0 text-xs"
    />
  );
}
