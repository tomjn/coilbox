-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 6,
  id = "outbreak",
  name = "Outbreak",
  description = "A raid the player holds off, with more of it the harder they asked for.",
  game = "Test Game",
  map = "Comet Catcher Redux",
  teams = {
    player = { team = 0 },
    raiders = { team = 1 },
  },
  zones = {
    {
      id = "landing",
      name = "Landing",
      shape = "circle",
      center = { x = 1200, z = 1200 },
      radius = 400,
    },
  },
  actors = {
    {
      id = "beacon",
      unitDef = "armsolar",
      team = "player",
      pos = { x = 1200, z = 1200 },
      facing = 0,
    },
    {
      id = "warlord",
      unitDef = "corcom",
      team = "raiders",
      pos = { x = 2400, z = 2400 },
      facing = 2,
      difficulty = { atLeast = "hard" },
    },
  },
  groups = {
    {
      id = "escort",
      team = "player",
      units = {
        { def = "armpw", count = 2 },
      },
      pos = { x = 1200, z = 1400 },
      orders = {
        { kind = "guard", target = "beacon" },
      },
      dormant = false,
    },
    {
      id = "second-wave",
      team = "raiders",
      units = {
        { def = "corak", count = 4 },
      },
      pos = { x = 2600, z = 2600 },
      orders = {
        {
          kind = "fight",
          waypoints = {
            { x = 1200, z = 1200 },
          },
        },
      },
      dormant = true,
      difficulty = { atLeast = "hard" },
    },
  },
  prefabs = {
    {
      id = "spare-turret",
      team = "player",
      origin = { x = 1100, z = 1100 },
      difficulty = { atMost = "normal" },
      buildings = {
        {
          id = "spare-gun",
          def = "armllt",
          offset = { x = 0, z = 0 },
          facing = 0,
        },
      },
    },
    {
      id = "raider-turret",
      team = "raiders",
      origin = { x = 2500, z = 2500 },
      difficulty = { atLeast = "normal", atMost = "hard" },
      buildings = {
        {
          def = "armllt",
          offset = { x = 0, z = 0 },
          facing = 0,
        },
      },
    },
  },
  restrictions = {},
  vars = { waves = 0 },
  triggers = {
    {
      id = "first-wave",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "time_elapsed",
            params = { seconds = 60 },
          },
        },
      },
      actions = {
        {
          type = "add_var",
          params = { name = "waves", value = 1 },
        },
      },
    },
    {
      id = "second-wave-arrives",
      enabled = true,
      ["repeat"] = false,
      difficulty = { atLeast = "hard" },
      conditions = {
        op = "all",
        conditions = {
          {
            type = "time_elapsed",
            params = { seconds = 120 },
          },
        },
      },
      actions = {
        {
          type = "wake_group",
          params = { group = "second-wave" },
        },
        {
          type = "add_var",
          params = { name = "waves", value = 1 },
        },
      },
    },
    {
      id = "mercy",
      enabled = true,
      ["repeat"] = false,
      difficulty = { atMost = "easy" },
      conditions = {
        op = "all",
        conditions = {
          {
            type = "unit_health_below",
            params = { actor = "beacon", fraction = 0.5 },
          },
        },
      },
      actions = {
        {
          type = "map_marker",
          params = {
            pos = { x = 1200, z = 1200 },
            text = "The beacon is failing",
          },
        },
      },
    },
    {
      id = "held",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "time_elapsed",
            params = { seconds = 300 },
          },
        },
      },
      actions = {
        {
          type = "complete_objective",
          params = { objective = "hold-out" },
        },
        {
          type = "victory",
          params = { team = "player" },
        },
      },
    },
  },
  objectives = {
    {
      id = "hold-out",
      kind = "primary",
      text = "Keep the beacon standing for five minutes.",
      hidden = false,
    },
  },
  dialogue = {},
}
