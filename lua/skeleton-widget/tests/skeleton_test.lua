-- Run: luajit lua/skeleton-widget/tests/skeleton_test.lua
--
-- The skeleton from engine data: the bone end rule, the piece tree, the pose
-- and what gets drawn. src/lego/boneEnd.ts is the same rule and
-- src/lego/boneEnd.test.ts reads the `ends(...)` lines below (issue #5183), so
-- keep each case a plain box in and a point out on one line.

local support = dofile((arg[0]:match("^(.*)/[^/]+$") or ".") .. "/support.lua")
local check, same, show = support.check, support.same, support.show
local S = support.module("skeleton.lua")

--------------------------------------------------------------------------------
-- boneEnd: a box in, the far end out
--------------------------------------------------------------------------------

local function ends(name, min, max, want)
	local got = S.boneEnd(min, max)
	check(name, same(got, want), show(got))
end

ends("along +x", { 0, -1, -1 }, { 10, 1, 1 }, { 10, 0, 0 })
ends("along -x", { -10, -1, -1 }, { 0, 1, 1 }, { -10, 0, 0 })
ends("along +y", { -1, 0, -1 }, { 1, 10, 1 }, { 0, 10, 0 })
ends("along -y, a shin hanging from the knee", { -2, -20, -2 }, { 2, 0, 2 }, { 0, -20, 0 })
ends("along +z, a barrel from its pivot", { -1, -1, 0 }, { 1, 1, 30 }, { 0, 0, 30 })
ends("along -z", { -1, -1, -30 }, { 1, 1, 0 }, { 0, 0, -30 })
ends("the farther face when the box straddles the origin", { -4, -1, -1 }, { 10, 1, 1 }, { 10, 0, 0 })
ends("the farther face on the negative side", { -10, -1, -1 }, { 4, 1, 1 }, { -10, 0, 0 })
ends("the box's offset on the other axes is kept", { -1, 5, 0 }, { 1, 7, 30 }, { 0, 6, 30 })
ends("a box offset on two axes points at its face", { 4, 6, -1 }, { 24, 10, 1 }, { 24, 8, 0 })
ends("equal lengths: the axis reaching farther wins", { 0, -5, -5 }, { 10, 5, 5 }, { 10, 0, 0 })
ends("equal lengths and reach: z before y before x", { -5, -5, -5 }, { 5, 5, 5 }, { 0, 0, 5 })
ends("equal lengths and reach on x and y: y", { -5, -5, -1 }, { 5, 5, 1 }, { 0, 5, 0 })
ends("faces as far as each other: the positive one", { -1, -1, -8 }, { 1, 1, 8 }, { 0, 0, 8 })
ends("a box that is a point at the origin has no end", { 0, 0, 0 }, { 0, 0, 0 }, nil)

--------------------------------------------------------------------------------
-- boneStart: the other end of a piece that reaches both ways from its origin
--------------------------------------------------------------------------------

local function starts(name, min, max, want)
	local got = S.boneStart(min, max)
	check(name, same(got, want), show(got))
end

starts("a dish centred on its pivot reaches the other way too", { -1, -1, -8 }, { 1, 1, 8 }, { 0, 0, -8 })
starts("the nearer face when the box straddles the origin", { -4, -1, -1 }, { 10, 1, 1 }, { -4, 0, 0 })
starts("the nearer face on the positive side", { -10, -1, -1 }, { 4, 1, 1 }, { 4, 0, 0 })
starts("it keeps the box's offset on the other axes", { -1, 5, -10 }, { 1, 7, 30 }, { 0, 6, -10 })
starts("a piece that turns about one end has no other end", { -1, -1, 0 }, { 1, 1, 30 }, nil)
starts("nor one whose box lies wholly past the origin", { 4, 6, -1 }, { 24, 10, 1 }, nil)

--------------------------------------------------------------------------------
-- build: the tree from a fake piece map
--------------------------------------------------------------------------------

local INFO = {
	base = { parent = "[null]", isEmpty = false, min = { -10, 0, -10 }, max = { 10, 6, 12 } },
	turret = { parent = "base", isEmpty = false, min = { -4, 0, -4 }, max = { 4, 4, 4 } },
	barrel = { parent = "turret", isEmpty = false, min = { -1, -1, 0 }, max = { 1, 1, 20 } },
	-- an empty piece as the engine reports it: a box from 10000 to -10000
	flare = { parent = "barrel", isEmpty = true, min = { 10000, 10000, 10000 }, max = { -10000, -10000, -10000 } },
}
local NAMES = { "base", "turret", "barrel", "flare" }
local pieces = S.build(NAMES, function(i)
	return INFO[NAMES[i]]
end)

check("one piece per name", #pieces == 4, show(pieces))
check("the root has no parent", pieces[1].parent == nil, show(pieces[1]))
check("a child points at its parent by index", pieces[2].parent == 1 and pieces[3].parent == 2 and pieces[4].parent == 3, show(pieces))
check("a piece with geometry has a bone", same(pieces[3].bone, { 0, 0, 20 }), show(pieces[3].bone))
check("an empty piece has no bone", pieces[4].bone == nil, show(pieces[4]))
check("an empty piece is still in the tree as a joint", pieces[4].name == "flare" and pieces[4].parent == 3)
check("a piece knows how deep it is", pieces[1].depth == 0 and pieces[3].depth == 2 and pieces.deepest == 3, show(pieces[3]))
check("a piece centred on its origin has a second end", same(pieces[2].back, { 0, 2, -4 }), show(pieces[2].back))
check("a piece that turns about one end has none", pieces[3].back == nil, show(pieces[3].back))

--------------------------------------------------------------------------------
-- pose and pack
--------------------------------------------------------------------------------

local function translate(x, y, z)
	return { 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1 }
end

local MATRICES = { translate(0, 0, 0), translate(0, 6, 0), translate(0, 8, 2), translate(0, 8, 22) }
local pose = S.pose(pieces, function(i)
	return MATRICES[i]
end)
check("an origin is the matrix's translation", same(pose.origins[3], { 0, 8, 2 }), show(pose.origins[3]))
check("a bone end goes through the piece's matrix", same(pose.ends[3], { 0, 8, 22 }), show(pose.ends[3]))
check("an empty piece has an origin and no end", pose.origins[4] ~= nil and pose.ends[4] == nil)

local half = S.blend({ origins = { { 0, 0, 0 } }, ends = {} }, { origins = { { 10, 20, 30 } }, ends = {} }, 0.5)
check("a blend is part of the way between frames", same(half.origins[1], { 5, 10, 15 }), show(half.origins[1]))

-- One unit: four dots, three lines to a parent, three bones.
local reads = 0
local tracker = S.tracker({
	skeleton = function()
		reads = reads + 1
		return pieces
	end,
	matrix = function(_, i)
		return MATRICES[i]
	end,
	unitMatrix = function()
		return translate(100, 0, 200)
	end,
})

tracker.update({}, 1)
local verts, lines, dots = S.pack(tracker.world(0))
check("nothing drawn with no selection", #verts == 0 and lines == 0 and dots == 0, lines .. " " .. dots)
check("and no unit read", reads == 0)

tracker.update({ 7 }, 1)
local world = tracker.world(0)
verts, lines, dots = S.pack(world)
check("a selected unit is drawn", #world == 1 and world[1].unitID == 7)
check("its pose is moved into the world", same(world[1].origins[2], { 100, 6, 200 }), show(world[1].origins[2]))
-- base and turret reach both ways from origins their boxes lie to one side
-- of, so each is two halves and a link to its origin
check("three lines to a parent, a bone, two bones in halves and their links", lines == 10 * S.LINE_VERTICES, lines)
check("a bone is wider than a line to the parent", S.BONE_WIDTH > S.PARENT_WIDTH)
check("a bone narrows to its tip", S.BONE_TIP_WIDTH < S.BONE_WIDTH)

-- A line's two triangles share the diagonal from its first vertex to its
-- third. The fade across the line reads the corner's x, so those two must be
-- on opposite sides, or the fade cuts a see-through stripe along the diagonal.
local function corner(v)
	local at = (v - 1) * S.STRIDE
	return verts[at + 8], verts[at + 9]
end
local x1, y1 = corner(1)
local x3, y3 = corner(3)
check("a line's shared diagonal runs from one side to the other", x1 == -x3, x1 .. " " .. x3)
check("the far end is marked as the far end", y1 == 0 and y3 == 1, y1 .. " " .. y3)
check("the triangles share that diagonal", corner(4) == x1 and select(1, corner(5)) == x3)
check("a dot at every origin, empty ones too", dots == 4 * 6, dots)
check("every vertex has its numbers", #verts == (lines + dots) * S.STRIDE, #verts)
check("a bone is brighter than a line to the parent", S.BONE_ALPHA > S.PARENT_ALPHA)

tracker.update({ 7 }, 1)
tracker.update({ 7 }, 2)
check("a unit's skeleton is read once while it stays selected", reads == 1, reads)

-- Blending between frames: only from the frame just before.
local step = 0
local moving = S.tracker({
	skeleton = function()
		return { { name = "root" } }
	end,
	matrix = function()
		return translate(step, 0, 0)
	end,
	unitMatrix = function()
		return translate(0, 0, 0)
	end,
})
moving.update({ 1 }, 10)
step = 10
moving.update({ 1 }, 11)
check("half way between consecutive frames", moving.world(0.5)[1].origins[1][1] == 5, show(moving.world(0.5)[1].origins[1]))
step = 40
moving.update({ 1 }, 14)
check("after a skip of frames, this frame's pose alone", moving.world(0.5)[1].origins[1][1] == 40, show(moving.world(0.5)[1].origins[1]))
tracker.update({}, 3)
verts, lines, dots = S.pack(tracker.world(0))
check("nothing drawn once the selection is cleared", lines == 0 and dots == 0)

local unreadable = S.tracker({
	skeleton = function()
		return nil
	end,
	matrix = function() end,
	unitMatrix = function() end,
})
unreadable.update({ 9 }, 1)
check("a unit the engine will not describe draws nothing", #unreadable.world(0) == 0)

--------------------------------------------------------------------------------
-- nearest: the name shown under the cursor
--------------------------------------------------------------------------------

local marks = { { x = 10, y = 10, name = "a" }, { x = 30, y = 10, name = "b" } }
check("the nearest origin under the cursor", (S.nearest(marks, 27, 11, 8) or {}).name == "b")
check("nothing when the cursor is far from every origin", S.nearest(marks, 200, 200, 8) == nil)

--------------------------------------------------------------------------------
-- a body plan from coilbox's file (issue #5181)
--------------------------------------------------------------------------------

local function planned(evidence, ...)
	local named = {}
	for _, name in ipairs({ ... }) do
		named[name] = { bone = name .. "-bone", label = name:upper() }
	end
	return S.build(NAMES, function(i)
		return INFO[NAMES[i]]
	end, { evidence = evidence, pieces = named })
end

local function drawnPoses(unit)
	local t = S.tracker({
		skeleton = function()
			return unit
		end,
		matrix = function(_, i)
			return MATRICES[i]
		end,
		unitMatrix = function()
			return translate(0, 0, 0)
		end,
	})
	t.update({ 1 }, 1)
	return t.world(0)
end

--- The numbers a pack gave, as one table per vertex: alpha, dash
local function vertexList(out)
	local list = {}
	for at = 0, #out - S.STRIDE, S.STRIDE do
		list[#list + 1] = { alpha = out[at + 7], dash = out[at + 14], width = out[at + 13] }
	end
	return list
end

local plain = planned("built")
check("no plan is no evidence", plain.evidence == nil and plain[1].planned == nil)

local turretPlan = planned("fitted", "turret", "barrel")
check("a piece in the plan carries its bone and label", same(turretPlan[2].planned, { bone = "turret-bone", label = "TURRET" }), show(turretPlan[2].planned))
check("a piece outside the plan carries none", turretPlan[1].planned == nil and turretPlan[4].planned == nil)
check("the unit has the plan's evidence", turretPlan.evidence == "fitted")
check("names match whatever the case", S.build({ "Turret" }, function()
	return INFO.turret
end, { evidence = "built", pieces = { turret = { bone = "t", label = "T" } } })[1].planned ~= nil)

local stranger = planned("built", "no_such_piece")
check("a plan naming none of the pieces is as no plan", stranger.evidence == nil and stranger[1].planned == nil and stranger[2].planned == nil)

-- the planned unit: turret and barrel are the plan. base and flare are not.
local world = drawnPoses(turretPlan)
local all = vertexList(select(1, S.pack(world)))
local full, dim = 0, 0
for _, v in ipairs(all) do
	if v.alpha == S.PARENT_ALPHA or v.alpha == S.BONE_ALPHA or v.alpha == S.DOT_ALPHA then
		full = full + 1
	elseif v.alpha < S.PARENT_ALPHA then
		dim = dim + 1
	end
end
check("the pieces outside the plan are dimmed, the plan's in full", full > 0 and dim > 0, full .. " " .. dim)
local dimmest = S.DIM * S.DOT_ALPHA
local dimDots = 0
for _, v in ipairs(all) do
	if v.width == 0 and v.alpha == dimmest then
		dimDots = dimDots + 1
	end
end
check("a dimmed piece keeps a fraction of its opacity", dimDots == 2 * 6, dimDots)
check("a built or fitted plan is not dashed", (function()
	for _, v in ipairs(all) do
		if v.dash ~= 0 then
			return false
		end
	end
	return true
end)())

local hidden, hiddenLines, hiddenDots = S.pack(world, false)
check("hiding the others draws the plan's dots alone", hiddenDots == 2 * 6, hiddenDots)
check("hiding the others leaves no dimmed vertex", (function()
	for _, v in ipairs(vertexList(hidden)) do
		if v.alpha < S.PARENT_ALPHA then
			return false
		end
	end
	return true
end)())
-- turret's parent base is outside the plan, so with the others hidden its line
-- runs to nothing and is not drawn. Barrel's parent turret is in the plan, so
-- that is one line, and the two bones make three.
-- The turret reaches both ways, so it is two halves and a link.
check("a line to a parent outside the plan is dropped when the others are hidden", hiddenLines == 5 * S.LINE_VERTICES, hiddenLines)

local _, shownLines, shownDots = S.pack(world, true)
check("with the others shown every piece has its dot and every parent line", shownDots == 4 * 6 and shownLines == 10 * S.LINE_VERTICES, shownLines .. " " .. shownDots)

-- a bone with a piece outside the plan between it and the next bone
local chain = S.build({ "a", "b", "c" }, function(i)
	return { parent = ({ "[null]", "a", "b" })[i], isEmpty = true }
end, { evidence = "built", pieces = { a = { bone = "a", label = "A" }, c = { bone = "c", label = "C" } } })
check("with the others hidden a line reaches the nearest bone above", S.style(chain, 3, false).parent == 1, show(S.style(chain, 3, false)))
check("with the others shown it reaches the piece's own parent", S.style(chain, 3, true).parent == 2)
check("a piece outside the plan is not drawn while the others are hidden", S.style(chain, 2, false) == nil)

local observed = planned("observed", "turret", "barrel")
local dashed = vertexList(select(1, S.pack(drawnPoses(observed))))
local solid, broken = 0, 0
for _, v in ipairs(dashed) do
	if v.width > 0 and (v.alpha == S.BONE_ALPHA or v.alpha == S.PARENT_ALPHA) then
		if v.dash == 1 then
			solid = solid + 1
		else
			broken = broken + 1
		end
	end
end
check("an observed plan's bones and lines are dashed", solid > 0 and broken == 0, solid .. " " .. broken)
local dotDashes = 0
for _, v in ipairs(dashed) do
	if v.width == 0 and v.dash ~= 0 then
		dotDashes = dotDashes + 1
	end
end
check("a dot is never dashed", dotDashes == 0)

local solidOnly = vertexList(select(1, S.pack(drawnPoses(turretPlan))))
local anyDash = false
for _, v in ipairs(solidOnly) do
	anyDash = anyDash or v.dash == 1
end
check("a fitted plan is drawn solid", not anyDash)

local noPlan = vertexList(select(1, S.pack(drawnPoses(plain))))
local minAlpha = 1
for _, v in ipairs(noPlan) do
	minAlpha = math.min(minAlpha, v.alpha)
end
check("a unit with no entry draws every piece in full, whatever the toggle", minAlpha == S.PARENT_ALPHA and select(3, S.pack(drawnPoses(plain), false)) == 4 * 6)

--------------------------------------------------------------------------------
-- what tells one bone from another: taper, depth, movement, the cursor, size
--------------------------------------------------------------------------------

--- One table per vertex of a pack: colour, alpha, corner, width, grain
local function drawnVertices(out)
	local list = {}
	for at = 0, #out - S.STRIDE, S.STRIDE do
		list[#list + 1] = {
			colour = { out[at + 4], out[at + 5], out[at + 6] },
			alpha = out[at + 7],
			far = out[at + 9] == 1,
			width = out[at + 13],
			grain = out[at + 15],
		}
	end
	return list
end

local function luma(c)
	return c[1] + c[2] + c[3]
end

local plainWorld = drawnPoses(plain)
local taper = drawnVertices(select(1, S.pack(plainWorld)))
local wideOrigins, narrowTips, darkTips = 0, 0, 0
for at = 1, #taper, S.LINE_VERTICES do
	local a, b = taper[at], taper[at + 2]
	if a.width == S.BONE_WIDTH then
		wideOrigins = wideOrigins + 1
		if b.far and b.width == S.BONE_TIP_WIDTH then
			narrowTips = narrowTips + 1
		end
		if luma(b.colour) < luma(a.colour) then
			darkTips = darkTips + 1
		end
	end
end
check("every bone is wide at its origin and narrow at its tip", wideOrigins == 5 and narrowTips == 5, wideOrigins .. " " .. narrowTips)
check("and darker at its tip", darkTips == 5, darkTips)

-- The turret's box is 2 above its origin and reaches 4 each way along z, so
-- its bone runs straight from face to face through the point 2 above.
local packed = select(1, S.pack(plainWorld))
local turretAt = plainWorld[1].origins[2]
local halves, tips = 0, {}
for at = 0, #packed - S.STRIDE, S.LINE_VERTICES * S.STRIDE do
	local from = { packed[at + 1], packed[at + 2], packed[at + 3] }
	if packed[at + 13] == S.BONE_WIDTH and same(from, { turretAt[1], turretAt[2] + 2, turretAt[3] }) then
		halves = halves + 1
		tips[#tips + 1] = packed[at + 12] - turretAt[3]
	end
end
table.sort(tips)
check("a piece that reaches both ways is one straight bone past its origin", halves == 2 and same(tips, { -4, 4 }), halves .. " " .. show(tips))

-- The dots come last, six vertices each, in no fixed order of piece.
local dotColours = {}
for at = #taper - 4 * 6 + 1, #taper, 6 do
	dotColours[#dotColours + 1] = taper[at].colour
end
local function depthColour(depth)
	local t = depth / pieces.deepest
	return {
		S.COLOR[1] + (S.DEEP_COLOR[1] - S.COLOR[1]) * t,
		S.COLOR[2] + (S.DEEP_COLOR[2] - S.COLOR[2]) * t,
		S.COLOR[3] + (S.DEEP_COLOR[3] - S.COLOR[3]) * t,
	}
end
local rootDots, deepDots = 0, 0
for _, c in ipairs(dotColours) do
	if same(c, S.COLOR) then
		rootDots = rootDots + 1
	elseif same(c, S.DEEP_COLOR) then
		deepDots = deepDots + 1
	end
end
check("the root is the skeleton's colour and the deepest piece the deep one", rootDots == 1 and deepDots == 1, rootDots .. " " .. deepDots)
local stepped = {}
for _, c in ipairs(dotColours) do
	for depth = 1, 2 do
		if same(c, depthColour(depth)) then
			stepped[depth] = true
		end
	end
end
check("and each piece between them a step further towards it", stepped[1] and stepped[2], show(dotColours))

-- movement: the barrel turns against the turret, and the flare rides along
local function turnY(angle, x, y, z)
	local c, s = math.cos(angle), math.sin(angle)
	return { c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, x, y, z, 1 }
end
local barrelAngle = 0
local turning = S.tracker({
	skeleton = function()
		return pieces
	end,
	matrix = function(_, i)
		if i == 3 then
			return turnY(barrelAngle, 0, 8, 2)
		elseif i == 4 then
			-- the flare, 20 along the barrel's z
			local m = turnY(barrelAngle, 0, 8, 2)
			m[13], m[14], m[15] = S.apply(m, 0, 0, 20)
			return m
		end
		return MATRICES[i]
	end,
	unitMatrix = function()
		return translate(0, 0, 0)
	end,
	radius = function()
		return 50
	end,
})
turning.update({ 1 }, 1)
turning.update({ 1 }, 2)
check("a still unit has no moving piece", next(turning.world(0)[1].heat) == nil, show(turning.world(0)[1].heat))
barrelAngle = 0.3
turning.update({ 1 }, 3)
local heat = turning.world(0)[1].heat
check("a piece that turns against its parent is moving", heat[3] == 1, show(heat))
check("a piece carried by it, still against it, is not", heat[4] == nil and heat[2] == nil, show(heat))
local hot = drawnVertices(select(1, S.pack(turning.world(0))))
local widest = 0
for _, v in ipairs(hot) do
	widest = math.max(widest, v.width)
end
check("a moving bone is drawn wider", widest == S.BONE_WIDTH * (1 + S.HOT_WIDTH), widest)
local paler = 0
for _, v in ipairs(hot) do
	if v.width == widest and luma(v.colour) > luma(depthColour(pieces[3].depth)) then
		paler = paler + 1
	end
end
check("and paler", paler > 0, paler)
turning.update({ 1 }, 4)
local cooling = turning.world(0)[1].heat[3]
check("it fades once it stops", cooling > 0 and cooling < 1, cooling)
for frame = 5, 3 + S.FADE_FRAMES do
	turning.update({ 1 }, frame)
end
check("and is gone after the fade", turning.world(0)[1].heat[3] == nil)
check("the unit's radius sets its grain", turning.world(0)[1].grain == 50 / S.FULL_AT_RADIUS and hot[1].grain == 50 / S.FULL_AT_RADIUS, hot[1].grain)
check("with no radius there is no limit", taper[1].grain == 0, taper[1].grain)

-- the cursor: the piece under it and its way to the root stay in full
local pose1 = plainWorld[1]
local function at(piece, x, drawn)
	return { x = x, y = 10, pose = pose1, piece = piece, drawn = drawn }
end
local screen = { at(1, 10, true), at(2, 60, true), at(3, 110, true), at(4, 160, false) }
local focus = S.focus(screen, 111, 11, 8)
check("the cursor picks the piece under it", focus ~= nil and focus.piece == 3 and focus.pose == pose1)
check("and its way to the root", focus.chain[3] and focus.chain[2] and focus.chain[1] and not focus.chain[4], show(focus.chain))
check("nothing far from every piece", S.focus(screen, 500, 500, 8) == nil)
check("a piece that is not drawn is never picked", S.focus(screen, 160, 10, 8) == nil)
local focused = drawnVertices(select(1, S.pack(plainWorld, true, focus)))
local dimmedDots, fullDots = 0, 0
for _, v in ipairs(focused) do
	if v.width == 0 then
		if v.alpha == S.DOT_ALPHA then
			fullDots = fullDots + 1
		elseif v.alpha == S.DOT_ALPHA * S.FOCUS_DIM then
			dimmedDots = dimmedDots + 1
		end
	end
end
check("the pieces off that way are dimmed", fullDots == 3 * 6 and dimmedDots == 6, fullDots .. " " .. dimmedDots)
-- the flare has no bone, so its only line is the one to the barrel
local dimmedLines = 0
for _, v in ipairs(focused) do
	if v.width > 0 and v.alpha == S.PARENT_ALPHA * S.FOCUS_DIM then
		dimmedLines = dimmedLines + 1
	end
end
check("and so are their lines", dimmedLines == S.LINE_VERTICES, dimmedLines)

-- a piece outside a plan, and those between it and the root, are in full
-- while the cursor is on it
local turretWorld = drawnPoses(planned("built", "turret"))
local onBarrel = S.focus({ { x = 110, y = 10, pose = turretWorld[1], piece = 3, drawn = true } }, 110, 10, 8)
local unplannedDots = { full = 0, dimmed = 0 }
for _, v in ipairs(drawnVertices(select(1, S.pack(turretWorld, true, onBarrel)))) do
	if v.width == 0 then
		if v.alpha == S.DOT_ALPHA then
			unplannedDots.full = unplannedDots.full + 1
		elseif v.alpha == S.DOT_ALPHA * S.DIM * S.FOCUS_DIM then
			unplannedDots.dimmed = unplannedDots.dimmed + 1
		end
	end
end
check("a piece outside the plan is in full under the cursor", unplannedDots.full == 3 * 6 and unplannedDots.dimmed == 6, show(unplannedDots))

--------------------------------------------------------------------------------
-- names: role labels beside the plan's pieces
--------------------------------------------------------------------------------

local function mark(x, text, planned_, drawn)
	return { x = x, y = 10, text = text, planned = planned_, drawn = drawn }
end
local labelled = { mark(10, "Turret", true, true), mark(60, "base", false, true), mark(110, "flare", false, true), mark(160, "gone", false, false) }
local function texts(list)
	local out = {}
	for _, m in ipairs(list) do
		out[#out + 1] = m.text
	end
	return table.concat(out, ",")
end
check("a planned piece's label is always written", texts(S.names(labelled, false, 500, 500, 8)) == "Turret", texts(S.names(labelled, false, 500, 500, 8)))
check("the piece under the cursor is named as well", texts(S.names(labelled, false, 61, 11, 8)) == "Turret,base")
check("naming writes every drawn piece", texts(S.names(labelled, true, 500, 500, 8)) == "Turret,base,flare")
check("a piece that is not drawn is never named", not texts(S.names(labelled, true, 160, 10, 8)):find("gone"))

support.report()
