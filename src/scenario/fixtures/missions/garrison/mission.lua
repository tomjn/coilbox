-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 1,
  id = "garrison",
  name = "Garrison",
  description = "The player builds up a garrison team, then unlocks and reinforces it.",
  game = "Test Game",
  map = "Comet Catcher Redux",
  teams = {
    garrison = {
      team = 1,
      startUnits = { "armck" },
      resources = { metal = 1000, energy = 1000 },
      income = { metal = 5, energy = 5 },
    },
    player = { team = 0 },
  },
  zones = {
    {
      id = "depot",
      name = "Supply Depot",
      shape = "circle",
      center = { x = 0, z = 0 },
      radius = 50,
    },
  },
  actors = {
    {
      id = "outpost",
      unitDef = "armestor",
      team = "garrison",
      pos = { x = 10, z = 10 },
      facing = 0,
      state = { name = "Outpost" },
    },
  },
  groups = {
    {
      id = "reinforcements",
      team = "player",
      units = {
        { def = "armpw", count = 2 },
      },
      pos = { x = 0, z = 0 },
      orders = {},
      dormant = true,
    },
  },
  prefabs = {},
  restrictions = {},
  vars = { garrisonBuilt = 0 },
  triggers = {
    {
      id = "count-check",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "unit_count",
            params = {
              min = 3,
              team = "garrison",
              unitDefs = { "armpw" },
            },
          },
        },
      },
      actions = {
        {
          type = "set_var",
          params = { name = "garrisonBuilt", value = 1 },
        },
        {
          type = "enable_trigger",
          params = { trigger = "unlock" },
        },
      },
    },
    {
      id = "built-outpost",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "unit_built",
            params = { count = 1, team = "garrison", unitDef = "armestor" },
          },
        },
      },
      actions = {
        {
          type = "add_var",
          params = { name = "garrisonBuilt", value = 1 },
        },
        {
          type = "disable_trigger",
          params = { trigger = "count-check" },
        },
      },
    },
    {
      id = "outpost-captured",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "unit_captured",
            params = { actor = "outpost", team = "player" },
          },
        },
      },
      actions = {
        {
          type = "gift_units",
          params = { group = "reinforcements", team = "garrison" },
        },
        {
          type = "reveal_area",
          params = { seconds = 30, team = "player", zone = "depot" },
        },
      },
    },
    {
      id = "unlock",
      enabled = false,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "var",
            params = { name = "garrisonBuilt", op = "gte", value = 1 },
          },
        },
      },
      actions = {
        {
          type = "unlock_unit",
          params = { team = "player", unitDef = "armestor" },
        },
      },
    },
  },
  objectives = {
    {
      id = "defend-garrison",
      kind = "secondary",
      text = "Defend the garrison.",
      hidden = true,
    },
  },
  dialogue = {},
}
