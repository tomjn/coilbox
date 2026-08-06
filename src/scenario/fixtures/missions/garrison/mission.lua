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
      center = { x = 2000, z = 2000 },
      radius = 200,
    },
  },
  actors = {
    {
      id = "outpost",
      unitDef = "armestor",
      team = "garrison",
      pos = { x = 2000, z = 1900 },
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
      pos = { x = 2000, z = 2100 },
      orders = {
        {
          kind = "move",
          waypoints = {
            { x = 2100, z = 2100 },
          },
        },
        {
          kind = "patrol",
          waypoints = {
            { x = 2100, z = 2100 },
            { x = 2100, z = 1900 },
          },
        },
        {
          kind = "fight",
          waypoints = {
            { x = 2100, z = 1900 },
            { x = 1900, z = 1900 },
          },
        },
      },
      dormant = true,
    },
  },
  prefabs = {},
  restrictions = {
    buildable = {
      mode = "deny",
      units = { "armestor" },
    },
  },
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
      id = "reinforcement-wave",
      enabled = true,
      ["repeat"] = true,
      cooldown = 60,
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
          type = "spawn_group",
          params = { group = "reinforcements" },
        },
        {
          type = "wake_group",
          params = { group = "reinforcements" },
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
