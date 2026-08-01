-- Coilbox mission runtime: the condition and action types a game adds itself.
--
-- A game that has systems coilbox has never heard of -- research points, a
-- weather model, a faction chooser -- declares condition and action types for
-- them in missions/extensions.lua and implements them in a file of its own. This
-- module reads the declaration, loads that file, and registers what the two
-- agree on with the trigger engine. From then on a trigger naming one of those
-- types is dispatched to the game's code like any other.
--
-- The declaration is data and the handler is code, so they are read the way the
-- gadget reads each: the declaration in an empty environment, the handler in one
-- that reaches the engine. The handler's is `hooks.env()`, a table of the game's
-- own that falls through to the gadget's environment, so the game's code can
-- read GG and call the engine and a global it sets does not land in the
-- runtime's.
--
-- Two rules decide what is registered, and both are here rather than in the
-- handler, so a game cannot opt out of either.
--
-- 1. An extension adds a game concept, never an engine one. A declaration naming
--    a type the coilbox runtime's own marker declares is refused, whichever of
--    the two lists it is in. Everything engine-level -- spawns, orders, zones,
--    sight, restrictions, game over, camera, markers, rules params -- stays in
--    the generic runtime.
-- 2. What runs is what the editor can edit. The handler may implement only types
--    the declaration lists, because the declaration is the file coilbox reads to
--    build its palette, and a type the editor cannot offer is a type nobody can
--    author.
--
-- No engine calls. Everything it touches arrives through the hooks, so the
-- dispatch is provable with plain luajit.

local M = {}

--- The declaration, relative to the game archive's root.
M.DECLARATION = "missions/extensions.lua"

--- The type names the coilbox runtime owns, from the marker it reads out of the
-- game. Both lists in one set: a name is one thing, and a game reusing a
-- condition's name for an action is the same confusion by a longer route.
local function reserved(runtime)
	local names = {}
	for _, list in ipairs({ (runtime or {}).conditions, (runtime or {}).actions }) do
		for _, name in ipairs(list or {}) do
			names[name] = true
		end
	end
	return names
end

--- One declared type, or nil and why not.
local function declaredType(entry, taken, owned)
	if type(entry) ~= "table" then
		return nil, "an entry that is not a table"
	end
	local name = entry.type
	if type(name) ~= "string" or name == "" then
		return nil, "an entry with no type name"
	end
	if owned[name] then
		return nil, name .. " is the runtime's own type, which an extension may not redefine"
	end
	if taken[name] then
		return nil, name .. " is declared twice"
	end
	return name
end

--- Register everything missions/extensions.lua and the game's handler agree on.
--
-- `hooks.has(path)` says whether the archive holds a file, `hooks.load(path,
-- env)` evaluates one and returns the table it built or nil and why not,
-- `hooks.env()` is the environment the game's own code runs in, and
-- `hooks.log(level, message)` reports. A game with no declaration registers
-- nothing and says nothing: that is nearly every game.
--
-- Returns the type names registered, which the gadget publishes so a game's own
-- Lua can see what the runtime took.
function M.register(engine, state, hooks)
	local taken = {}
	local registered = { conditions = {}, actions = {} }

	if not hooks.has(M.DECLARATION) then
		return registered
	end

	local declaration, err = hooks.load(M.DECLARATION, {})
	if not declaration then
		hooks.log("error", err)
		return registered
	end

	local handlerPath = declaration.handler
	if type(handlerPath) ~= "string" or handlerPath == "" then
		hooks.log("error", M.DECLARATION .. " names no handler, so nothing it declares can run")
		return registered
	end
	if not hooks.has(handlerPath) then
		hooks.log("error", M.DECLARATION .. " names a handler this game has no " .. handlerPath)
		return registered
	end
	local handler, handlerErr = hooks.load(handlerPath, hooks.env())
	if not handler then
		hooks.log("error", handlerErr)
		return registered
	end

	-- Trigger parameters name a team the way the scenario's author does. Turning
	-- that into an engine team number is the one piece of the runtime's own
	-- bookkeeping an extension cannot do without, so it is put on the context
	-- every condition and action is handed rather than left to be rediscovered.
	local engineTeam = {}
	for _, team in ipairs(state.teams or {}) do
		engineTeam[team.id] = team.team
	end
	engine.ctx.teamOf = function(name)
		return engineTeam[name]
	end

	local owned = reserved(state.runtime)

	for _, list in ipairs({ "conditions", "actions" }) do
		local implemented = handler[list] or {}
		for _, entry in ipairs(declaration[list] or {}) do
			local name, why = declaredType(entry, taken, owned)
			-- Refused or not, a name the declaration mentions has been answered
			-- for, so the check below does not answer for it a second time.
			if type(entry) == "table" and type(entry.type) == "string" then
				taken[entry.type] = true
			end
			if not name then
				hooks.log("error", "ignoring " .. why .. " in " .. M.DECLARATION)
			else
				local implementation = implemented[name]
				if list == "conditions" then
					if type(implementation) ~= "table" or type(implementation.test) ~= "function" then
						hooks.log("warning", handlerPath .. " has no test for condition " .. name
							.. ", so a trigger using it will never hold")
					else
						engine:addCondition(name, implementation)
						registered.conditions[#registered.conditions + 1] = name
					end
				else
					if type(implementation) ~= "function" then
						hooks.log("warning", handlerPath .. " has no function for action " .. name
							.. ", so a trigger using it will do nothing")
					else
						engine:addAction(name, implementation)
						registered.actions[#registered.actions + 1] = name
					end
				end
			end
		end
	end

	-- An implementation nothing declared is the mistake this rule exists to
	-- catch: it would otherwise be a type the game can run, the editor cannot
	-- offer, and nobody can tell apart from a typo.
	for _, list in ipairs({ "conditions", "actions" }) do
		for name in pairs(handler[list] or {}) do
			if not taken[name] then
				hooks.log("warning", handlerPath .. " implements " .. tostring(name)
					.. ", which " .. M.DECLARATION .. " does not declare, so it is not registered")
			end
		end
	end

	hooks.log("notice", string.format(
		"%s registered %d conditions and %d actions from %s",
		M.DECLARATION, #registered.conditions, #registered.actions, handlerPath))
	return registered
end

return M
