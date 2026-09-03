-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 7,
  id = "foundry",
  name = "Foundry",
  description = "A rebuild the player is bankrolled through, with a bonus for doing it the hard way.",
  game = "Test Game",
  map = "Comet Catcher Redux",
  teams = {
    player = {
      team = 0,
      resources = { metal = 200, energy = 200 },
      income = { metal = 3, energy = 0 },
    },
    rivals = { team = 1 },
  },
  zones = {
    {
      id = "yard",
      name = "The yard",
      shape = "box",
      min = { x = 900, z = 900 },
      max = { x = 1500, z = 1500 },
    },
  },
  actors = {
    {
      id = "engineer",
      unitDef = "armck",
      team = "player",
      pos = { x = 1000, z = 1000 },
      facing = 0,
    },
    {
      id = "works",
      unitDef = "armlab",
      team = "player",
      pos = { x = 1300, z = 1300 },
      facing = 0,
    },
  },
  groups = {},
  prefabs = {},
  restrictions = {},
  vars = { grant = 500 },
  triggers = {
    {
      id = "grant-arrives",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "time_elapsed",
            params = { seconds = 10 },
          },
        },
      },
      actions = {
        {
          type = "give_resources",
          params = {
            energy = -50,
            metal = { var = "grant" },
            team = "player",
          },
        },
        {
          type = "give_storage",
          params = { energy = 1000, metal = 1000, team = "player" },
        },
        {
          type = "set_income",
          params = { energy = -5, metal = 10, team = "player" },
        },
        {
          type = "build_unit",
          params = {
            builder = "engineer",
            count = 2,
            facing = 0,
            pos = { x = 1200, z = 1200 },
            unitDef = "armsolar",
          },
        },
        {
          type = "build_unit",
          params = { builder = "works", unitDef = "armpw" },
        },
      },
    },
    {
      id = "purist-run",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "time_elapsed",
            params = { seconds = 120 },
          },
          {
            type = "unit_built",
            params = { count = 1, team = "player", unitDef = "armfus" },
            negate = true,
          },
        },
      },
      actions = {
        {
          type = "complete_objective",
          params = { objective = "purist" },
        },
        {
          type = "call_lua",
          params = { func = "GG.TestGame.Applaud" },
        },
      },
    },
  },
  objectives = {
    {
      id = "purist",
      kind = "secondary",
      text = "Get to two minutes without building a fusion plant.",
      hidden = false,
    },
  },
  dialogue = {},
}
