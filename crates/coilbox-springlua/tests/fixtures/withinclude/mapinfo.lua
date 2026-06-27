-- mapinfo that pulls its height range from a sibling file via VFS.Include.
-- The old literal scanner could not follow this; the evaluator can.
local extra = VFS.Include("sub/extra.lua")
return {
    name      = "With Include",
    voidWater = false,
    smf = {
        minHeight = extra.minh,
        maxHeight = extra.maxh,
    },
}
