-- Beyond All Reason's playback adapter (issue #3801).
--
-- What is listed here is what fights a recording. Everything that tells a
-- viewer about the match stays: the top bar with its resource bars, the players
-- list, the minimap, the unit information panel and the tooltip, health bars,
-- the spectator's economy panels and the game's own effects, lights and sounds.
--
-- The file names were read from the rapid package of test-30922-8064a43, and
-- the match the adapter was run on was played on that version. There is no
-- version range. Beyond All Reason has a new version most days and a replay is
-- played on the one it was recorded on, so a range would leave nearly every
-- replay with no adapter. A name that a version does not have switches nothing
-- off, since the file that stands in for it returns false and nothing else.
--
-- lua/rewind-player/README.md has what each of these did to a playback, and
-- which were seen in an engine and which only read.

-- The frame the game shows the warp in effect on and the frame a start
-- commander appears on. The game keeps them in Game.spawnInitialFrame and
-- Game.spawnWarpInFrame, which are read when a hook first runs. This file is
-- also read where there is no Game.
local initialFrame, warpInFrame

-- The units that are commanders, by the engine's unit id, and whether they are
-- hidden now. A start commander is in the track from the first frame, and the
-- match did not draw it until it had warped in.
local commanders = {}
local isCommander
local hidden = false
-- The time the hook last saw, to tell that play has just passed a frame.
local lastTime

local function ready()
	if not isCommander then
		isCommander = {}
		for id, def in pairs(UnitDefs) do
			if def.customParams and def.customParams.iscommander then
				isCommander[id] = true
			end
		end
		initialFrame = Game.spawnInitialFrame or 2 * Game.gameSpeed
		warpInFrame = Game.spawnWarpInFrame or 3 * Game.gameSpeed
	end
end

-- The queued buildings the game's unit shape widget is drawing for the ghosts
-- widget, as shapes[unitDefID][x][z]. That widget keeps a shape until it is told
-- to drop it, so each is asked for once and dropped when a pass of drawing no
-- longer has it.
local shapes = {}
local shapeCount = 0
local pass, asked = 1, 0
local OWNER = "coilbox rewind ghosts"
-- How much of a queued building shows through, from none to all of it.
local SHAPE_ALPHA = 0.5

local function dropStale()
	local stop = WG.StopDrawUnitShapeGL4
	for _, byX in pairs(shapes) do
		for _, byZ in pairs(byX) do
			for z, shape in pairs(byZ) do
				if shape.pass ~= pass then
					if stop then
						stop(shape.id)
					end
					byZ[z] = nil
					shapeCount = shapeCount - 1
				end
			end
		end
	end
end

return {
	name = "Beyond All Reason",
	shortname = "BYAR",

	gadgets = {
		-- Ends the match and kills a team whose units are gone, which every team
		-- is before its first unit is placed and after a seek to before it.
		"game_end.lua",
		-- Kills a team that has no commander, on the same grounds.
		"game_team_com_ends.lua",
		-- Creates a commander for every team when the match starts, hidden and
		-- paralysed until it warps in. The track has the match's own. The hooks
		-- below do what else this gadget did that a viewer sees.
		"game_initial_spawn.lua",
		-- Leaves a gravestone where a commander dies. It hears of a commander a
		-- seek removes as well, and the track has the gravestones the match left.
		"unit_tombstones.lua",
		-- Destroys a unit that is created unfinished by nothing that builds, which
		-- is every building the player places part way through its construction.
		"unit_prevent_lab_hax2.lua",
		-- Destroys the extractor under a new one, and the generator under a new
		-- geothermal one, and pays for it. The track has both at their own times.
		"unit_mex_upgrade_reclaimer.lua",
		"unit_geo_upgrade_reclaimer.lua",
		-- Destroys the features inside a new building's footprint, with an effect
		-- and a sound for each. A wreck that fell there later in the match is one
		-- of the track's features, and a seek to that time destroyed it.
		"unit_footprint_clearance.lua",
		-- A finished construction turret base is replaced by two units, and a
		-- finished Legion extractor with a turret by another two. The track has
		-- every one of them as a unit of its own.
		"unit_attached_con_turret.lua",
		"unit_attached_con_turret_mex.lua",
		-- Creates the map's wildlife and removes it again on its own clock. The
		-- track has the animals the match had.
		"game_critters.lua",
		-- Creates a carrier's drones, heals and moves them and destroys them with
		-- the carrier. The track has every drone.
		"unit_carrier_spawner.lua",
		-- These act on a shot that is created or lands, and the player creates
		-- every shot of the track. They create units or more shots of their own,
		-- move and delete a shot the player is holding, or destroy units near
		-- where one lands.
		"unit_explosion_spawner.lua",
		"unit_custom_weapons_cluster.lua",
		"unit_custom_weapons_behaviours.lua",
		"unit_custom_weapons_overpen.lua",
		"unit_lightning_splash_dmg.lua",
		"unit_juno_damage.lua",
		"unit_juno_damage_mini.lua",
		"unit_juno_rework_damage.lua",
		-- Takes a commander caught in another commander's blast out of the
		-- player's hands and moves it.
		"game_preventcombomb.lua",

		-- The rest only run under a game mode or a mod option, and create units
		-- or features that the track has. None was in the match the adapter was
		-- run on, so they were read and not seen.
		"game_quick_start.lua",
		"game_assistdronespawn.lua",
		"game_commander_builder.lua",
		"game_coop_ii.lua",
		"unit_scenario_loadout.lua",
		"unit_zombies.lua",
		"unit_evolution.lua",
		"unit_respawning.lua",
		"unit_xmas.lua",
		"game_easter_eggs.lua",
		"ai_ruins.lua",
	},

	widgets = {
		-- The build menu and the order menu of a selected unit. A spectator's
		-- orders go nowhere, and the order menu's right hand column is under the
		-- timeline.
		"gui_gridmenu.lua",
		"gui_ordermenu.lua",
		-- The Player View button above the players list, which follows a
		-- player's camera (issue #4033). A playback has no players, only its one
		-- spectator. The line under the players list with the time, the speed and
		-- the frame rate stays: it offers nothing to press, and it hides the
		-- engine's own clock, which shows at the top right without it. Its time
		-- and speed are the engine's (issue #4013). The music player stays too:
		-- its pause, next and sliders are the music's and the sound's, not the
		-- engine's.
		"camera_player_tv.lua",
		-- The time left over a building under construction, which works it out from
		-- how fast build progress moved between the frames it watched. A playback's
		-- build progress moves at the speed of play, backward too, so the label
		-- read "Decaying" when a playback ran backward (issue #4048). Build
		-- progress still shows.
		"gui_build_eta.lua",
	},

	-- The numbers the game's panels read that are the game's own and not the
	-- engine's (issue #3982). startUnit is each team's commander, which the top
	-- bar and the players list take a team's faction from, and game_initial_spawn
	-- set it. The other four are the energy converters: the level a team set
	-- theirs to, their capacity, what they use and how well they convert, which
	-- the top bar's slider and the converter panel show. game_energy_conversion
	-- writes them from the playback's own economy and stays, since it is also
	-- what makes a converter convert.
	--
	-- Metal and energy need nothing here. The track has each team's own, storage
	-- included, and the player sets them whatever the game.
	teamParams = { "startUnit", "mmLevel", "mmCapacity", "mmUse", "mmAvgEffi" },

	hooks = {
		-- What game_initial_spawn set before the match that the game's widgets
		-- read as they load: each team's commander, from its side, and the list
		-- of commanders a team may start with. The track has the first again from
		-- its first frame, as the match had it.
		started = function()
			local gaia = Spring.GetGaiaTeamID()
			for _, team in ipairs(Spring.GetTeamList()) do
				if team ~= gaia then
					local side = select(5, Spring.GetTeamInfo(team, false))
					local name = Spring.GetSideData(side)
					local def = name and UnitDefNames[name]
					if def then
						Spring.SetTeamRulesParam(team, "startUnit", def.id, { allied = true, public = false })
					end
				end
			end
			local ids = {}
			for _, side in ipairs(Spring.GetSideData()) do
				local def = UnitDefNames[side.startUnit]
				if def then
					ids[#ids + 1] = def.id
				end
			end
			Spring.SetGameRulesParam("validStartUnits", table.concat(ids, "|"))
		end,

		-- A commander placed before the frame it warps in on is not drawn yet.
		unitPlaced = function(unitID, unitDefID, t)
			ready()
			if isCommander[unitDefID] then
				commanders[unitID] = true
				if t < warpInFrame then
					Spring.SetUnitNoDraw(unitID, true)
				end
			end
		end,

		-- Start commanders are hidden before the frame they warp in on and drawn
		-- from it, whichever way the time went. Play that passes the frame of the
		-- game's warp in effect shows it, with its lightning and its sound.
		afterFrame = function(t, clock)
			ready()
			local hide = t < warpInFrame
			if hide ~= hidden then
				hidden = hide
				for unitID in next, commanders do
					if Spring.ValidUnitID(unitID) and isCommander[Spring.GetUnitDefID(unitID)] then
						Spring.SetUnitNoDraw(unitID, hide)
					else
						commanders[unitID] = nil
					end
				end
			end
			if lastTime and lastTime < initialFrame and t >= initialFrame and not clock.jumped and clock.direction == 1 and clock.speed <= 2 then
				for unitID in next, commanders do
					local x, y, z = Spring.GetUnitPosition(unitID)
					if x then
						Spring.SpawnCEG("commander-spawn", x, y, z, 0, 0, 0)
						if GG.SpawnEnvironmentalLightning then
							GG.SpawnEnvironmentalLightning("commanderspawn", x, y, z)
						end
					end
				end
				Spring.PlaySoundFile("commanderspawn", 0.6, "ui")
			end
			lastTime = t
		end,

		-- A queued building, drawn by the game's unit shape widget the way the
		-- game draws a builder's queue. The ghosts widget calls this in unsynced
		-- Lua for each queued building on every pass. Without the game's widget
		-- this raises, and the ghosts widget then draws its own outline.
		drawQueuedBuilding = function(unitDefID, teamID, x, y, z, facing)
			local draw = WG.DrawUnitShapeGL4
			if not draw then
				error("Beyond All Reason's unit shape widget, DrawUnitShape GL4, is not running")
			end
			asked = asked + 1
			local byX = shapes[unitDefID]
			if not byX then
				byX = {}
				shapes[unitDefID] = byX
			end
			local byZ = byX[x]
			if not byZ then
				byZ = {}
				byX[x] = byZ
			end
			local shape = byZ[z]
			if shape and (shape.team ~= teamID or shape.facing ~= facing or shape.y ~= y) then
				WG.StopDrawUnitShapeGL4(shape.id)
				byZ[z] = nil
				shapeCount = shapeCount - 1
				shape = nil
			end
			if not shape then
				-- A facing of 0 is south, and each one after it a quarter turn.
				local id = draw(unitDefID, x, y, z, facing * math.pi / 2, SHAPE_ALPHA, teamID, nil, nil, nil, OWNER)
				if not id then
					return
				end
				shape = { id = id, team = teamID, facing = facing, y = y }
				byZ[z] = shape
				shapeCount = shapeCount + 1
			end
			shape.pass = pass
		end,

		-- A pass of drawing is over. A shape the pass did not ask for is a
		-- building that is no longer queued, or one that has been started.
		queuedBuildingsDrawn = function()
			if asked ~= shapeCount then
				dropStale()
			end
			pass, asked = pass + 1, 0
		end,
	},
}
