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
	["pt-BR"] = {
		toggle = "Reproduzir ou pausar",
		reverse = "Reproduzir no outro sentido",
		back = "Voltar 1 segundo",
		forward = "Avançar 1 segundo",
		backLarge = "Voltar 10 segundos",
		forwardLarge = "Avançar 10 segundos",
		frameBack = "Voltar um frame",
		frameForward = "Avançar um frame",
		start = "Ir para o início",
		finish = "Ir para o fim",
		markBack = "Ir para a marca anterior",
		markForward = "Ir para a próxima marca",
		slower = "Mais devagar",
		faster = "Mais rápido",
		ghosts = "Mostrar construções na fila",

		-- Home and End keep the names printed on Brazilian keyboards.
		keySpace = "Espaço",
		keyLeft = "Esquerda",
		keyRight = "Direita",
		keyHome = "Home",
		keyEnd = "End",
		keyComma = "Vírgula",
		keyFullStop = "Ponto",
		keyMinus = "Menos",
		withShift = "Shift+%s",
		eitherKey = "%s ou %s",
		noKey = "Sem tecla",
		tip = "%s (%s)",

		keys = "Teclas",
		clickToChange = "Clique em uma tecla para alterá-la",
		pressAKey = "Pressione uma tecla",
		resetKeys = "Redefinir teclas",
	},
	nb = {
		toggle = "Spill av eller pause",
		reverse = "Spill av baklengs",
		back = "Tilbake 1 sekund",
		forward = "Fram 1 sekund",
		backLarge = "Tilbake 10 sekunder",
		forwardLarge = "Fram 10 sekunder",
		frameBack = "Én frame tilbake",
		frameForward = "Én frame fram",
		start = "Gå til starten",
		finish = "Gå til slutten",
		markBack = "Gå til forrige merke",
		markForward = "Gå til neste merke",
		slower = "Saktere",
		faster = "Raskere",
		ghosts = "Vis bygninger i kø",

		-- Home and End keep the names printed on Norwegian keyboards.
		keySpace = "Mellomrom",
		keyLeft = "Venstre",
		keyRight = "Høyre",
		keyHome = "Home",
		keyEnd = "End",
		keyComma = "Komma",
		keyFullStop = "Punktum",
		keyMinus = "Minus",
		withShift = "Shift+%s",
		eitherKey = "%s eller %s",
		noKey = "Ingen tast",
		tip = "%s (%s)",

		keys = "Taster",
		clickToChange = "Klikk på en tast for å endre den",
		pressAKey = "Trykk på en tast",
		resetKeys = "Tilbakestill taster",
	},
}
