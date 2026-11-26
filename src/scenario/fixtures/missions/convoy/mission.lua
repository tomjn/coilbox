-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 20,
  id = "convoy",
  name = "Convoy",
  description = "Triggers that count units: the convoy arriving and thinning out, the raiders being wiped, the depot cleared of everything but walls, counted each time they come back to it, woken when they fire on the convoy, and a scout who has visited the depot and the ford in either order.",
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
    {
      id = "ford",
      name = "Ford",
      shape = "circle",
      center = { x = 800, z = 2400 },
      radius = 150,
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
      id = "depot-cleared",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "units_in_zone",
            params = {
              exceptDefs = { "cordrag", "corfort" },
              max = 0,
              team = "raiders",
              zone = "depot",
            },
          },
          {
            type = "unit_count",
            params = {
              exceptDefs = { "corck" },
              max = 0,
              team = "raiders",
              unitDefs = { "corak", "corck" },
            },
          },
        },
      },
      actions = {
        {
          type = "set_var",
          params = { name = "arrived", value = 2 },
        },
      },
    },
    {
      id = "depot-raided",
      enabled = true,
      ["repeat"] = true,
      onBecomingTrue = true,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "units_in_zone",
            params = { team = "raiders", zone = "depot" },
          },
        },
      },
      actions = {
        {
          type = "add_var",
          params = { name = "arrived", value = 1 },
        },
      },
    },
    {
      id = "convoy-attacked",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "unit_attacked",
            params = {
              attackerDefs = { "corak" },
              attackerTeam = "raiders",
              group = "convoy",
            },
          },
        },
      },
      actions = {
        {
          type = "give_orders",
          params = {
            group = "convoy",
            orders = {
              { kind = "attack", target = "raid" },
            },
          },
        },
      },
    },
    {
      id = "both-scouted",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "units_in_zone",
            params = { team = "player", zone = "depot" },
            latched = true,
          },
          {
            type = "units_in_zone",
            params = { team = "player", zone = "ford" },
            latched = true,
          },
        },
      },
      actions = {
        {
          type = "set_var",
          params = { name = "arrived", value = 3 },
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
