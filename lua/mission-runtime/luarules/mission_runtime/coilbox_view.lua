-- Coilbox mission runtime: where the mission points the player.
--
-- `camera_pan` moves the camera to a place on the map. `map_marker` drops one of
-- the map's own labelled points there. Both are the player's screen rather than
-- the game, so, like a line of dialogue, synced Lua decides only that the
-- mission asked for one and the unsynced half does it.
--
-- They belong to the unsynced half of the gadget rather than to the widget
-- because neither needs a panel and neither queues behind anything, and a player
-- who has switched the widget off would otherwise get no markers.
--
-- Both take an optional team (issue #827). A mission more than one person is
-- playing has sides, and yanking every camera to one side's ambush is the
-- co-op version of telling the other player what is coming. Naming none means
-- everyone, which is what the format meant before this and what a single player
-- scenario wants.
--
-- The team is resolved here, in the synced half, because only the mission knows
-- which engine team a participant is. Which client acts on it is decided in the
-- unsynced half, because only a client knows which team it is watching.
--
-- Pure. No engine calls and no globals beyond the Lua standard library: the
-- ground height, the camera and the marker are all the host's, and arrive
-- through its hooks.

local M = {}

-- The team number that means every client, rather than one of them. Not nil,
-- because it crosses the synced boundary as an argument and a nil argument
-- there is an argument that is not sent.
M.EVERYONE = -1

-- How long a pan takes when the author does not say. A pan the player can
-- follow, because a mission that teleports the camera has lost them by the time
-- they work out where it went. The engine's own default is half of this, which
-- is a jump.
M.DEFAULT_PAN_SECONDS = 1

--- The x and z a `pos` names, or nothing when it names none.
local function point(pos)
	if type(pos) ~= "table" then
		return nil
	end
	local x, z = tonumber(pos.x), tonumber(pos.z)
	if not x or not z then
		return nil
	end
	return x, z
end

--- Whether a client should carry out an action aimed at `team`.
--
-- Read in the unsynced half, where every client runs the same code and only the
-- team it is watching tells them apart. EVERYONE is all of them. Anything else
-- is the one client on that engine team, which for a spectator is the team the
-- engine currently has them watching as.
function M.isFor(team, myTeam)
	return team == nil or team == M.EVERYONE or team == myTeam
end

--- Register the camera and marker actions on a trigger engine.
--
-- @param engine the trigger engine
-- @param state the published mission state, GG.CoilboxMission
-- @param hooks `pan(x, z, seconds, team)` and `mark(x, z, text, team)`, both
--   host-supplied, which is where SendToUnsynced lives
-- @return the handle, so a game's own actions point the player the same way
function M.register(engine, state, hooks)
	local view = {}

	-- Trigger params name a participant, not an engine team, and the mapping is
	-- fixed once the mission has started.
	local engineTeam = {}
	for _, team in ipairs(state.teams or {}) do
		engineTeam[team.id] = team.team
	end

	--- The engine team an action's `team` names, or EVERYONE when it names none.
	--
	-- A participant this mission has no engine team for is reported and treated
	-- as everyone. A camera move that reaches too many people is one the author
	-- can see going wrong; one that never happens looks like a trigger that
	-- never fired.
	local function audience(kind, participant)
		if participant == nil then
			return M.EVERYONE
		end
		local team = engineTeam[participant]
		if not team then
			engine:report(kind .. "-team:" .. tostring(participant), "warning",
				"no team named " .. tostring(participant)
					.. " in this mission, doing " .. kind .. " for everyone")
			return M.EVERYONE
		end
		return team
	end

	--- Move the camera to a place on the map, over `seconds`, for one engine team
	-- or for everyone. A negative time is read as no time at all, which is a cut
	-- rather than a pan.
	function view.pan(x, z, seconds, team)
		if not x or not z then
			return false
		end
		hooks.pan(x, z, math.max(tonumber(seconds) or M.DEFAULT_PAN_SECONDS, 0),
			team or M.EVERYONE)
		return true
	end

	--- Drop a labelled point on the map, for one engine team or for everyone.
	-- Text is optional: a marker with none is the plain dot a player gets from a
	-- click.
	function view.mark(x, z, text, team)
		if not x or not z then
			return false
		end
		hooks.mark(x, z, type(text) == "string" and text or "", team or M.EVERYONE)
		return true
	end

	--- The place an action names, or nothing once it has said what was wrong. A
	-- pan or a marker is its position: there is no sensible place to fall back to,
	-- and the compile step fills one in, so a missing one is a mission edited by
	-- hand.
	local function positionOf(kind, params)
		local x, z = point(params.pos)
		if not x then
			engine:report(kind .. "-pos", "warning",
				kind .. " was given no position on the map, ignoring it")
		end
		return x, z
	end

	engine:addAction("camera_pan", function(params)
		local x, z = positionOf("camera_pan", params)
		view.pan(x, z, params.seconds, audience("camera_pan", params.team))
	end)

	engine:addAction("map_marker", function(params)
		local x, z = positionOf("map_marker", params)
		view.mark(x, z, params.text, audience("map_marker", params.team))
	end)

	return view
end

return M
