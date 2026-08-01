-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 1,
  id = "ambush",
  name = "Ambush",
  description = "A raider group waits in the pass and springs on the player's approach.",
  game = "Test Game",
  map = "Comet Catcher Redux",
  teams = {
    enemy = {
      team = 1,
      resources = { metal = 500, energy = 500 },
      noCommander = true,
    },
    player = { team = 0 },
  },
  zones = {
    {
      id = "pass",
      name = "Mountain Pass",
      shape = "box",
      min = { x = 1800, z = 1800 },
      max = { x = 2200, z = 2200 },
    },
  },
  actors = {
    {
      id = "scout",
      unitDef = "armpw",
      team = "enemy",
      pos = { x = 2000, z = 2000 },
      facing = 0,
      state = { hp = 1 },
    },
  },
  groups = {
    {
      id = "raiders",
      team = "enemy",
      units = {
        { def = "armpw", count = 4 },
      },
      pos = { x = 2000, z = 2120 },
      orders = {
        { kind = "guard", target = "scout" },
      },
      dormant = true,
    },
  },
  prefabs = {},
  restrictions = {},
  vars = { alertLevel = 0 },
  triggers = {
    {
      id = "spring-ambush",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "units_in_zone",
            params = { team = "player", zone = "pass" },
          },
        },
      },
      actions = {
        {
          type = "spawn_group",
          params = { group = "raiders" },
        },
        {
          type = "wake_group",
          params = { group = "raiders" },
        },
        {
          type = "give_orders",
          params = {
            group = "raiders",
            orders = {
              { kind = "attack", target = "scout" },
            },
          },
        },
        {
          type = "dialogue",
          params = { line = "warn" },
        },
        {
          type = "camera_pan",
          params = {
            pos = { x = 2000, z = 2000 },
            seconds = 2,
          },
        },
        {
          type = "map_marker",
          params = {
            pos = { x = 2000, z = 2000 },
            text = "Ambush!",
          },
        },
        {
          type = "play_sound",
          params = { sound = "alarm.wav" },
        },
      },
    },
    {
      id = "scout-down",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "unit_dead",
            params = { actor = "scout" },
          },
        },
      },
      actions = {
        {
          type = "dialogue",
          params = { line = "warn" },
        },
      },
    },
    {
      id = "scout-wounded",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "unit_health_below",
            params = { actor = "scout", fraction = 0.5 },
          },
        },
      },
      actions = {
        {
          type = "dialogue",
          params = { line = "warn" },
        },
      },
    },
  },
  objectives = {
    {
      id = "survive-ambush",
      kind = "primary",
      text = "Survive the ambush.",
      hidden = false,
    },
  },
  dialogue = {
    {
      id = "warn",
      speaker = "HQ",
      text = "Contact! Raiders inbound.",
    },
  },
}
