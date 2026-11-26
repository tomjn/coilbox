-- Coilbox mission runtime: version marker and capability table.
--
-- Coilbox reads this file out of a game to find out which runtime that game has
-- vendored, what the editor may offer, and whether a scenario will run. It is
-- data only, with no globals and no engine calls, so it evaluates the same in
-- the engine and in coilbox's sandboxed Lua reader.
--
-- version is what a scenario names in its runtimeVersion. Bump it in the same
-- change that adds a condition or action type below, or a format feature an
-- older runtime would ignore. Never drop a type from a version that has shipped:
-- a scenario asking for it would then start silently doing nothing, which is the
-- failure this file exists to prevent.
--
-- 2 added no types. It records which unit each named prefab building became, so
-- a trigger can name one (issue #878). Version 1 ignores a building's id, and
-- `unit_dead` on a name it has never heard of holds from the first frame, so a
-- scenario that names one has to be refused rather than half played.
--
-- 3 is four format changes at once, because each of them on its own would have
-- wanted a version of its own and a game chasing four floors for one release is
-- worse than a game chasing one:
--
--   * a var condition and the two var actions take a number or the name of
--     another var, so a mission can compare a counter against a quota
--     (issue #808)
--   * camera_pan and map_marker name a team, so a co-op mission does not yank
--     every player's camera (issue #827)
--   * zone_held_for can ask for an uncontested hold (issue #802)
--   * release_group stops the mission ordering a squad it handed over
--     (issue #812)
--
-- Each raises a scenario's requiredRuntimeVersion only when the scenario uses
-- it, so nothing already authored asks for 3.
--
-- 4 added no types and no format features, so nothing asks for it. It rewrote
-- how the mission widget draws, and the version is also what tells coilbox an
-- installed runtime is older than the one it ships, which is how a game that
-- vendored 3 is offered the new widget.
--
-- 5 adds no types either. It is what the runtime says when it refuses to do
-- something: a spawn the engine would not make and an order given to a group
-- with nothing on the map are logged at Error rather than passed over or filed
-- as a warning (issue #2165). A game that vendored 4 plays every scenario the
-- same way, and is offered this so its authors can tell a mission that placed
-- nothing from one whose units did not arrive.

-- 6 adds no types either, and it is a format feature: an actor, a group, a base
-- and a trigger may each carry a difficulty range, and the level comes in on the
-- coilbox_difficulty modoption (issue #2164). A game that vendored 5 reads past
-- every range and plays the hard version of the mission whatever the player
-- picked, so a scenario that gates anything asks for 6 and one that gates
-- nothing still asks for whatever it asked for before.

-- 7 adds five actions and one format feature, in one version because they were
-- written together and a game chasing six floors for one release is worse than
-- a game chasing one:
--
--   * call_lua calls a function the game already has, by dotted name
--   * build_unit tells one of the mission's units to build something, at a
--     point or into a factory queue
--   * give_resources moves a team's bank once, up for a gift and down for a
--     drain
--   * set_income says what a team is paid per second from now on, which a
--     negative number turns into a continuous bleed
--   * give_storage moves how much a team can hold
--   * a condition may carry `negate = true`, and then it holds when the type
--     underneath it does not. That is how a mission asks whether something has
--     not happened, which is what a bonus objective for finishing without
--     building something is made of. A negated condition is polled whatever the
--     type underneath it watches.
--
-- A runtime behind 7 has no implementation for any of the five actions, so each
-- reports itself once and does nothing, and it reads past the negation and
-- answers the question the right way up, which is the exact opposite of the
-- mission that was written. So a scenario using any of them asks for 7.

-- 8 adds two conditions, the first that read what a player did rather than what
-- the world looks like (issue #3551):
--
--   * unit_selected holds while a player has a unit selected: any unit, one of
--     a type, or one the scenario placed
--   * command_given holds once a player has given an order since the trigger
--     was armed: any order, one command, or building one unit type
--
-- A runtime behind 8 has no implementation for either, so each reports itself
-- once and never holds, and a lesson waiting on one waits for ever. So a
-- scenario using either asks for 8.

-- 9 is what lets a lesson stop and wait for the player to read (issue #3552).
-- Two actions, one condition and one format feature:
--
--   * pause_game stops the game clock and unpause_game starts it again, in
--     single player only
--   * dialogue_dismissed holds once a player has clicked away a line the
--     mission held on screen, since the trigger was armed
--   * a dialogue action may carry `hold = true`, and then its line stays on the
--     panel until the player dismisses it
--
-- A runtime behind 9 has no implementation for the two actions or the
-- condition, and it reads past the flag and takes the line down on its timer.
-- So a lesson built on any of them would run on without waiting, or wait for
-- ever on a dismissal that cannot come, and a scenario using one asks for 9.
--
-- 9 rather than more of 8, although 8 had not been in a release when this was
-- written. A game may already have installed 8 from a development build, and a
-- second, different 8 is one the version check cannot tell from the first.

-- 10 is a base's terrain changes (issue #4799). One action and two format
-- features:
--
--   * a base may carry `terrain`, steps that raise, level, ramp or smooth the
--     ground, and the runtime sets that ground before the base's buildings are
--     placed on it
--   * a base may be `dormant`, and then it is not placed at the start
--   * spawn_base places a dormant base, ground first
--
-- A runtime behind 10 reads past both fields: it places a walled base with no
-- walls, and places a dormant base at the start. So a scenario using either
-- asks for 10.

-- 11 is a group that starts on the map asleep (issue #900). One format feature:
--
--   * a group may carry `startsAsleep`, and then it is placed at the start on
--     hold position and runs its orders only once `wake_group` releases it
--
-- A runtime behind 11 reads past the field and sets the group off on its orders
-- at the first frame. So a scenario using it asks for 11.

-- 12 is a group hunting a participant (issue #903). One format feature:
--
--   * an order may be `{ kind = "hunt", team = <participant> }`, on a group or in
--     `give_orders`, and then the group is sent again and again at the nearest
--     unit that team has
--
-- A runtime behind 12 reports the kind as unknown and the group stands still. So
-- a scenario using it asks for 12.

-- 13 is the neutral team (issue #5252). One format feature:
--
--   * a team may be `{ gaia = true, color = { r, g, b } }`, and then what is placed
--     for it goes on the engine's Gaia team, marked neutral and holding its fire,
--     and Gaia is drawn in that colour
--
-- A runtime behind 13 finds no engine team number on it and drops the team, and
-- everything placed for it with it. So a scenario with a neutral team asks for 13.

-- 14 lets a condition ask about a group (issue #5292). One condition and two
-- format features:
--
--   * group_dead holds once every unit in a group has died, and is false until
--     the group has been on the map
--   * units_in_zone and unit_count may carry `group`, and then count only that
--     group's living units. `team` is optional on unit_count when a group is given
--   * units_in_zone may carry `all` with a group, and then holds only while every
--     living unit of the group is in the zone
--
-- A runtime behind 14 has no implementation for group_dead, so it reports itself
-- once and never holds. It reads past `group` and `all` and counts every unit
-- the zone or team holds, so "the convoy arrived" holds when anything at all is
-- in the zone. So a scenario using any of them asks for 14.

-- 15 lets a count leave unit types out (issue #5293). One format feature:
--
--   * units_in_zone and unit_count may carry `exceptDefs`, and then never count a
--     unit of a type it names, whether or not `unitDefs` names it too
--
-- A runtime behind 15 reads past the field and counts those units, so "clear the
-- base" goes on waiting for every wall in it. So a scenario using it asks for 15.

-- 16 lets a repeating trigger fire once each time its conditions become true
-- (issue #5295). One format feature:
--
--   * a repeating trigger may carry `onBecomingTrue = true`, and then fires only
--     as its conditions go from not holding to holding
--
-- A runtime behind 16 reads past the field and fires on every pass the conditions
-- hold, so a line meant once is said twice a second. So a scenario using it asks
-- for 16.

-- 17 adds one condition, the first that hears a hit (issue #5298):
--
--   * unit_attacked holds once a named actor, or any unit of a group, has taken
--     damage from another unit since the trigger was armed
--
-- A runtime behind 17 has no implementation for it, so it reports itself once
-- and never holds. So a scenario using it asks for 17.

-- 18 adds no types and no format features, so nothing asks for it. It follows an
-- actor through an upgrade (issue #5297). Beyond All Reason's evolving
-- commanders and Splinter Faction's morphs replace a unit with a new one in its
-- place, and a runtime behind 18 counts the actor dead from then on. Nothing a
-- scenario writes says it wants the actor followed, so no scenario can ask, and
-- the version is how a game that vendored 17 is offered the fix.

-- 19 adds no types and no format features either. It keeps a group's unit in the
-- group through the same upgrade (issue #5475), where a runtime behind 19 drops
-- it and can call the group dead while it is alive.

return {
	version = 19,

	-- The compiled mission format this runtime reads.
	schemaVersion = 1,

	conditions = {
		"units_in_zone",
		"unit_count",
		"unit_dead",
		"group_dead",
		"unit_health_below",
		"unit_attacked",
		"unit_built",
		"unit_captured",
		"unit_selected",
		"command_given",
		"dialogue_dismissed",
		"time_elapsed",
		"var",
		"zone_held_for",
	},

	actions = {
		"spawn_group",
		"wake_group",
		"give_orders",
		"gift_units",
		"release_group",
		"set_var",
		"add_var",
		"enable_trigger",
		"disable_trigger",
		"complete_objective",
		"fail_objective",
		"dialogue",
		"play_sound",
		"reveal_area",
		"unlock_unit",
		"camera_pan",
		"map_marker",
		"victory",
		"defeat",
		"call_lua",
		"build_unit",
		"give_resources",
		"set_income",
		"give_storage",
		"pause_game",
		"unpause_game",
		"spawn_base",
	},
}
