-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 8,
  id = "drill",
  name = "Drill",
  description = "A first lesson: select the builder, move it, then tell it to build.",
  game = "Test Game",
  map = "Comet Catcher Redux",
  teams = {
    player = { team = 0 },
    rivals = { team = 1 },
  },
  zones = {},
  actors = {
    {
      id = "engineer",
      unitDef = "armck",
      team = "player",
      pos = { x = 1000, z = 1000 },
      facing = 0,
    },
    {
      id = "scout",
      unitDef = "armpw",
      team = "player",
      pos = { x = 1100, z = 1000 },
      facing = 0,
    },
  },
  groups = {},
  prefabs = {},
  restrictions = {},
  vars = { orders = 0 },
  triggers = {
    {
      id = "pick-anything",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "unit_selected",
            params = {},
          },
        },
      },
      actions = {
        {
          type = "complete_objective",
          params = { objective = "pick" },
        },
      },
    },
    {
      id = "pick-engineer",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "unit_selected",
            params = { actor = "engineer", team = "player" },
          },
        },
      },
      actions = {
        {
          type = "complete_objective",
          params = { objective = "engineer" },
        },
        {
          type = "enable_trigger",
          params = { trigger = "order-move" },
        },
      },
    },
    {
      id = "order-move",
      enabled = false,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "command_given",
            params = { command = "move", team = "player" },
          },
        },
      },
      actions = {
        {
          type = "complete_objective",
          params = { objective = "move" },
        },
        {
          type = "enable_trigger",
          params = { trigger = "order-again" },
        },
      },
    },
    {
      id = "order-again",
      enabled = false,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "command_given",
            params = { command = "move", team = "player" },
          },
        },
      },
      actions = {
        {
          type = "complete_objective",
          params = { objective = "again" },
        },
      },
    },
    {
      id = "order-solar",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "unit_selected",
            params = { unitDef = "armck" },
          },
          {
            type = "command_given",
            params = { unitDef = "armsolar" },
          },
        },
      },
      actions = {
        {
          type = "complete_objective",
          params = { objective = "solar" },
        },
      },
    },
    {
      id = "count-builds",
      enabled = true,
      ["repeat"] = true,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "command_given",
            params = { command = "build" },
          },
        },
      },
      actions = {
        {
          type = "add_var",
          params = { name = "orders", value = 1 },
        },
      },
    },
    {
      id = "idle-hands",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "time_elapsed",
            params = { seconds = 10 },
          },
          {
            type = "command_given",
            params = {},
            negate = true,
          },
        },
      },
      actions = {
        {
          type = "fail_objective",
          params = { objective = "prompt" },
        },
      },
    },
  },
  objectives = {
    {
      id = "pick",
      kind = "primary",
      text = "Select a unit.",
      hidden = false,
    },
    {
      id = "engineer",
      kind = "primary",
      text = "Select the engineer.",
      hidden = false,
    },
    {
      id = "move",
      kind = "primary",
      text = "Give a move order.",
      hidden = false,
    },
    {
      id = "again",
      kind = "primary",
      text = "Give another move order.",
      hidden = false,
    },
    {
      id = "solar",
      kind = "primary",
      text = "With a builder selected, order a solar collector.",
      hidden = false,
    },
    {
      id = "prompt",
      kind = "secondary",
      text = "Give an order within ten seconds.",
      hidden = false,
    },
  },
  dialogue = {},
}
