-- What the rewind timeline says, one table per locale (issue #4597).
-- coilbox_i18n.lua picks the table, and a key a table lacks reads from `en`.

return {
	en = {
		-- What each action does, in the key list and the buttons' tooltips. The
		-- keys are the action ids in coilbox_timeline.lua.
		toggle = "Play or pause",
		reverse = "Play the other way",
		back = "Back 1 second",
		forward = "Forward 1 second",
		backLarge = "Back 10 seconds",
		forwardLarge = "Forward 10 seconds",
		frameBack = "Back one frame",
		frameForward = "Forward one frame",
		start = "Go to the start",
		finish = "Go to the end",
		markBack = "Go to the previous mark",
		markForward = "Go to the next mark",
		slower = "Slower",
		faster = "Faster",
		ghosts = "Show queued buildings",

		-- Key names, where the engine's own name is not what a player calls the
		-- key. Any other key shows as the engine names it, with a capital.
		keySpace = "Space",
		keyLeft = "Left",
		keyRight = "Right",
		keyHome = "Home",
		keyEnd = "End",
		keyComma = "Comma",
		keyFullStop = "Full stop",
		keyMinus = "Minus",
		-- A key held with Shift. %s is the key.
		withShift = "Shift+%s",
		-- Between two keys that do the same thing. %s and %s are the keys.
		eitherKey = "%s or %s",
		-- An action with no key bound to it.
		noKey = "No key",
		-- A button's tooltip. The first %s is what it does and the second its keys.
		tip = "%s (%s)",

		-- The key list's title, and the help button's tooltip.
		keys = "Keys",
		clickToChange = "Click a key to change it",
		pressAKey = "Press a key",
		resetKeys = "Reset keys",
	},
}
