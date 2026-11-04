-- What the mission panels say that the scenario does not, one table per
-- locale (issue #4597). coilbox_i18n.lua picks the table, and a key a table
-- lacks reads from `en`.
--
-- Dialogue and objective text are the scenario author's words and stay out of
-- here.

return {
	en = {
		-- The panel's title.
		objectives = "Objectives",
		-- The heading over the objectives a player may skip.
		secondary = "Secondary",
		-- Under a line of dialogue that stays until it is clicked away.
		holdHint = "Click to continue",
		-- The debrief's headline.
		victory = "Mission accomplished",
		defeat = "Mission failed",
		undecided = "Mission ended",
	},
}
