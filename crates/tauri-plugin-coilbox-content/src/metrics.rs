//! The match-statistics **metric registry**: what each decoded `TeamStatistics`
//! field is called, which group it belongs to, what it counts, and where it is
//! shown.
//!
//! The decoder ([`crate::demo::read_trailer`]) reads all 20 fields of a sample.
//! Nineteen of them are metrics. The twentieth, `frame`, is the x axis. This
//! module is the only place that says anything *about* those nineteen, and the
//! frontend reads it over `content_metric_registry` rather than carrying a list
//! of its own. The chart's dropdown, the sparkline grid, the roster columns and
//! the headline tiles are then four readings of one table, and adding a metric
//! is a line here.
//!
//! Four metrics are decoded but offered nowhere: units given, taken and captured
//! either way are zero in almost every match and confusing in the rest, so they
//! carry [`HIDDEN`]. They stay decoded because the day somebody wants a gifting
//! chart for a team game, that has to be a flag change and not a decoder change.

use serde::Serialize;

/// Which question a metric answers. The chart's dropdown and the sparkline grid
/// are grouped by this.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MetricGroup {
    /// Resources made, spent, wasted and traded.
    Economy,
    /// Damage and kills, which is what a team did to somebody else.
    Military,
    /// Counts of a team's own units: built, lost, given away, captured.
    Units,
}

/// What a metric's numbers are, so a surface can format them without knowing
/// which metric it is holding. Metal and energy are separate because a chart
/// that mixes them is a chart of two different things.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum MetricUnit {
    Metal,
    Energy,
    Damage,
    /// A whole number of units.
    Count,
}

/// One metric: a decoded field, named and placed.
#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Metric {
    /// The `TeamStatSample` field this reads, in the JSON spelling the frontend
    /// receives (`metalProduced`). This is the metric's identity everywhere.
    pub key: &'static str,
    /// What to call it in the interface.
    pub label: &'static str,
    pub group: MetricGroup,
    pub unit: MetricUnit,
    /// Show it as a column on the match's roster table.
    pub roster: bool,
    /// Show it as a headline tile above the chart, summed across teams.
    pub headline: bool,
    /// False for a metric that is decoded but offered nowhere.
    pub surfaced: bool,
}

/// Offered in the chart and the sparkline grid, and nowhere else.
const CHART: u8 = 0;
/// Also a column on the roster table.
const ROSTER: u8 = 1;
/// Also a headline tile.
const HEADLINE: u8 = 2;
/// Decoded, but shown nowhere.
const HIDDEN: u8 = 4;

const fn metric(
    key: &'static str,
    label: &'static str,
    group: MetricGroup,
    unit: MetricUnit,
    flags: u8,
) -> Metric {
    Metric {
        key,
        label,
        group,
        unit,
        roster: flags & ROSTER != 0,
        headline: flags & HEADLINE != 0,
        surfaced: flags & HIDDEN == 0,
    }
}

use MetricGroup::{Economy, Military, Units};
use MetricUnit::{Count, Damage, Energy, Metal};

/// Every metric, in the order the engine writes the fields.
///
/// The roster set is deliberately six columns wide, because the table already
/// carries a name, a faction, a rating and an actions-per-minute figure, and in
/// a 16-player match every extra column costs a scroll. The six are the two
/// economy totals players argue about, the damage pair (which separates the side
/// that attacked from the side that was attacked), and what each seat built and
/// destroyed. Everything else is one click away in the sparkline grid.
///
/// The two headline figures are damage dealt and units built, summed across
/// teams: the size of the fight, and the size of the game.
pub const METRICS: &[Metric] = &[
    metric("metalUsed", "Metal used", Economy, Metal, CHART),
    metric("energyUsed", "Energy used", Economy, Energy, CHART),
    metric("metalProduced", "Metal produced", Economy, Metal, ROSTER),
    metric("energyProduced", "Energy produced", Economy, Energy, ROSTER),
    metric("metalExcess", "Metal excess", Economy, Metal, CHART),
    metric("energyExcess", "Energy excess", Economy, Energy, CHART),
    metric("metalReceived", "Metal received", Economy, Metal, CHART),
    metric("energyReceived", "Energy received", Economy, Energy, CHART),
    metric("metalSent", "Metal sent", Economy, Metal, CHART),
    metric("energySent", "Energy sent", Economy, Energy, CHART),
    metric(
        "damageDealt",
        "Damage dealt",
        Military,
        Damage,
        ROSTER | HEADLINE,
    ),
    metric(
        "damageReceived",
        "Damage received",
        Military,
        Damage,
        ROSTER,
    ),
    metric(
        "unitsProduced",
        "Units built",
        Units,
        Count,
        ROSTER | HEADLINE,
    ),
    metric("unitsDied", "Units lost", Units, Count, CHART),
    metric("unitsReceived", "Units received", Units, Count, HIDDEN),
    metric("unitsSent", "Units given away", Units, Count, HIDDEN),
    metric("unitsCaptured", "Units captured", Units, Count, HIDDEN),
    metric(
        "unitsOutCaptured",
        "Units lost to capture",
        Units,
        Count,
        HIDDEN,
    ),
    metric("unitsKilled", "Units killed", Military, Count, ROSTER),
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::TeamStatSample;
    use std::collections::BTreeSet;

    /// The field a sample is plotted *against*, which is not a metric.
    const X_AXIS: &str = "frame";

    /// What the decoder actually produces, taken from a serialized sample, so
    /// this is the list the frontend receives rather than a second opinion about
    /// it.
    fn decoded_fields() -> BTreeSet<String> {
        let json = serde_json::to_value(TeamStatSample::default()).expect("sample serializes");
        let obj = json.as_object().expect("a sample is an object");
        obj.keys().cloned().collect()
    }

    fn keys() -> BTreeSet<String> {
        METRICS.iter().map(|m| m.key.to_string()).collect()
    }

    fn find(key: &str) -> &'static Metric {
        METRICS
            .iter()
            .find(|m| m.key == key)
            .unwrap_or_else(|| panic!("no metric {key}"))
    }

    /// Both directions at once. A field the decoder gained and nobody named, and
    /// a registry entry naming a field that does not exist, are the two ways this
    /// table rots.
    #[test]
    fn the_registry_names_every_decoded_field_and_nothing_else() {
        let mut expected = decoded_fields();
        assert_eq!(expected.len(), 20, "TeamStatistics is 20 fields");
        assert!(expected.remove(X_AXIS), "a sample carries its frame");
        assert_eq!(keys(), expected);
    }

    #[test]
    fn every_metric_appears_once() {
        assert_eq!(keys().len(), METRICS.len());
    }

    #[test]
    fn every_metric_is_labelled_distinctly() {
        let labels: BTreeSet<&str> = METRICS.iter().map(|m| m.label).collect();
        assert_eq!(labels.len(), METRICS.len(), "two metrics share a label");
        for m in METRICS {
            assert!(!m.label.is_empty(), "{} has no label", m.key);
        }
    }

    /// A metal figure measured in energy, or a damage figure filed under
    /// economy, is the kind of mistake a dropdown shows and nobody notices.
    #[test]
    fn a_metrics_unit_and_group_follow_what_it_counts() {
        for m in METRICS {
            let (unit, group) = if m.key.starts_with("metal") {
                (Metal, Economy)
            } else if m.key.starts_with("energy") {
                (Energy, Economy)
            } else if m.key.starts_with("damage") {
                (Damage, Military)
            } else {
                (Count, m.group)
            };
            assert_eq!(m.unit, unit, "{} is measured in the wrong thing", m.key);
            assert_eq!(m.group, group, "{} is in the wrong group", m.key);
        }
    }

    /// Killing somebody else's units is military. Everything that happens to a
    /// team's own units is the units group.
    #[test]
    fn a_unit_count_is_military_only_when_it_is_somebody_elses_loss() {
        for m in METRICS.iter().filter(|m| m.unit == Count) {
            let expected = if m.key == "unitsKilled" {
                Military
            } else {
                Units
            };
            assert_eq!(m.group, expected, "{} is in the wrong group", m.key);
        }
    }

    #[test]
    fn the_headline_tiles_are_the_size_of_the_fight_and_the_size_of_the_game() {
        let headline: Vec<&str> = METRICS
            .iter()
            .filter(|m| m.headline)
            .map(|m| m.key)
            .collect();
        assert_eq!(headline, ["damageDealt", "unitsProduced"]);
    }

    #[test]
    fn the_roster_carries_six_columns() {
        let roster: Vec<&str> = METRICS.iter().filter(|m| m.roster).map(|m| m.key).collect();
        assert_eq!(
            roster,
            [
                "metalProduced",
                "energyProduced",
                "damageDealt",
                "damageReceived",
                "unitsProduced",
                "unitsKilled",
            ]
        );
    }

    #[test]
    fn the_four_gifting_counts_are_decoded_and_offered_nowhere() {
        let hidden: Vec<&str> = METRICS
            .iter()
            .filter(|m| !m.surfaced)
            .map(|m| m.key)
            .collect();
        assert_eq!(
            hidden,
            [
                "unitsReceived",
                "unitsSent",
                "unitsCaptured",
                "unitsOutCaptured",
            ]
        );
        // Still decoded. The flag hides them, the decoder does not drop them.
        for key in hidden {
            assert!(decoded_fields().contains(key), "{key} is not decoded");
        }
    }

    /// A tile or a column showing a metric the registry calls hidden would be a
    /// contradiction the frontend has to resolve, so it cannot arise.
    #[test]
    fn nothing_hidden_is_on_the_roster_or_a_headline() {
        for m in METRICS.iter().filter(|m| !m.surfaced) {
            assert!(!m.roster && !m.headline, "{} is hidden and shown", m.key);
        }
    }

    /// The headline tiles sit above a roster that repeats them, which is the
    /// point. The tile is the total, the column is who made it.
    #[test]
    fn every_headline_is_also_a_roster_column() {
        for m in METRICS.iter().filter(|m| m.headline) {
            assert!(m.roster, "{} is a headline but not a column", m.key);
        }
    }

    /// The registry is published as JSON and the frontend reads these exact
    /// spellings, so a rename that stays inside Rust would be invisible.
    #[test]
    fn the_published_shape_is_the_one_the_frontend_reads() {
        let json = serde_json::to_value(find("damageDealt")).expect("a metric serializes");
        assert_eq!(
            json,
            serde_json::json!({
                "key": "damageDealt",
                "label": "Damage dealt",
                "group": "military",
                "unit": "damage",
                "roster": true,
                "headline": true,
                "surfaced": true,
            })
        );
        let groups: BTreeSet<String> = METRICS
            .iter()
            .map(|m| {
                serde_json::to_value(m.group)
                    .expect("a group serializes")
                    .to_string()
            })
            .collect();
        assert_eq!(
            groups,
            BTreeSet::from([
                "\"economy\"".to_string(),
                "\"military\"".to_string(),
                "\"units\"".to_string(),
            ])
        );
        let units: BTreeSet<String> = METRICS
            .iter()
            .map(|m| {
                serde_json::to_value(m.unit)
                    .expect("a unit serializes")
                    .to_string()
            })
            .collect();
        assert_eq!(
            units,
            BTreeSet::from([
                "\"count\"".to_string(),
                "\"damage\"".to_string(),
                "\"energy\"".to_string(),
                "\"metal\"".to_string(),
            ])
        );
    }
}
