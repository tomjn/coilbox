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
