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
-- Pure. No engine calls and no globals beyond the Lua standard library: the
-- ground height, the camera and the marker are all the host's, and arrive
-- through its hooks.

local M = {}

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

--- Register the camera and marker actions on a trigger engine.
--
-- @param engine the trigger engine
-- @param state the published mission state, GG.CoilboxMission
-- @param hooks `pan(x, z, seconds)` and `mark(x, z, text)`, both host-supplied,
--   which is where SendToUnsynced lives
-- @return the handle, so a game's own actions point the player the same way
function M.register(engine, state, hooks)
	local view = {}

	--- Move the camera to a place on the map, over `seconds`. A negative time is
	-- read as no time at all, which is a cut rather than a pan.
	function view.pan(x, z, seconds)
		if not x or not z then
			return false
		end
		hooks.pan(x, z, math.max(tonumber(seconds) or M.DEFAULT_PAN_SECONDS, 0))
		return true
	end

	--- Drop a labelled point on the map. Text is optional: a marker with none is
	-- the plain dot a player gets from a click.
	function view.mark(x, z, text)
		if not x or not z then
			return false
		end
		hooks.mark(x, z, type(text) == "string" and text or "")
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
		view.pan(x, z, params.seconds)
	end)

	engine:addAction("map_marker", function(params)
		local x, z = positionOf("map_marker", params)
		view.mark(x, z, params.text)
	end)

	return view
end

return M
