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
	["pt-BR"] = {
		objectives = "Objetivos",
		secondary = "Secundários",
		holdHint = "Clique para continuar",
		victory = "Missão cumprida",
		defeat = "Missão fracassada",
		undecided = "Missão encerrada",
	},
	nb = {
		objectives = "Mål",
		secondary = "Sekundære",
		holdHint = "Klikk for å fortsette",
		victory = "Oppdrag fullført",
		defeat = "Oppdrag mislyktes",
		undecided = "Oppdrag avsluttet",
	},
	sv = {
		objectives = "Mål",
		secondary = "Sekundära",
		holdHint = "Klicka för att fortsätta",
		victory = "Uppdraget slutfört",
		defeat = "Uppdraget misslyckades",
		undecided = "Uppdraget avslutat",
	},
	fr = {
		objectives = "Objectifs",
		secondary = "Secondaires",
		holdHint = "Cliquez pour continuer",
		victory = "Mission accomplie",
		defeat = "Mission échouée",
		undecided = "Mission terminée",
	},
	de = {
		objectives = "Ziele",
		secondary = "Sekundär",
		holdHint = "Klicken zum Fortfahren",
		victory = "Mission erfüllt",
		defeat = "Mission gescheitert",
		undecided = "Mission beendet",
	},
	es = {
		objectives = "Objetivos",
		secondary = "Secundarios",
		holdHint = "Haz clic para continuar",
		victory = "Misión cumplida",
		defeat = "Misión fallida",
		undecided = "Misión terminada",
	},
	ja = {
		objectives = "目標",
		secondary = "サブ目標",
		holdHint = "クリックして続行",
		victory = "ミッション達成",
		defeat = "ミッション失敗",
		undecided = "ミッション終了",
	},
	["zh-Hans"] = {
		objectives = "目标",
		secondary = "次要目标",
		holdHint = "点击继续",
		victory = "任务完成",
		defeat = "任务失败",
		undecided = "任务结束",
	},
	pl = {
		objectives = "Cele",
		secondary = "Dodatkowe",
		holdHint = "Kliknij, aby kontynuować",
		victory = "Misja wykonana",
		defeat = "Misja nieudana",
		undecided = "Misja zakończona",
	},
	uk = {
		objectives = "Цілі",
		secondary = "Додаткові",
		holdHint = "Клацніть, щоб продовжити",
		victory = "Місію виконано",
		defeat = "Місію провалено",
		undecided = "Місію завершено",
	},
	nl = {
		objectives = "Doelen",
		secondary = "Secundair",
		holdHint = "Klik om verder te gaan",
		victory = "Missie voltooid",
		defeat = "Missie mislukt",
		undecided = "Missie beëindigd",
	},
	it = {
		objectives = "Obiettivi",
		secondary = "Secondari",
		holdHint = "Fai clic per continuare",
		victory = "Missione compiuta",
		defeat = "Missione fallita",
		undecided = "Missione terminata",
	},
}
