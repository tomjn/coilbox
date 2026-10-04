-- Compiled by coilbox from a scenario document.
-- Do not edit: change the scenario and compile again.
return {
  schemaVersion = 1,
  runtimeVersion = 9,
  id = "briefing",
  name = "Briefing",
  description = "A lesson that stops the game and waits for the player to read.",
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
  },
  groups = {},
  prefabs = {},
  restrictions = {},
  vars = {},
  triggers = {
    {
      id = "brief",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "time_elapsed",
            params = { seconds = 1 },
          },
        },
      },
      actions = {
        {
          type = "pause_game",
          params = {},
        },
        {
          type = "dialogue",
          params = { hold = true, line = "welcome" },
        },
      },
    },
    {
      id = "read",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "dialogue_dismissed",
            params = { line = "welcome" },
          },
          {
            type = "time_elapsed",
            params = { seconds = 1 },
          },
        },
      },
      actions = {
        {
          type = "complete_objective",
          params = { objective = "read" },
        },
        {
          type = "dialogue",
          params = { hold = true, line = "orders" },
        },
      },
    },
    {
      id = "ready",
      enabled = true,
      ["repeat"] = false,
      conditions = {
        op = "all",
        conditions = {
          {
            type = "dialogue_dismissed",
            params = { line = "orders" },
          },
        },
      },
      actions = {
        {
          type = "unpause_game",
          params = {},
        },
        {
          type = "complete_objective",
          params = { objective = "ready" },
        },
        {
          type = "dialogue",
          params = { line = "thanks" },
        },
      },
    },
  },
  objectives = {
    {
      id = "read",
      kind = "primary",
      text = "Read the welcome.",
      hidden = false,
    },
    {
      id = "ready",
      kind = "primary",
      text = "Read your orders.",
      hidden = false,
    },
  },
  dialogue = {
    {
      id = "welcome",
      speaker = "Instructor",
      text = "Welcome, recruit. The game is paused while you read this.",
    },
    {
      id = "orders",
      speaker = "Instructor",
      text = "Your engineer builds everything. Click when you are ready to start.",
    },
    {
      id = "thanks",
      speaker = "Instructor",
      text = "Good. The clock is running again.",
    },
  },
}
