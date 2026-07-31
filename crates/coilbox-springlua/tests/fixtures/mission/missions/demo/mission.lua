-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 1,
  id = "demo",
  name = "Demo Mission",
  description = "A fixture.",
  game = "Test Game 1.0",
  map = "Comet Catcher Redux",
  teams = {
    ["Enemy-1"] = {
      team = 1,
      resources = { metal = 500 },
      noCommander = true,
    },
    ghost = {},
    player = { team = 0 },
  },
  zones = {
    {
      id = "gate",
      name = "Gate",
      shape = "box",
      min = { x = 0, z = 0 },
      max = { x = 100, z = 100 },
    },
  },
  actors = {
    {
      id = "boss",
      unitDef = "armcom",
      team = "Enemy-1",
      pos = { x = 10, z = 10 },
      facing = 2,
    },
  },
  groups = {
    {
      id = "wave1",
      team = "Enemy-1",
      units = {
        { def = "armpw", count = 3 },
      },
      pos = { x = 20, z = 20 },
      orders = {
        { kind = "guard", target = "boss" },
      },
      dormant = true,
    },
  },
  prefabs = {
    {
      id = "base",
      team = "player",
      origin = { x = 5, z = 5 },
      buildings = {
        {
          def = "armlab",
          offset = { x = 0, z = 0 },
          facing = 1,
        },
      },
    },
  },
  restrictions = {},
  vars = { Alarm = 0, waves = 2 },
  triggers = {
    {
      id = "open",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "units_in_zone",
            params = { team = "player", zone = "gate" },
          },
          {
            type = "var",
            params = { name = "Alarm", op = "eq", value = 0 },
          },
        },
      },
      actions = {
        {
          type = "spawn_group",
          params = { group = "wave1" },
        },
        {
          type = "dialogue",
          params = { line = "intro" },
        },
        {
          type = "complete_objective",
          params = { objective = "kill-boss" },
        },
        {
          type = "disable_trigger",
          params = { trigger = "open" },
        },
        {
          type = "give_orders",
          params = {
            group = "wave1",
            orders = {
              { kind = "attack", target = "boss" },
            },
          },
        },
        {
          type = "sf_weather",
          params = { kind = "storm" },
        },
      },
    },
  },
  objectives = {
    {
      id = "kill-boss",
      kind = "primary",
      text = "Kill the boss.",
      hidden = false,
    },
  },
  dialogue = {
    { id = "intro", speaker = "HQ", text = "Move out." },
  },
}
