//! Where the metal is: turning a map's density grid into the spots a player
//! builds extractors on (issue #1734).
//!
//! Every other catalog fact is a value read out of the archive, so two clients
//! reading one map cannot disagree. This one is a choice about what counts as a
//! spot, and two different choices produce two different answers from identical
//! input. That is safe under the hub's conflict rule on one condition, which is
//! why the numbers below are read from `shared/map-catalog.json` and never
//! written here: changing what a spot is has to be a change to that file and to
//! its `catalogVersion`, or every honest client starts looking like it is
//! reporting different facts and the symptom is a flood of conflicts rather than
//! an obvious bug.
//!
//! ## What the density grid is
//!
//! One byte a sample, 0 to 255, on the map's metal infomap, which is 16 elmos to
//! a sample. What an extractor pulls out of one sample is the map's own
//! `maxMetal` times that byte, which is `CMetalMap::GetMetalAmount`, and what it
//! pulls out of an area is the sum over the samples it covers, which is
//! `CExtractorBuilding::ReCalculateMetalExtraction`. A game's own
//! `extractsMetal` multiplier is the last step and is deliberately not applied:
//! it belongs to the unit rather than to the map, and a map fact that moved with
//! whichever game read it would be no fact at all.
//!
//! ## How a spot is found
//!
//! Peaks, not blobs. The richest sample above the floor is a spot's centre, and
//! everything within the agreed separation is claimed by it, so a second peak
//! has to stand clear of the first. A connected-components pass would answer a
//! smeared map with one enormous spot covering half the ground, which is not
//! what anybody means by a spot and not something an extractor can stand on.
//!
//! A peak also has to stand above the ground it claims, which is the parameter
//! this issue added. Without it a map whose metal is smeared rather than placed
//! answers with a spot every ninety six elmos in every direction: SmallDivide
//! came out at 1,117 of them and Full Metal Plate at 14,206. Measured over this
//! machine's 101 maps, the rule changes nothing at all on maps whose metal is
//! placed in discrete blobs and takes SmallDivide to 200.
//!
//! ## What it means for a map that is metal everywhere
//!
//! Three of those 101 maps have one density across every sample of the grid:
//! Full Metal Plate at 79, Hex Farm 8 at 255 and SevenIslandsMini at 26. They
//! have no spots, in the plain sense that no place on them is better than any
//! other, so they report none. That is honest and it is also a gap: the catalog
//! has no fact for "metallic everywhere", so those maps read like maps with no
//! metal at all. Worth a fact of its own rather than a made up list of evenly
//! spaced points.

use coilbox_map_catalog::{MapPoint, MetalClustering};
use serde_json::json;
use std::collections::BTreeMap;

/// The width of one density sample in elmos, which is what turns a grid position
/// into a coordinate. Read from the asset vocabulary, where the overlay drawing
/// the same grid already reads it, rather than restated.
fn elmos_per_sample() -> f64 {
    let (across, _) = coilbox_assets::map_extent_elmos(1, 1);
    f64::from(across)
}

/// Full scale for one density sample. The infomap is one byte a sample, so a
/// share of full scale is a share of this.
const FULL_SCALE: f64 = 255.0;

/// One spot, before it becomes a point.
#[derive(Debug, Clone, PartialEq)]
pub struct MetalSpot {
    /// Where the extractor goes, in elmos: the density weighted centre of what
    /// the spot claimed, not the peak sample, so a spot spread over four samples
    /// sits between them rather than on the corner that happened to be highest.
    pub x: f64,
    pub z: f64,
    /// What an extractor covering the whole spot pulls out of it, which is
    /// `maxMetal` times the sum of the density it claimed.
    pub amount: f64,
    /// How far the claimed samples reach from the centre, in elmos. Measured
    /// rather than the separation restated, so a one sample spot and a spot
    /// spread over a hundred elmos are told apart.
    pub radius: f64,
}

/// Find the metal spots in a density grid.
///
/// `density` is the metal infomap, row major, `width` by `height` samples.
/// `max_metal` is the map's own, which is what a density byte is worth.
/// `rules` come from the shared catalog document.
///
/// The answer is ordered richest first, with position breaking a tie, so two
/// runs over one map produce the same list in the same order and the hub's
/// digest over it does not move for no reason.
pub fn find(
    density: &[u8],
    width: u32,
    height: u32,
    max_metal: f64,
    rules: &MetalClustering,
) -> Vec<MetalSpot> {
    let (w, h) = (width as usize, height as usize);
    if density.len() != w * h || w == 0 || h == 0 || max_metal <= 0.0 {
        return Vec::new();
    }
    let per_sample = elmos_per_sample();

    // A sample has to reach this to be metal at all. A map with a flat trace of
    // density everywhere therefore produces nothing rather than one spot the
    // size of the map.
    let floor = rules.min_density_share * FULL_SCALE;

    // Candidates richest first, and by position within a tie, so the walk below
    // is the same walk on every machine whatever the sort's stability.
    let mut candidates: Vec<usize> = (0..density.len())
        .filter(|&at| f64::from(density[at]) >= floor && density[at] > 0)
        .collect();
    candidates.sort_by(|&a, &b| density[b].cmp(&density[a]).then(a.cmp(&b)));

    let separation_samples = (rules.min_separation_elmos / per_sample).max(0.0);
    let reach = separation_samples.ceil() as isize;
    let mut claimed = vec![false; density.len()];
    let mut spots = Vec::new();

    // How far above its surroundings a peak has to stand. Without it a map whose
    // metal is smeared across the ground answers with a spot every separation in
    // every direction, which is thousands of places to build rather than a list
    // of spots.
    let prominence = rules.min_prominence_share * FULL_SCALE;

    for &peak in &candidates {
        if claimed[peak] {
            continue;
        }
        let (px, pz) = ((peak % w) as isize, (peak / w) as isize);
        let mut total = 0.0f64;
        let mut sum_x = 0.0f64;
        let mut sum_z = 0.0f64;
        let mut furthest = 0.0f64;
        let mut lowest = f64::from(density[peak]);
        let mut area: Vec<(usize, f64, f64)> = Vec::new();

        for dz in -reach..=reach {
            for dx in -reach..=reach {
                let (x, z) = (px + dx, pz + dz);
                if x < 0 || z < 0 || x >= w as isize || z >= h as isize {
                    continue;
                }
                // Round rather than square, so "how far apart two centres are"
                // means the same thing in every direction.
                let away = ((dx * dx + dz * dz) as f64).sqrt();
                if away > separation_samples {
                    continue;
                }
                let at = z as usize * w + x as usize;
                // The ground the peak stands on is all of it, claimed or not and
                // below the floor or not. What it stands above is what makes it
                // a peak.
                lowest = lowest.min(f64::from(density[at]));
                if claimed[at] || f64::from(density[at]) < floor || density[at] == 0 {
                    continue;
                }
                area.push((at, away, f64::from(density[at])));
            }
        }

        // A peak level with everything around it is a place on a plateau rather
        // than a spot, and it is left unclaimed so a real peak further along can
        // still take these samples.
        if f64::from(density[peak]) - lowest < prominence {
            continue;
        }

        for (at, away, value) in area {
            claimed[at] = true;
            let (x, z) = ((at % w) as f64, (at / w) as f64);
            total += value;
            sum_x += value * (x + 0.5) * per_sample;
            sum_z += value * (z + 0.5) * per_sample;
            furthest = furthest.max(away * per_sample);
        }

        if total <= 0.0 {
            continue;
        }
        let amount = total * max_metal;
        if amount < rules.min_spot_metal {
            continue;
        }
        spots.push(MetalSpot {
            x: sum_x / total,
            z: sum_z / total,
            amount,
            // A spot of one sample still covers that sample, so it is half a
            // sample across rather than a point with no size.
            radius: furthest.max(per_sample / 2.0),
        });
    }

    spots.sort_by(|a, b| {
        b.amount
            .partial_cmp(&a.amount)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(a.x.partial_cmp(&b.x).unwrap_or(std::cmp::Ordering::Equal))
            .then(a.z.partial_cmp(&b.z).unwrap_or(std::cmp::Ordering::Equal))
    });
    spots
}

/// The spots as the points the hub stores under `metal`, carrying the amount and
/// the radius its `meta` requires.
pub fn points(spots: &[MetalSpot]) -> Vec<MapPoint> {
    spots
        .iter()
        .map(|spot| MapPoint {
            x: spot.x as f32,
            z: spot.z as f32,
            y: None,
            meta: BTreeMap::from([
                ("amount".to_string(), json!(round_to(spot.amount, 3))),
                ("radius".to_string(), json!(round_to(spot.radius, 1))),
            ]),
        })
        .collect()
}

/// Round a measurement to a few places.
///
/// Not cosmetic. These two numbers go into the hub's digest over an entry, so a
/// last-bit difference between two machines would read as two clients reporting
/// different facts about one map. The sum and the divide are the only floating
/// point in the answer, and rounding the result puts the agreement well inside
/// what either can vary by.
fn round_to(value: f64, places: u32) -> f64 {
    let scale = 10f64.powi(places as i32);
    (value * scale).round() / scale
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rules() -> MetalClustering {
        coilbox_map_catalog::catalog().metal_clustering
    }

    /// A grid with a single rich sample at `(x, z)`.
    fn one_spot(w: usize, h: usize, x: usize, z: usize, value: u8) -> Vec<u8> {
        let mut grid = vec![0u8; w * h];
        grid[z * w + x] = value;
        grid
    }

    /// The ordinary case: three lumps of metal, well apart, are three spots.
    #[test]
    fn a_map_with_three_lumps_has_three_spots() {
        let (w, h) = (32usize, 32usize);
        let mut grid = vec![0u8; w * h];
        for (x, z) in [(4usize, 4usize), (16, 16), (28, 6)] {
            for dz in 0..2 {
                for dx in 0..2 {
                    grid[(z + dz) * w + (x + dx)] = 200;
                }
            }
        }
        let spots = find(&grid, w as u32, h as u32, 1.0, &rules());
        assert_eq!(spots.len(), 3);
        // Four samples of 200 at maxMetal 1.0.
        assert!((spots[0].amount - 800.0).abs() < 1e-9, "{:?}", spots[0]);
    }

    /// The test the threshold exists for. A map with a trace of density
    /// everywhere is not one enormous spot.
    #[test]
    fn a_flat_map_has_no_spots_rather_than_one_enormous_one() {
        let (w, h) = (64usize, 64usize);
        assert!(find(&vec![0u8; w * h], w as u32, h as u32, 1.0, &rules()).is_empty());
        // Two of 255, which is under the 2% floor, everywhere.
        assert!(find(&vec![2u8; w * h], w as u32, h as u32, 1.0, &rules()).is_empty());
    }

    /// A rich map with structure is a lot of spots rather than one, which is
    /// what makes peaks the right shape for this and connected blobs the wrong
    /// one.
    #[test]
    fn a_map_with_metal_all_over_it_is_many_spots() {
        let (w, h) = (64usize, 64usize);
        // Peaks on a low background, every eight samples, which is further
        // apart than the separation.
        let mut grid = vec![10u8; w * h];
        for z in (4..h).step_by(8) {
            for x in (4..w).step_by(8) {
                grid[z * w + x] = 255;
            }
        }
        let spots = find(&grid, w as u32, h as u32, 1.0, &rules());
        assert!(spots.len() > 20, "{} spots", spots.len());
        // And none of them claims the whole map: the separation is 96 elmos, so
        // a spot reaches at most that far from its centre.
        assert!(spots.iter().all(|spot| spot.radius <= 96.0));
    }

    /// A field of metal at one density has no spots in it, because no place on
    /// it is better than any other. Three of this machine's maps are exactly
    /// that: Full Metal Plate at 79 everywhere, Hex Farm 8 at 255 and
    /// SevenIslandsMini at 26.
    ///
    /// Reporting a spot every ninety six elmos across such a map would be
    /// fourteen thousand made up points, and reporting the truth costs
    /// something: the entry then says nothing about the metal at all, which is
    /// the gap the module doc names.
    #[test]
    fn a_field_of_metal_at_one_density_has_no_spots_in_it() {
        let (w, h) = (64usize, 64usize);
        for level in [26u8, 79, 255] {
            let spots = find(&vec![level; w * h], w as u32, h as u32, 1.0, &rules());
            assert!(spots.is_empty(), "{level}: {} spots", spots.len());
        }
    }

    /// The rule that does it: a peak level with its surroundings is a place on a
    /// slope rather than a spot, however rich the ground under it is.
    #[test]
    fn a_peak_that_stands_above_nothing_is_not_a_spot() {
        let (w, h) = (32usize, 32usize);
        // 200 on a background of 170, which is 30 of 255 and under the fifth
        // the rules ask for.
        let mut shallow = vec![170u8; w * h];
        shallow[16 * w + 16] = 200;
        assert!(find(&shallow, w as u32, h as u32, 1.0, &rules()).is_empty());

        // The same peak on a background of 100 stands 100 above it and is a
        // spot.
        let mut clear = vec![100u8; w * h];
        clear[16 * w + 16] = 200;
        assert_eq!(find(&clear, w as u32, h as u32, 1.0, &rules()).len(), 1);
    }

    /// Two samples closer than the agreed separation are one spot, and the same
    /// two further apart are two.
    #[test]
    fn the_separation_decides_how_many_spots_two_lumps_are() {
        let (w, h) = (32usize, 32usize);
        let per = elmos_per_sample() as usize;
        let apart = rules().min_separation_elmos as usize / per;

        let mut close = vec![0u8; w * h];
        close[10 * w + 10] = 200;
        close[10 * w + 10 + (apart - 1)] = 180;
        assert_eq!(find(&close, w as u32, h as u32, 1.0, &rules()).len(), 1);

        let mut far = vec![0u8; w * h];
        far[10 * w + 10] = 200;
        far[10 * w + 10 + apart + 1] = 180;
        assert_eq!(find(&far, w as u32, h as u32, 1.0, &rules()).len(), 2);
    }

    /// A spot worth less than the agreed minimum is noise rather than a spot.
    ///
    /// It takes a map declaring almost no metal to reach that, which is the
    /// point made in the shared document: `amount` is the sum of the density
    /// under the spot times the map's own `maxMetal`, so on a map with a normal
    /// one it is in the hundreds and this floor never fires.
    #[test]
    fn a_spot_below_the_minimum_is_not_reported() {
        let grid = one_spot(32, 32, 5, 5, 200);
        // maxMetal of 0.002 makes those 200 worth 0.4, under the 0.5 floor.
        assert!(find(&grid, 32, 32, 0.002, &rules()).is_empty());
        // The same sample on a map that declares real metal is a spot.
        assert_eq!(find(&grid, 32, 32, 1.0, &rules()).len(), 1);
    }

    /// The centre is where an extractor goes, so it sits in the middle of the
    /// metal rather than on the corner sample that happened to be highest.
    #[test]
    fn the_centre_is_the_middle_of_what_the_spot_claimed() {
        let (w, h) = (32usize, 32usize);
        let per = elmos_per_sample();
        let mut grid = vec![0u8; w * h];
        grid[10 * w + 10] = 100;
        grid[10 * w + 11] = 100;
        // Two samples of 100 in an empty field, so the pair stands well clear of
        // the ground around it.
        let spots = find(&grid, w as u32, h as u32, 1.0, &rules());
        assert_eq!(spots.len(), 1);
        // Halfway between sample 10 and sample 11.
        assert!((spots[0].x - 11.0 * per).abs() < 1e-6, "{:?}", spots[0]);
        assert!((spots[0].z - 10.5 * per).abs() < 1e-6, "{:?}", spots[0]);
    }

    /// The hub compares a digest over the points, so the same grid has to give
    /// the same spots in the same order every time.
    #[test]
    fn the_same_grid_gives_the_same_spots_in_the_same_order() {
        let (w, h) = (48usize, 48usize);
        let grid: Vec<u8> = (0..w * h).map(|i| ((i * 37) % 256) as u8).collect();
        let once = find(&grid, w as u32, h as u32, 1.0, &rules());
        let twice = find(&grid, w as u32, h as u32, 1.0, &rules());
        assert_eq!(once, twice);
        assert!(once.len() > 1);
        // Richest first.
        assert!(once.windows(2).all(|pair| pair[0].amount >= pair[1].amount));
    }

    /// The parameters are read from the shared document rather than written
    /// here, which this proves by changing one and seeing the answer move.
    #[test]
    fn changing_a_parameter_changes_what_a_spot_is() {
        let (w, h) = (32usize, 32usize);
        let mut grid = vec![0u8; w * h];
        grid[10 * w + 10] = 200;
        grid[10 * w + 14] = 180;

        let agreed = rules();
        assert_eq!(find(&grid, w as u32, h as u32, 1.0, &agreed).len(), 1);

        // A prominence nothing can reach leaves the map with no spots, which is
        // the parameter that decides whether a smeared map has any.
        let steeper = MetalClustering {
            min_prominence_share: 0.9,
            ..agreed
        };
        assert!(find(&grid, w as u32, h as u32, 1.0, &steeper).is_empty());

        // Four samples apart is 64 elmos, so a separation under that makes them
        // two spots.
        let closer = MetalClustering {
            min_separation_elmos: 32.0,
            ..agreed
        };
        assert_eq!(find(&grid, w as u32, h as u32, 1.0, &closer).len(), 2);

        // And a floor above their density makes them none.
        let pickier = MetalClustering {
            min_density_share: 0.9,
            ..agreed
        };
        assert!(find(&grid, w as u32, h as u32, 1.0, &pickier).is_empty());
    }

    /// A map that declares no metal at all has no spots, whatever its density
    /// grid says, because nothing can be extracted from it.
    #[test]
    fn a_map_with_no_max_metal_has_no_spots() {
        let grid = one_spot(32, 32, 5, 5, 255);
        assert!(find(&grid, 32, 32, 0.0, &rules()).is_empty());
    }

    /// A grid that is not the size it says it is could be read wrongly in any
    /// direction, so it is not read at all.
    #[test]
    fn a_grid_that_does_not_match_its_dimensions_is_refused() {
        assert!(find(&[255u8; 10], 4, 4, 1.0, &rules()).is_empty());
        assert!(find(&[], 0, 0, 1.0, &rules()).is_empty());
    }

    /// What the entry carries: the two things the catalog's `metal` kind
    /// requires, and nothing else.
    #[test]
    fn a_point_carries_the_amount_and_the_radius() {
        let grid = one_spot(32, 32, 5, 5, 255);
        let spots = find(&grid, 32, 32, 1.0, &rules());
        let points = points(&spots);
        assert_eq!(points.len(), 1);
        let keys: Vec<&str> = points[0].meta.keys().map(String::as_str).collect();
        assert_eq!(keys, ["amount", "radius"]);
        assert_eq!(points[0].meta["amount"], json!(255.0));
        assert_eq!(points[0].meta["radius"], json!(8.0));
        assert_eq!(points[0].y, None);
    }
}
