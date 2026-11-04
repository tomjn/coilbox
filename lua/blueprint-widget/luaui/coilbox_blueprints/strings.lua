-- What the blueprint widget says, one table per locale (issue #4597).
-- coilbox_i18n.lua picks the table, and a key a table lacks reads from `en`.

return {
	en = {
		-- The line the widget writes to the console when it loads. The %s are
		-- action names, which stay as they are: the first toggles the panel, and
		-- the rest turn, flip and pick layouts.
		help = "Coilbox blueprints: /%s toggles the panel. Bind keys to %s, %s, %s, %s, %s and %s to turn, flip and pick layouts.",

		-- The panel (model.lua). A button is as wide as its label, so a longer
		-- translation makes a wider button. The names of units, blueprints and
		-- actions are not here: they stay as the game and the blueprint give them.
		-- A count that changes the wording has a `_one` and an `_other` form.
		title = "BLUEPRINTS",
		tabNow = "Now",
		tabPartly = "Partly",
		tabAll = "All",
		-- A tab: its name, then how many blueprints are under it.
		tabLabel = "%s %d",
		place = "Place",
		dismiss = "Dismiss",
		remainderLeft = "%d left to build",
		saveSelection = "Save selection",
		saveGround = "Save ground",
		emptyLibrary = "No blueprints for this game. Make one in coilbox, or save a selection.",
		emptyNoBuilder = "Select a builder to see what it can build.",
		emptyTab = "Nothing under this tab.",

		-- A blueprint's row, a line of facts divided by " | ".
		sourceSaved = "saved",
		fromAnotherSide = "%d from another side",
		toUpgrade = "%d to upgrade",
		noBuildings = "No buildings",
		buildings_one = "%d building",
		buildings_other = "%d buildings",
		terrainChanges_one = "%d terrain change",
		terrainChanges_other = "%d terrain changes",
		-- The number of buildings, then the number of terrain changes.
		buildingsAndTerrain = "%s, %s",
		rowOrdered = "ordered",
		-- The names of the buildings the game lacks.
		missing = "missing %s",
		-- Why a blueprint of terrain changes alone cannot be placed.
		stopNoTerraform = "no terraforming here",
		stopTerrainOff = "Terrain is off",

		-- The panel beside the main one while a blueprint is placed.
		cancel = "Cancel",
		-- The metal and energy, then the same with the time to build.
		costNoTime = "%d metal, %d energy",
		costWithTime = "%d metal, %d energy, %s to build",
		trayTurn = "Turn",
		trayFlip = "Flip",
		trayBuilders = "Builders",
		trayTerrain = "Terrain",
		-- What a turn or flip button says while no key is bound to it.
		keyLeft = "Left",
		keyRight = "Right",
		keyAcross = "Across",
		keyDown = "Down",
		together = "Together",
		splitUp = "Split up",
		on = "On",
		off = "Off",

		-- What the widget says in the panel's message line (the widget).
		-- A blueprint's name, then why it cannot be picked up.
		onlyGround = "%s only changes the ground: %s",
		foreignBuildings = "%s has buildings your side cannot build",
		nothingExists = "Nothing in %s exists in this game",
		-- A blueprint's name, then what placing it did.
		placeResult = "%s: %s",
		planned = "Planned: %s",
		cannotBuild = "The selected builders cannot build %s",
		planRemoved = "Plan removed",
		-- The name of the blueprint saved.
		savedEntry = "Saved %s. Coilbox picks it up next time it runs.",
		dragToSave = "Drag over the ground to save",
		saveGroundCancelled = "Save ground cancelled",
		saveGroundNeedsDrag = "Save ground needs a drag on the map",
		-- What placing did, joined with ", ".
		sentTo_one = "ordered to %d builder",
		sentTo_other = "ordered to %d builders",
		blocked = "%d blocked",
		-- The number of terrain changes left out, then the reason.
		skipped_one = "%d terrain change skipped (%s)",
		skipped_other = "%d terrain changes skipped (%s)",
		offMap_one = "%d terrain change off the map",
		offMap_other = "%d terrain changes off the map",
		leftForAnother = "%d left for another builder",
		leftPlanned = "%d planned, right click it with builders to build",
		nothingPlaced = "nothing could be placed",
		whyNoTerraform = "terraforming is not available here",
	},
	["pt-BR"] = {
		help = "Plantas do Coilbox: /%s mostra ou oculta o painel. Atribua teclas a %s, %s, %s, %s, %s e %s para girar, inverter e escolher layouts.",
	},
	nb = {
		help = "Coilbox-blåkopier: /%s viser eller skjuler panelet. Tilordne taster til %s, %s, %s, %s, %s og %s for å dreie, vende og velge oppsett.",
	},
	fr = {
		help = "Plans Coilbox : /%s affiche ou masque le panneau. Associez des touches à %s, %s, %s, %s, %s et %s pour tourner, retourner et choisir les dispositions.",
	},
	de = {
		help = "Coilbox-Baupläne: /%s blendet das Fenster ein oder aus. Belegen Sie Tasten mit %s, %s, %s, %s, %s und %s, um zu drehen, zu spiegeln und Layouts zu wählen.",
	},
	es = {
		help = "Planos de Coilbox: /%s muestra u oculta el panel. Asigna teclas a %s, %s, %s, %s, %s y %s para girar, voltear y elegir distribuciones.",
	},
	ja = {
		help = "Coilbox 設計図: /%s でパネルの表示を切り替えます。%s、%s、%s、%s、%s、%s にキーを割り当てると、回転、反転、レイアウトの選択ができます。",
	},
	["zh-Hans"] = {
		help = "Coilbox 蓝图：/%s 显示或隐藏面板。为 %s、%s、%s、%s、%s 和 %s 绑定按键，即可旋转、翻转和选择布局。",
	},
	pl = {
		help = "Plany budowy Coilbox: /%s pokazuje lub ukrywa panel. Przypisz klawisze do %s, %s, %s, %s, %s i %s, aby obracać, odwracać i wybierać układy.",
	},
	uk = {
		help = "Креслення Coilbox: /%s показує або приховує панель. Призначте клавіші для %s, %s, %s, %s, %s і %s, щоб повертати, перевертати й вибирати макети.",
	},
}
