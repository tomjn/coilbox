-- The blueprint widget's files.
--
-- Three files feed the list the panel shows:
--
--   LuaUI/Config/coilbox_blueprints.json        coilbox writes, the widget reads
--   LuaUI/Config/coilbox_blueprints_spool.json  the widget writes, coilbox collects
--   LuaUI/Config/blueprints.json                BAR's own widget writes, the widget reads
--
-- The first and third are read through VFS, so they are found wherever the
-- engine's data dirs put them. The spool is written through io, which the
-- engine confines to the write dir, so it lands beside the engine and never in
-- the content root. Its name differs from the library's so it cannot shadow
-- the library in the raw search order.
--
-- Every entry the store hands out has the same shape whatever file it came
-- from: key, name, source, ordered, game (or nil), buildings and terrain, where
-- a building is { def, offset = { x, z }, facing }. Offsets are elmos from the
-- layout origin and facing is 0 south, 1 east, 2 north, 3 west.
--
-- terrain is the layout's changes to the ground, always a list and empty for a
-- layout with none. A step is { kind, shape, points = { { x, z } }, before,
-- height?, heights?, width? }, the same fields coilbox writes (TerrainStep in
-- src/blueprint/model.ts). before is how many buildings come ahead of the step,
-- so before == #buildings means after all of them. A layout may hold steps and
-- no buildings. BAR's file holds no terrain, so its entries have none.

local M = {}

M.LIBRARY_PATH = "LuaUI/Config/coilbox_blueprints.json"
M.SPOOL_PATH = "LuaUI/Config/coilbox_blueprints_spool.json"
M.BAR_PATH = "LuaUI/Config/blueprints.json"

--- Seconds between re-reads while the panel is open.
M.POLL_SECONDS = 5

local VERSION = 1

local json

--- Hand the store the JSON codec. VFS.Include cannot pass arguments, so the
-- widget calls this once after loading both modules.
function M.use(codec)
	json = codec
end

local function facingOf(value)
	if type(value) ~= "number" or value ~= value then
		return 0
	end
	return ((math.floor(value + 0.5) % 4) + 4) % 4
end

local function numberOr(value, fallback)
	if type(value) == "number" and value == value then
		return value
	end
	return fallback
end

--- One building from a library or spool entry, or nil when it has no def or
-- no offset.
local function building(raw)
	if type(raw) ~= "table" or type(raw.def) ~= "string" or type(raw.offset) ~= "table" then
		return nil
	end
	local x, z = raw.offset.x, raw.offset.z
	if type(x) ~= "number" or type(z) ~= "number" then
		return nil
	end
	return { def = raw.def, offset = { x = x, z = z }, facing = facingOf(raw.facing) }
end

local KINDS = { level = true, raise = true, ramp = true, smooth = true }
local SHAPES = { wall = true, area = true }

--- One terrain step, or nil when it is damaged. A step of a kind this widget
-- does not know, as a later coilbox may write, is dropped rather than guessed
-- at, and costs the layout nothing else.
-- @param raw any
-- @param buildings integer how many buildings the layout kept
local function step(raw, buildings)
	if type(raw) ~= "table" or not KINDS[raw.kind] or not SHAPES[raw.shape] or type(raw.points) ~= "table" then
		return nil
	end
	local points = {}
	for _, p in ipairs(raw.points) do
		if type(p) ~= "table" or type(p.x) ~= "number" or type(p.z) ~= "number" then
			return nil
		end
		points[#points + 1] = { x = p.x, z = p.z }
	end
	local least = (raw.kind == "ramp" or raw.shape == "wall") and 2 or 3
	if #points < least or (raw.kind == "ramp" and #points ~= 2) then
		return nil
	end
	if type(raw.before) ~= "number" or raw.before < 0 or raw.before ~= math.floor(raw.before) then
		return nil
	end
	local out = { kind = raw.kind, shape = raw.shape, points = points, before = math.min(raw.before, buildings) }
	if raw.kind == "level" or raw.kind == "raise" then
		if type(raw.height) ~= "number" then
			return nil
		end
		out.height = raw.height
	elseif raw.kind == "ramp" then
		local h = raw.heights
		if type(h) ~= "table" or type(h[1]) ~= "number" or type(h[2]) ~= "number" or type(raw.width) ~= "number" or raw.width <= 0 then
			return nil
		end
		out.heights = { h[1], h[2] }
		out.width = raw.width
	end
	-- anything but raise or lower reads as both ways
	if (raw.kind == "level" or raw.kind == "ramp") and (raw.only == "raise" or raw.only == "lower") then
		out.only = raw.only
	end
	return out
end

--- The steps of a library or spool entry that read, in order.
local function terrainOf(raw, buildings)
	local out = {}
	if type(raw.terrain) == "table" then
		for _, rawStep in ipairs(raw.terrain) do
			local s = step(rawStep, buildings)
			if s then
				out[#out + 1] = s
			end
		end
	end
	return out
end

local function gameOf(raw)
	if type(raw) ~= "table" then
		return nil
	end
	local game = {}
	if type(raw.name) == "string" then
		game.name = raw.name
	end
	if type(raw.shortname) == "string" then
		game.shortname = raw.shortname
	end
	if game.name == nil and game.shortname == nil then
		return nil
	end
	return game
end

--- Parse the shape the library and the spool share. Entries without a
-- buildings array are skipped, and buildings without an offset are dropped. An
-- entry with an empty buildings array is kept: it may hold terrain steps.
local function parseShared(text, source, keyOf)
	if text == nil then
		return {}
	end
	local doc, err = json.decode(text)
	if doc == nil then
		return nil, err or "not JSON"
	end
	if type(doc) ~= "table" then
		return nil, "not an object"
	end
	if doc.version ~= VERSION then
		return nil, "version " .. tostring(doc.version) .. " is not " .. VERSION
	end
	local entries = {}
	if type(doc.blueprints) ~= "table" then
		return entries
	end
	for index, raw in ipairs(doc.blueprints) do
		if type(raw) == "table" and type(raw.buildings) == "table" then
			local buildings = {}
			for _, rawBuilding in ipairs(raw.buildings) do
				local b = building(rawBuilding)
				if b then
					buildings[#buildings + 1] = b
				end
			end
			entries[#entries + 1] = {
				key = keyOf(raw, index),
				name = type(raw.name) == "string" and raw.name or ("#" .. index),
				source = source,
				ordered = raw.ordered == true,
				game = gameOf(raw.game),
				buildings = buildings,
				terrain = terrainOf(raw, #buildings),
			}
		end
	end
	return entries
end

--- Parse the library file coilbox writes.
-- @param text string? the file's text, nil when there is no file
-- @return table[]? entries, or nil and a message
function M.parseLibrary(text)
	return parseShared(text, "library", function(raw, index)
		return "library:" .. (type(raw.id) == "string" and raw.id or tostring(index))
	end)
end

--- Parse the spool the widget writes.
-- @param text string?
-- @return table[]? entries, or nil and a message
function M.parseSpool(text)
	return parseShared(text, "spool", function(_, index)
		return "spool:" .. index
	end)
end

--- A point turned `facing` quarter turns, the way BAR's api_blueprint.lua
-- rotates a layout: facing 1 sends (x, z) to (z, -x).
local function turned(x, z, facing)
	if facing == 1 then
		return z, -x
	elseif facing == 2 then
		return -x, -z
	elseif facing == 3 then
		return -z, x
	end
	return x, z
end

local function round(v)
	return math.floor(v + 0.5)
end

--- Parse BAR's blueprints.json. The file's own facing is applied to every
-- unit so the entry matches what BAR would place. Positions are read as
-- offsets from the layout's origin and the height is dropped.
-- @param text string?
-- @return table[]? entries, or nil and a message
function M.parseBar(text)
	if text == nil then
		return {}
	end
	local doc, err = json.decode(text)
	if doc == nil then
		return nil, err or "not JSON"
	end
	if type(doc) ~= "table" or type(doc.savedBlueprints) ~= "table" then
		-- BAR writes 0 rather than an empty array when nothing is saved.
		return {}
	end
	local entries = {}
	for index, raw in ipairs(doc.savedBlueprints) do
		if type(raw) == "table" and type(raw.units) == "table" then
			local facing = facingOf(raw.facing)
			local buildings = {}
			for _, unit in ipairs(raw.units) do
				if type(unit) == "table" and type(unit.unitName) == "string" and type(unit.position) == "table" then
					local x, z = turned(numberOr(unit.position[1], 0), numberOr(unit.position[3], 0), facing)
					buildings[#buildings + 1] = {
						def = unit.unitName,
						offset = { x = round(x), z = round(z) },
						facing = (facingOf(unit.facing) + facing) % 4,
					}
				end
			end
			local name = raw.name
			if type(name) ~= "string" or name:match("^%s*$") then
				name = "#" .. index
			end
			entries[#entries + 1] = {
				key = "bar:" .. index,
				name = name,
				source = "bar",
				ordered = raw.ordered == true,
				game = nil,
				buildings = buildings,
				terrain = {},
			}
		end
	end
	return entries
end

--------------------------------------------------------------------------------
-- the store
--------------------------------------------------------------------------------

local Store = {}
Store.__index = Store

local SOURCES = {
	{ name = "library", path = M.LIBRARY_PATH, parse = M.parseLibrary },
	{ name = "spool", path = M.SPOOL_PATH, parse = M.parseSpool },
	{ name = "bar", path = M.BAR_PATH, parse = M.parseBar },
}

--- Make a store.
-- @param deps table vfs (VFS), io (the engine's io, or nil for read only),
--   log (function(message))
function M.new(deps)
	local self = setmetatable({
		vfs = deps.vfs,
		io = deps.io,
		log = deps.log or function() end,
		lastPoll = nil,
		texts = {},
		parsed = {},
		failed = {},
		list = {},
	}, Store)
	for _, source in ipairs(SOURCES) do
		self.parsed[source.name] = {}
	end
	return self
end

--- The merged list: library, then spool, then BAR.
function Store:entries()
	return self.list
end

--- The entry with this key, or nil.
function Store:find(key)
	for _, entry in ipairs(self.list) do
		if entry.key == key then
			return entry
		end
	end
	return nil
end

function Store:rebuild()
	local list = {}
	for _, source in ipairs(SOURCES) do
		for _, entry in ipairs(self.parsed[source.name]) do
			list[#list + 1] = entry
		end
	end
	self.list = list
end

--- Take new text for one source. Returns true when the entries changed. An
-- unreadable file keeps the last good parse and is logged once per text.
function Store:take(source, text)
	if text == self.texts[source.name] then
		return false
	end
	self.texts[source.name] = text
	local entries, err = source.parse(text)
	if entries == nil then
		if self.failed[source.name] ~= text then
			self.failed[source.name] = text
			self.log(source.path .. ": " .. tostring(err))
		end
		return false
	end
	self.failed[source.name] = nil
	self.parsed[source.name] = entries
	return true
end

--- Re-read the files if POLL_SECONDS have passed since the last read.
-- @param now number seconds, any monotonic clock
-- @param force boolean? read now whatever the clock says
-- @return boolean true when the list changed
function Store:refresh(now, force)
	if not force and self.lastPoll ~= nil and now - self.lastPoll < M.POLL_SECONDS then
		return false
	end
	self.lastPoll = now
	local changed = false
	for _, source in ipairs(SOURCES) do
		local text = nil
		if self.vfs.FileExists(source.path, self.vfs.RAW) then
			text = self.vfs.LoadFile(source.path, self.vfs.RAW)
		end
		if self:take(source, text) then
			changed = true
		end
	end
	if changed then
		self:rebuild()
	end
	return changed
end

--- Read the spool as the write dir holds it, through io rather than VFS, so
-- the copy appended to is the one that will be written.
function Store:readSpoolText()
	local file = self.io.open(M.SPOOL_PATH, "r")
	if not file then
		return nil
	end
	local text = file:read("*a")
	file:close()
	return text
end

--- Append a recorded entry to the spool.
-- @param entry table name, game, designedFor, recordedAt, ordered, buildings,
--   footprints, and terrain when the layout has any
-- @return boolean ok, string? message
function Store:append(entry)
	if self.io == nil then
		return false, "this Lua state cannot write files"
	end
	local text = self:readSpoolText()
	local doc
	if text == nil or text:match("^%s*$") then
		doc = { version = VERSION, blueprints = {} }
	else
		local err
		doc, err = json.decode(text)
		if type(doc) ~= "table" or doc.version ~= VERSION then
			return false, M.SPOOL_PATH .. " is unreadable, not overwriting it: " .. tostring(err or "version " .. tostring(doc and doc.version))
		end
		if type(doc.blueprints) ~= "table" then
			doc.blueprints = {}
		end
	end
	doc.blueprints[#doc.blueprints + 1] = entry
	local out = json.encode(doc)
	local file, oerr = self.io.open(M.SPOOL_PATH, "w")
	if not file then
		return false, "cannot write " .. M.SPOOL_PATH .. ": " .. tostring(oerr)
	end
	file:write(out)
	file:close()
	if self:take(SOURCES[2], out) then
		self:rebuild()
	end
	return true
end

return M
