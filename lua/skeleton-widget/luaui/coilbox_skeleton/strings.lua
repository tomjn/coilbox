-- What the skeleton widget says, one table per locale (issue #5179).
-- coilbox_i18n.lua picks the table, and a key a table lacks reads from `en`.

return {
	en = {
		-- The line the widget writes to the console when it loads. The %s are
		-- action names, which stay as they are: the first shows or hides the
		-- skeleton, the second the names of every piece.
		help = "Coilbox skeleton: /%s shows the bones of the selected units, /%s names every piece.",
		-- The three small buttons. Bones shows or hides the skeleton, Names labels every piece.
		bones = "Bones",
		names = "Names",
		-- Shows or hides the pieces outside a unit's plan, which are drawn dimmed.
		others = "Others",
	},
	["pt-BR"] = {
		help = "Esqueleto do Coilbox: /%s mostra os ossos das unidades selecionadas, /%s nomeia cada peça.",
		bones = "Ossos",
		names = "Nomes",
		others = "Outras",
	},
	nb = {
		help = "Coilbox-skjelett: /%s viser beina til de valgte enhetene, /%s navngir hver del.",
		bones = "Bein",
		names = "Navn",
		others = "Andre",
	},
	sv = {
		help = "Coilbox-skelett: /%s visar benen i de valda enheterna, /%s namnger varje del.",
		bones = "Ben",
		names = "Namn",
		others = "Övriga",
	},
	el = {
		help = "Σκελετός Coilbox: το /%s δείχνει τα οστά των επιλεγμένων μονάδων, το /%s ονομάζει κάθε κομμάτι.",
		bones = "Οστά",
		names = "Ονόματα",
		others = "Άλλα",
	},
	fr = {
		help = "Squelette Coilbox : /%s montre les os des unités sélectionnées, /%s nomme chaque pièce.",
		bones = "Os",
		names = "Noms",
		others = "Autres",
	},
	de = {
		help = "Coilbox-Skelett: /%s zeigt die Knochen der ausgewählten Einheiten, /%s benennt jedes Teil.",
		bones = "Knochen",
		names = "Namen",
		others = "Andere",
	},
	es = {
		help = "Esqueleto de Coilbox: /%s muestra los huesos de las unidades seleccionadas, /%s nombra cada pieza.",
		bones = "Huesos",
		names = "Nombres",
		others = "Otras",
	},
	ja = {
		help = "Coilbox スケルトン: /%s で選択中のユニットのボーンを表示し、/%s で全パーツの名前を表示します。",
		bones = "ボーン",
		names = "名前",
		others = "その他",
	},
	["zh-Hans"] = {
		help = "Coilbox 骨架：/%s 显示所选单位的骨骼，/%s 显示每个部件的名称。",
		bones = "骨骼",
		names = "名称",
		others = "其他",
	},
	pl = {
		help = "Szkielet Coilbox: /%s pokazuje kości zaznaczonych jednostek, /%s podpisuje każdą część.",
		bones = "Kości",
		names = "Nazwy",
		others = "Pozostałe",
	},
	uk = {
		help = "Скелет Coilbox: /%s показує кістки вибраних юнітів, /%s підписує кожну частину.",
		bones = "Кістки",
		names = "Назви",
		others = "Інші",
	},
	nl = {
		help = "Coilbox-skelet: /%s toont de botten van de geselecteerde eenheden, /%s benoemt elk onderdeel.",
		bones = "Botten",
		names = "Namen",
		others = "Overige",
	},
	it = {
		help = "Scheletro Coilbox: /%s mostra le ossa delle unità selezionate, /%s dà un nome a ogni pezzo.",
		bones = "Ossa",
		names = "Nomi",
		others = "Altri",
	},
}
