-- What the blueprint widget says, one table per locale (issue #4597).
-- coilbox_i18n.lua picks the table, and a key a table lacks reads from `en`.

return {
	en = {
		-- The line the widget writes to the console when it loads. The %s are
		-- action names, which stay as they are: the first toggles the panel, and
		-- the rest turn, flip and pick layouts.
		help = "Coilbox blueprints: /%s toggles the panel. Bind keys to %s, %s, %s, %s, %s and %s to turn, flip and pick layouts.",
	},
	["pt-BR"] = {
		help = "Plantas do Coilbox: /%s mostra ou oculta o painel. Atribua teclas a %s, %s, %s, %s, %s e %s para girar, inverter e escolher layouts.",
	},
}
