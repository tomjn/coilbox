import { describe, expect, it } from "vitest";
import { newScenario } from "../../create";
import { parseScenario, type Scenario } from "../../model";
import {
  addBuildableUnit,
  addCommand,
  addDialogue,
  addObjective,
  addVar,
  buildableMode,
  buildableWarning,
  dialogueMedia,
  editDialogue,
  editObjective,
  nameIssue,
  nextDialogueId,
  nextObjectiveId,
  nextVarName,
  removeBuildableUnit,
  removeCommand,
  removeDialogue,
  removeObjective,
  removeVar,
  renameDialogue,
  renameObjective,
  renameVar,
  setBuildableMode,
  setVar,
} from "./registries";

/** A document with one of each, and a trigger naming all three. */
function document(): Scenario {
  return {
    ...newScenario("test"),
    objectives: [
      { id: "hold", kind: "primary", text: "Hold the pad.", hidden: false },
    ],
    dialogue: [{ id: "warn", speaker: "HQ", text: "Contact." }],
    vars: { alertLevel: 0, waves: 2 },
    triggers: [
      {
        id: "t1",
        enabled: true,
        repeat: false,
        conditions: {
          op: "all",
          conditions: [
            {
              type: "var",
              params: { name: "alertLevel", op: "gte", value: 1 },
            },
          ],
        },
        actions: [
          { type: "complete_objective", params: { objective: "hold" } },
          { type: "dialogue", params: { line: "warn" } },
          { type: "set_var", params: { name: "alertLevel", value: 3 } },
        ],
      },
    ],
  };
}

/** What every panel edit has to stay true of: the document still loads. A
 *  refusal here is the scenario vanishing off the author's list on reload. */
function loads(scenario: Scenario): boolean {
  return parseScenario(JSON.parse(JSON.stringify(scenario))) !== null;
}

describe("nameIssue", () => {
  it("refuses an empty name and one that is only spaces", () => {
    expect(nameIssue([], "")).toBe("Needs a name");
    expect(nameIssue([], "   ")).toBe("Needs a name");
  });

  it("refuses a name another entry has", () => {
    expect(nameIssue(["a", "b"], "b")).toBe("Already taken");
  });

  it("allows an entry to keep its own name", () => {
    expect(nameIssue(["a", "b"], "b", "b")).toBeNull();
  });
});

describe("objectives", () => {
  it("mints an id nothing has taken", () => {
    const scenario = addObjective(newScenario("t"), "objective-1");
    expect(nextObjectiveId(scenario.objectives)).toBe("objective-2");
  });

  it("adds one the parser accepts, with no empty required field", () => {
    const scenario = addObjective(newScenario("t"), nextObjectiveId([]));
    expect(scenario.objectives).toEqual([
      { id: "objective-1", kind: "primary", text: "", hidden: false },
    ]);
    expect(loads(scenario)).toBe(true);
  });

  it("edits kind, text and hidden", () => {
    const next = editObjective(document(), "hold", {
      kind: "secondary",
      text: "Hold it a while.",
      hidden: true,
    });
    expect(next.objectives[0]).toEqual({
      id: "hold",
      kind: "secondary",
      text: "Hold it a while.",
      hidden: true,
    });
    expect(loads(next)).toBe(true);
  });

  it("carries the actions that named it over on a rename", () => {
    const next = renameObjective(document(), "hold", "hold-the-pad");
    expect(next.objectives[0].id).toBe("hold-the-pad");
    expect(next.triggers[0].actions[0].params.objective).toBe("hold-the-pad");
    expect(loads(next)).toBe(true);
  });

  it("refuses a rename that would make the document unreadable", () => {
    const scenario = addObjective(document(), "second");
    expect(renameObjective(scenario, "hold", "")).toBe(scenario);
    expect(renameObjective(scenario, "hold", "   ")).toBe(scenario);
    expect(renameObjective(scenario, "hold", "second")).toBe(scenario);
  });

  it("deletes one without rewriting the trigger that named it", () => {
    const next = removeObjective(document(), "hold");
    expect(next.objectives).toEqual([]);
    expect(next.triggers[0].actions[0].params.objective).toBe("hold");
    expect(loads(next)).toBe(true);
  });
});

describe("dialogue", () => {
  it("mints an id nothing has taken", () => {
    const scenario = addDialogue(newScenario("t"), "line-1");
    expect(nextDialogueId(scenario.dialogue)).toBe("line-2");
  });

  it("adds one the parser accepts", () => {
    const scenario = addDialogue(newScenario("t"), "line-1");
    expect(scenario.dialogue).toEqual([
      { id: "line-1", speaker: "", text: "" },
    ]);
    expect(loads(scenario)).toBe(true);
  });

  it("stores an imported clip and takes it out again when it is dropped", () => {
    const withClip = editDialogue(document(), "warn", {
      portrait: "abc.png",
      audio: "def.ogg",
    });
    expect(dialogueMedia(withClip.dialogue[0])).toEqual(["abc.png", "def.ogg"]);
    const dropped = editDialogue(withClip, "warn", { portrait: undefined });
    expect("portrait" in dropped.dialogue[0]).toBe(false);
    expect(dialogueMedia(dropped.dialogue[0])).toEqual(["def.ogg"]);
  });

  it("never stores an empty file name, which the parser reads as no file", () => {
    const next = editDialogue(document(), "warn", { portrait: "" });
    expect("portrait" in next.dialogue[0]).toBe(false);
  });

  it("carries the actions that played it over on a rename", () => {
    const next = renameDialogue(document(), "warn", "hq-warning");
    expect(next.dialogue[0].id).toBe("hq-warning");
    expect(next.triggers[0].actions[1].params.line).toBe("hq-warning");
    expect(loads(next)).toBe(true);
  });

  it("refuses a rename onto a line that already exists", () => {
    const scenario = addDialogue(document(), "second");
    expect(renameDialogue(scenario, "warn", "second")).toBe(scenario);
    expect(renameDialogue(scenario, "warn", "")).toBe(scenario);
  });

  it("deletes a line", () => {
    expect(removeDialogue(document(), "warn").dialogue).toEqual([]);
  });
});

describe("vars", () => {
  it("mints a name nothing has taken", () => {
    expect(nextVarName({ var1: 0, var2: 0 })).toBe("var3");
  });

  it("declares one at a starting value", () => {
    const next = addVar(document(), "timer", 30);
    expect(next.vars.timer).toBe(30);
    expect(loads(next)).toBe(true);
  });

  it("refuses an empty name and one already declared", () => {
    const scenario = document();
    expect(addVar(scenario, "")).toBe(scenario);
    expect(addVar(scenario, "  ")).toBe(scenario);
    expect(addVar(scenario, "waves", 9)).toBe(scenario);
  });

  it("refuses a value that is not a finite number", () => {
    const scenario = document();
    expect(setVar(scenario, "waves", Number.NaN)).toBe(scenario);
    expect(setVar(scenario, "waves", Number.POSITIVE_INFINITY)).toBe(scenario);
    expect(setVar(scenario, "waves", -1).vars.waves).toBe(-1);
  });

  it("carries the conditions and actions that read it over on a rename", () => {
    const next = renameVar(document(), "alertLevel", "alarm");
    expect(next.vars).toEqual({ alarm: 0, waves: 2 });
    expect(Object.keys(next.vars)).toEqual(["alarm", "waves"]);
    expect(next.triggers[0].conditions.conditions[0].params.name).toBe("alarm");
    expect(next.triggers[0].actions[2].params.name).toBe("alarm");
    expect(loads(next)).toBe(true);
  });

  it("refuses a rename that would overwrite another variable", () => {
    const scenario = document();
    expect(renameVar(scenario, "waves", "alertLevel")).toBe(scenario);
    expect(renameVar(scenario, "waves", " ")).toBe(scenario);
  });

  it("undeclares one, leaving the triggers that read it alone", () => {
    const next = removeVar(document(), "waves");
    expect(next.vars).toEqual({ alertLevel: 0 });
    expect(loads(next)).toBe(true);
  });
});

describe("restrictions", () => {
  it("keeps the listed units when the rule flips from deny to allow", () => {
    const denied = addBuildableUnit(newScenario("t"), "armcom");
    expect(buildableMode(denied)).toBe("deny");
    const allowed = setBuildableMode(denied, "allow");
    expect(allowed.restrictions.buildable).toEqual({
      mode: "allow",
      units: ["armcom"],
    });
  });

  it("drops the rule entirely when there is none", () => {
    const scenario = setBuildableMode(
      addBuildableUnit(newScenario("t"), "armcom"),
      "none",
    );
    expect(scenario.restrictions.buildable).toBeUndefined();
    expect(loads(scenario)).toBe(true);
  });

  it("ignores an empty def and one already listed", () => {
    const scenario = addBuildableUnit(newScenario("t"), "armcom");
    expect(addBuildableUnit(scenario, "armcom")).toBe(scenario);
    expect(addBuildableUnit(scenario, "  ")).toBe(scenario);
    expect(
      removeBuildableUnit(scenario, "armcom").restrictions.buildable,
    ).toEqual({ mode: "deny", units: [] });
  });

  it("lower cases a withheld command and refuses a repeat", () => {
    const scenario = addCommand(newScenario("t"), "SelfD");
    expect(scenario.restrictions.commands).toEqual(["selfd"]);
    expect(addCommand(scenario, "selfd")).toBe(scenario);
    expect(addCommand(scenario, "")).toBe(scenario);
    expect(loads(scenario)).toBe(true);
  });

  it("carries no empty command list once the last one is lifted", () => {
    const scenario = removeCommand(
      addCommand(newScenario("t"), "selfd"),
      "selfd",
    );
    expect("commands" in scenario.restrictions).toBe(false);
  });

  it("warns that an empty allow list forbids everything", () => {
    expect(buildableWarning(newScenario("t"))).toBeNull();
    const allow = setBuildableMode(newScenario("t"), "allow");
    expect(buildableWarning(allow)).toContain("can build anything");
    const deny = setBuildableMode(newScenario("t"), "deny");
    expect(buildableWarning(deny)).toContain("does nothing");
  });
});
