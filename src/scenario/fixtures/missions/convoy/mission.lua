-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 14,
  id = "convoy",
  name = "Convoy",
  description = "Triggers that ask about a group: the convoy arriving, thinning out, and the raiders being wiped.",
  game = "Test Game",
  map = "Comet Catcher Redux",
  teams = {
    player = { team = 0 },
    raiders = {
      team = 1,
      startUnits = { "corck" },
      resources = { metal = 1000, energy = 1000 },
      income = { metal = 5, energy = 5 },
    },
  },
  zones = {
    {
      id = "depot",
      name = "Depot",
      shape = "circle",
      center = { x = 2000, z = 2000 },
      radius = 200,
    },
  },
  actors = {},
  groups = {
    {
      id = "convoy",
      team = "player",
      units = {
        { def = "armpw", count = 3 },
      },
      pos = { x = 1000, z = 1000 },
      orders = {
        {
          kind = "move",
          waypoints = {
            { x = 2000, z = 2000 },
          },
        },
      },
      dormant = false,
    },
    {
      id = "raid",
      team = "raiders",
      units = {
        { def = "corak", count = 2 },
      },
      pos = { x = 1500, z = 1500 },
      orders = {
        { kind = "attack", target = "convoy" },
      },
      dormant = true,
    },
  },
  prefabs = {},
  restrictions = {},
  vars = { arrived = 0 },
  triggers = {
    {
      id = "convoy-arrived",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "units_in_zone",
            params = { all = true, group = "convoy", zone = "depot" },
          },
        },
      },
      actions = {
        {
          type = "set_var",
          params = { name = "arrived", value = 1 },
        },
      },
    },
    {
      id = "convoy-thinned",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "unit_count",
            params = { group = "convoy", max = 1 },
          },
        },
      },
      actions = {
        {
          type = "wake_group",
          params = { group = "raid" },
        },
      },
    },
    {
      id = "raid-wiped",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "group_dead",
            params = { group = "raid" },
          },
        },
      },
      actions = {
        {
          type = "victory",
          params = {},
        },
      },
    },
  },
  objectives = {},
  dialogue = {},
}
