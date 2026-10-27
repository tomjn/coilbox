-- The synced half of the Zero-K terraform fixture match.
--
-- It creates one constructor for each case the probe widget tries, in a row of
-- lanes across the middle of the map, keeps the team's storage full so cost
-- never slows a case down, and reports what happens as FIXTURE lines in the
-- engine's log: terraform units appearing and finishing, the turret going up,
-- each builder's queue, and at the end the ground across each lane.

function gadget:GetInfo()
	return {
		name = "Coilbox Zero-K terraform fixture",
		desc = "Creates builders for the terraform probe and reports what they do",
		author = "coilbox",
		date = "2026",
		license = "MIT or GNU GPL, v2 or later",
		layer = 2000,
		enabled = true,
	}
end

local CASES = 19
-- The case whose builder Zero-K's gadget stops checking. Zero-K v1.14.10.3's
-- unit_terraform.lua moves the last constructor into a dead one's slot without
-- telling it its new index (UnitDestroyed). When that one dies too, it moves the
-- one before it past the end of the list, and the gadget never looks at that
-- builder's queue again, so nothing keeps its queued terraform alive.
local UNCHECKED_CASE = 19
local SPARES_DIE_FRAME = 33
-- Cases with more than one builder, which share the terraform and the turret.
local BUILDERS = { [10] = 2, [13] = 2 }
-- Lanes run east to west along the middle of the map, side by side, this far
-- apart.
local LANE_GAP = 512
local BUILDER_OFFSET = -192
local CREATE_FRAME = 30
local REPORT_EVERY = 300
local END_FRAME = tonumber((Spring.GetModOptions() or {}).coilbox_end_frame) or 9000
local TEAM = 0

local function lane(index)
	local cx = 16 * math.floor(Game.mapSizeX / 32) + (index - (CASES + 1) / 2) * LANE_GAP
	local cz = 16 * math.floor(Game.mapSizeZ / 32)
	return 16 * math.floor(cx / 16), cz
end

-- The save ground matches have a fixture of their own.
function gadget:Initialize()
	if ((Spring.GetModOptions() or {}).coilbox_mode or ""):sub(1, 6) == "ground" then
		gadgetHandler:RemoveGadget(self)
	end
end

if gadgetHandler:IsSyncedCode() then
	local builders = {}
	local caseOfBuilder = {}
	local terraunitDefID = UnitDefNames.terraunit.id
	local turretDefID = UnitDefNames.turretlaser.id
	local heavyDefID = UnitDefNames.turretheavylaser.id
	local spares = {}

	-- A constructor that belongs to no case, there to be killed.
	local function spare(x, z)
		local unitID = Spring.CreateUnit("cloakcon", x, Spring.GetGroundHeight(x, z), z, "east", TEAM)
		spares[#spares + 1] = unitID
		Spring.Echo(string.format("FIXTURE spare id=%s", tostring(unitID)))
	end

	local function caseAt(x, z)
		local best, bestDistance
		for i = 1, CASES do
			local lx, lz = lane(i)
			local distance = math.abs(x - lx)
			if not bestDistance or distance < bestDistance then
				best, bestDistance = i, distance
			end
		end
		return best
	end
	-- terraform units wait a couple of frames before their estimate is read, since
	-- Zero-K sets it just after they are created
	local pendingEstimate = {}

	-- The widget's model of the ground (issue #4797). The probe widget sends each
	-- blueprint it orders, laid as the widget's placing code laid it. The model
	-- is worked out from the heightmap as it is then, before any of the
	-- terraform has been built, and compared with the ground near the end.
	local TERRAFORM = VFS.Include("LuaUI/coilbox_blueprints/terraform.lua", nil, VFS.RAW_FIRST)
	local predicted = {}

	function gadget:RecvLuaMsg(msg)
		local case, body = msg:match("^coilbox_model (%d+) (.*)$")
		if not case then
			return
		end
		local data = loadstring("return " .. body)()
		local env = {
			heightAt = Spring.GetGroundHeight,
			corners = { x = Game.mapSizeX / 8 + 1, z = Game.mapSizeZ / 8 + 1 },
			structures = {},
			costMult = tonumber((Spring.GetModOptions() or {}).terracostmult) or 1,
		}
		local session = TERRAFORM.session(env)
		session.apply(data.steps, data.foot)
		predicted[tonumber(case)] = session.changed()
		Spring.Echo(string.format("FIXTURE model case=%s metal=%.4f work=%.4f changed=%d", case, session.metal, session.work, #predicted[tonumber(case)]))
	end

	-- Every corner the model changes against the game's ground, and every corner
	-- in a box round them that the model leaves alone.
	local function compare(case, list)
		local byRow = {}
		local minX, maxX, minZ, maxZ = math.huge, -math.huge, math.huge, -math.huge
		local worst, bad = 0, 0
		for _, c in ipairs(list) do
			local row = byRow[c.z] or {}
			byRow[c.z] = row
			row[c.x] = true
			minX, maxX, minZ, maxZ = math.min(minX, c.x), math.max(maxX, c.x), math.min(minZ, c.z), math.max(maxZ, c.z)
			local game = Spring.GetGroundHeight(c.x, c.z)
			local err = math.abs(game - c.h)
			worst = math.max(worst, err)
			if err > 0.05 then
				bad = bad + 1
				if bad <= 60 then
					Spring.Echo(string.format("FIXTURE off case=%d x=%d z=%d model=%.3f game=%.3f orig=%.3f", case, c.x, c.z, c.h, game, Spring.GetGroundOrigHeight(c.x, c.z)))
				end
			end
		end
		local extra = 0
		for x = minX - 24, maxX + 24, 8 do
			for z = minZ - 24, maxZ + 24, 8 do
				if not (byRow[z] and byRow[z][x]) and math.abs(Spring.GetGroundHeight(x, z) - Spring.GetGroundOrigHeight(x, z)) > 0.05 then
					extra = extra + 1
				end
			end
		end
		Spring.Echo(string.format("FIXTURE compare case=%d changed=%d worst=%.4f off=%d unexpected=%d", case, #list, worst, bad, extra))
	end

	local function queue(unitID)
		local commands = Spring.GetUnitCommands(unitID, -1) or {}
		local parts = {}
		for i = 1, #commands do
			parts[#parts + 1] = tostring(commands[i].id)
		end
		return table.concat(parts, ",")
	end

	function gadget:UnitCreated(unitID, unitDefID, teamID, builderID)
		if unitDefID == terraunitDefID then
			pendingEstimate[unitID] = Spring.GetGameFrame() + 2
		end
		if unitDefID == terraunitDefID or unitDefID == turretDefID then
			local x, y, z = Spring.GetUnitPosition(unitID)
			Spring.Echo(string.format("FIXTURE created case=%d frame=%d unit=%s id=%d x=%.1f y=%.1f z=%.1f",
				caseAt(x, z), Spring.GetGameFrame(), UnitDefs[unitDefID].name, unitID, x, y, z))
		end
	end

	function gadget:UnitFinished(unitID, unitDefID)
		if unitDefID == heavyDefID then
			local x, _, z = Spring.GetUnitPosition(unitID)
			Spring.Echo(string.format("FIXTURE finished case=%d frame=%d unit=turretheavylaser id=%d", caseAt(x, z), Spring.GetGameFrame(), unitID))
		end
		if unitDefID == turretDefID then
			local x, y, z = Spring.GetUnitPosition(unitID)
			Spring.Echo(string.format("FIXTURE finished case=%d frame=%d unit=turretlaser id=%d x=%.1f y=%.1f z=%.1f ground=%.1f orig=%.1f",
				caseAt(x, z), Spring.GetGameFrame(), unitID, x, y, z,
				Spring.GetGroundHeight(x, z), Spring.GetGroundOrigHeight(x, z)))
		end
	end

	function gadget:UnitDestroyed(unitID, unitDefID)
		if unitDefID == terraunitDefID then
			local x, y, z = Spring.GetUnitPosition(unitID)
			Spring.Echo(string.format("FIXTURE terraunit-gone case=%d frame=%d id=%d health=%.3f estimate=%.4f spent=%.4f",
				caseAt(x, z), Spring.GetGameFrame(), unitID, select(5, Spring.GetUnitHealth(unitID)) or -1,
				Spring.GetUnitRulesParam(unitID, "terraform_estimate") or -1,
				Spring.GetUnitRulesParam(unitID, "terraform_spent") or -1))
		end
	end

	local function profile(i)
		local cx, cz = lane(i)
		-- Across the wall, west of the turret so the turret's footprint does
		-- not count.
		local parts = {}
		for dz = -96, 96, 8 do
			local x, z = cx - 40, cz + dz
			parts[#parts + 1] = string.format("%d:%.1f", dz, Spring.GetGroundHeight(x, z) - Spring.GetGroundOrigHeight(x, z))
		end
		Spring.Echo(string.format("FIXTURE profile-z case=%d frame=%d %s", i, Spring.GetGameFrame(), table.concat(parts, " ")))
		parts = {}
		-- Along the wall and past its ends.
		for dx = -240, 240, 8 do
			local x, z = cx + dx, cz
			parts[#parts + 1] = string.format("%d:%.1f", dx, Spring.GetGroundHeight(x, z) - Spring.GetGroundOrigHeight(x, z))
		end
		Spring.Echo(string.format("FIXTURE profile-x case=%d frame=%d %s", i, Spring.GetGameFrame(), table.concat(parts, " ")))
	end

	function gadget:GameFrame(frame)
		if frame == 1 then
			local t, b = UnitDefs[terraunitDefID], UnitDefNames.cloakcon
			Spring.Echo(string.format("FIXTURE defs terraunit metalCost=%s buildTime=%s health=%s builder buildSpeed=%s",
				tostring(t.metalCost), tostring(t.buildTime), tostring(t.health), tostring(b.buildSpeed)))
		end
		for unitID, due in pairs(pendingEstimate) do
			if frame >= due then
				pendingEstimate[unitID] = nil
				if Spring.ValidUnitID(unitID) then
					local x, _, z = Spring.GetUnitPosition(unitID)
					Spring.Echo(string.format("FIXTURE terraunit-estimate case=%d frame=%d id=%d estimate=%.4f",
						caseAt(x, z), frame, unitID, Spring.GetUnitRulesParam(unitID, "terraform_estimate") or -1))
				end
			end
		end
		-- Two solar collectors beside the fourth lane's wall, for a windowed run
		-- that shows a slope stopping short of a building. The scripted matches
		-- leave this off.
		if frame == CREATE_FRAME + 1 and (Spring.GetModOptions() or {}).coilbox_blockers == "1" then
			local cx, cz = lane(4)
			for _, dx in ipairs({ -48, 48 }) do
				Spring.CreateUnit("energysolar", cx + dx, Spring.GetGroundHeight(cx + dx, cz + 64), cz + 64, "south", TEAM)
			end
		end
		if frame == CREATE_FRAME then
			local mx, mz = lane(1)
			spare(mx - 256, mz - 256)
			for i = 1, CASES do
				local cx, cz = lane(i)
				local lo, hi = math.huge, -math.huge
				for dx = -200, 200, 8 do
					for dz = -96, 96, 8 do
						local h = Spring.GetGroundOrigHeight(cx + dx, cz + dz)
						lo, hi = math.min(lo, h), math.max(hi, h)
					end
				end
				for n = 1, BUILDERS[i] or 1 do
					local bx, bz = cx + BUILDER_OFFSET, cz + (n - 1) * 48
					local unitID = Spring.CreateUnit("cloakcon", bx, Spring.GetGroundHeight(bx, bz), bz, "east", TEAM)
					builders[#builders + 1] = unitID
					caseOfBuilder[unitID] = i
					Spring.SetUnitRulesParam(unitID, "coilbox_case", i)
					Spring.SetUnitRulesParam(unitID, "coilbox_lane_x", cx)
					Spring.SetUnitRulesParam(unitID, "coilbox_lane_z", cz)
					Spring.Echo(string.format("FIXTURE builder case=%d id=%s lane=%d,%d ground=%.1f..%.1f",
						i, tostring(unitID), cx, cz, lo, hi))
				end
				if i == UNCHECKED_CASE then
					-- straight after the case's builder, so it is the last constructor
					spare(cx - 256, cz - 256)
				end
			end
		end
		if frame == SPARES_DIE_FRAME then
			for _, unitID in ipairs(spares) do
				Spring.DestroyUnit(unitID, false, true)
			end
		end
		if frame % 30 == 0 then
			Spring.SetTeamResource(TEAM, "ms", 100000)
			Spring.SetTeamResource(TEAM, "es", 100000)
			Spring.SetTeamResource(TEAM, "m", 100000)
			Spring.SetTeamResource(TEAM, "e", 100000)
		end
		if frame > CREATE_FRAME and (frame % REPORT_EVERY == 0 or frame == 90 or frame == 120) then
			for _, unitID in ipairs(builders) do
				if Spring.ValidUnitID(unitID) then
					Spring.Echo(string.format("FIXTURE queue case=%d frame=%d unit=%d %s", caseOfBuilder[unitID], frame, unitID, queue(unitID)))
				end
			end
		end
		if frame == END_FRAME then
			for case, list in pairs(predicted) do
				-- the turret's own levelling is the engine's, not the model's
				if case ~= 11 then
					compare(case, list)
				end
			end
			for i = 1, CASES do
				profile(i)
			end
			Spring.Echo("FIXTURE done " .. frame)
			Spring.GameOver({ 0 })
		end
	end
else
	local started = Spring.GetTimer()

	function gadget:Update()
		if Spring.GetGameFrame() >= END_FRAME + 45 or Spring.DiffTimers(Spring.GetTimer(), started) > 900 then
			Spring.SendCommands("quitforce")
		end
	end
end
