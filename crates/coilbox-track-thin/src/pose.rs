//! A piece's recorded matrix as the six numbers a pose key stores: the three
//! turn angles and the offset a unit script set on the piece (issue #3783).
//!
//! The recorder writes a piece as a matrix in the unit's model space. The
//! engine makes that matrix from the piece's own transform and its parent's
//! (`LocalModelPiece::UpdateChildTransformRec`), and the piece's own is a
//! translation by `pos`, then a rotation by `rot`
//! (`S3DModelPiece::ComposeTransform`). `pos` starts at the model's offset for
//! the piece and a script's `Move` adds to it. `rot` is what a script's `Turn`
//! sets, in radians about x, y and z, and the rotation it stands for is
//! `CQuaternion::FromEulerYPR(rot)`: a turn about z, then about x, then about
//! y, each about the parent's axes. As matrices that act on a column, that is
//! `turn about y * turn about x * turn about z`.
//!
//! So a piece's matrix with its parent's taken off is that rotation and that
//! translation. [`relative`] takes the parent off, and [`angles`] takes the
//! rotation apart. A model format that bakes a rest rotation into a piece puts
//! it between the two, and the engine does not tell Lua what it is, so for
//! such a model the angles here hold both. `3do` and `s3o` pieces have none.
//!
//! Thinning and its check measure a pose key by putting its angles back
//! together as a matrix with [`rotation`], so they do not depend on which of
//! the angles that describe a rotation were picked.

use crate::dump::PieceTree;
use coilbox_track::ANGLE_UNITS_PER_TURN;
use std::f64::consts::{PI, TAU};

/// A rotation as rows of columns: `m[row][column]`.
pub(crate) type Matrix = [[f64; 3]; 3];

const IDENTITY: Matrix = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];

/// A piece in the unit's model space, as it was recorded.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct ModelSample {
    pub rotation: Matrix,
    pub translation: [f64; 3],
    /// How much larger the piece is drawn than its model. The engine scales
    /// a piece the same along every axis, and a child's offset with it.
    pub scale: f64,
}

impl ModelSample {
    /// From the twelve numbers of a piece pose row: the x axis, the y axis,
    /// the z axis, then the translation.
    pub fn from_row(m: &[f32; 12]) -> Self {
        let v = m.map(|n| n as f64);
        // Each axis is scaled to unit length. A pose key has no scale to
        // store, and an axis that is a little long or short would read as a
        // turn when two matrices are compared.
        let length = |at: usize| (0..3).map(|i| v[at + i] * v[at + i]).sum::<f64>().sqrt();
        let lengths = [length(0), length(3), length(6)];
        let translation = [v[9], v[10], v[11]];
        if lengths.contains(&0.0) {
            // A piece scaled to nothing has no direction to record.
            return Self {
                rotation: IDENTITY,
                translation,
                scale: 1.0,
            };
        }
        let mut rotation = [[0.0; 3]; 3];
        for (row, cells) in rotation.iter_mut().enumerate() {
            for (column, cell) in cells.iter_mut().enumerate() {
                *cell = v[column * 3 + row] / lengths[column];
            }
        }
        Self {
            rotation,
            translation,
            scale: lengths.iter().sum::<f64>() / 3.0,
        }
    }
}

/// A piece relative to its parent, which is what a pose key holds.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PieceSample {
    pub rotation: Matrix,
    /// The offset from the piece's rest position, in elmos.
    pub translation: [f64; 3],
    /// The length in elmos that the piece's turn is multiplied by to give a
    /// distance. See [`reaches`].
    pub reach: f64,
}

/// A piece with its parent's transform taken off: its rotation relative to
/// the parent, and how far it sits from `rest`, its rest offset from the
/// parent. The root piece has no parent.
pub(crate) fn relative(
    parent: Option<&ModelSample>,
    piece: &ModelSample,
    rest: [f64; 3],
) -> (Matrix, [f64; 3]) {
    let Some(parent) = parent else {
        let t = piece.translation;
        return (piece.rotation, [0, 1, 2].map(|i| t[i] - rest[i]));
    };
    // The transpose of a rotation undoes it.
    let p = &parent.rotation;
    let back: Matrix = [0, 1, 2].map(|r| [p[0][r], p[1][r], p[2][r]]);
    let from = [0, 1, 2].map(|i| piece.translation[i] - parent.translation[i]);
    let t = back.map(|row| (0..3).map(|c| row[c] * from[c]).sum::<f64>());
    let rotation = multiply(&back, &piece.rotation);
    // The engine scales a child's offset by its parent's scale.
    (rotation, [0, 1, 2].map(|i| t[i] / parent.scale - rest[i]))
}

/// For each piece of a model, how far from the piece's origin its turn moves
/// anything: the furthest corner of the box round its own geometry or round
/// the geometry of any piece below it, with every piece at rest. `None` for a
/// piece that has no geometry on it or below it.
///
/// A piece's turn in radians times this is no less than the distance the turn
/// moves any point of that geometry, as long as no piece below has been moved
/// or scaled further out than it rests.
///
/// `offsets` and `bounds` are the tree's, one for each piece. A piece with no
/// geometry has empty bounds.
pub(crate) fn reaches(
    tree: &PieceTree,
    offsets: &[[f32; 3]],
    bounds: &[Vec<f32>],
) -> Vec<Option<f64>> {
    let count = tree.pieces.len();
    let mut out: Vec<Option<f64>> = vec![None; count];
    for (piece, bound) in bounds.iter().enumerate() {
        let [min_x, min_y, min_z, max_x, max_y, max_z] = bound[..] else {
            continue;
        };
        let (min, max) = ([min_x, min_y, min_z], [max_x, max_y, max_z]);
        // Where this piece's origin is in the space of the piece it has
        // climbed to. A tree is no deeper than it has pieces, which stops a
        // model whose parents loop.
        let mut at = [0.0f64; 3];
        let mut above = piece;
        for _ in 0..count {
            let far = (0..3)
                .map(|i| {
                    let low = (at[i] + min[i] as f64).abs();
                    let high = (at[i] + max[i] as f64).abs();
                    low.max(high).powi(2)
                })
                .sum::<f64>()
                .sqrt();
            out[above] = Some(out[above].map_or(far, |r| r.max(far)));
            for (sum, offset) in at.iter_mut().zip(offsets[above]) {
                *sum += offset as f64;
            }
            match (tree.parents[above] as usize).checked_sub(1) {
                Some(parent) if parent < count => above = parent,
                _ => break,
            }
        }
    }
    out
}

const UNITS_PER_RADIAN: f64 = ANGLE_UNITS_PER_TURN as f64 / TAU;

/// The spacing of the 32 bit floats the recorder wrote, near 1. A number
/// that should be zero and is below this is zero.
const FLOAT_SPACING: f64 = f32::EPSILON as f64;

/// `value` moved by the whole number of turns that puts it nearest `to`, in
/// radians.
fn nearest(value: f64, to: f64) -> f64 {
    value + ((to - value) / TAU).round() * TAU
}

/// The angles about x, y and z, in 65,536ths of a turn, of the rotation
/// `turn about y * turn about x * turn about z`.
///
/// A rotation has two sets of such angles: `(x, y, z)` and `(half a turn - x,
/// y + half a turn, z + half a turn)`. Each angle can also be any number of
/// whole turns further on. The set picked is the one nearest `previous`, the
/// angles of the sample before, with each angle the whole number of turns
/// nearest it. So a piece that turns past half a turn does not jump a whole
/// turn back, and one that keeps turning keeps counting up. With no sample
/// before, the set is the one nearest rest.
pub(crate) fn angles(m: &Matrix, previous: Option<[f64; 3]>) -> [f64; 3] {
    let before = previous.unwrap_or([0.0; 3]).map(|a| a / UNITS_PER_RADIAN);
    // The middle row is the sine of the turn about x, and its cosine times
    // the sine and the cosine of the turn about z.
    let sin_x = (-m[1][2]).clamp(-1.0, 1.0);
    let cos_x = m[1][0].hypot(m[1][1]);
    let x = sin_x.atan2(cos_x);
    // At a quarter turn about x there is nothing to read the turn about z
    // from. The rotation then depends on the turns about y and z only
    // through their difference or their sum, so the sample before says how
    // to share it out.
    let z = if cos_x < FLOAT_SPACING {
        before[2]
    } else {
        m[1][0].atan2(m[1][1])
    };
    // The other two rows give `(1 + sin x)` times the sine and cosine of y
    // less z, and `(1 - sin x)` times those of y plus z. The turn about y is
    // read from whichever pair is not small.
    let y = if sin_x >= 0.0 {
        (m[0][1] - m[2][0]).atan2(m[0][0] + m[2][1]) + z
    } else {
        (-(m[0][1] + m[2][0])).atan2(m[0][0] - m[2][1]) - z
    };
    let sets = [[x, y, z], [PI - x, y + PI, z + PI]].map(|set| {
        let near = [0, 1, 2].map(|i| nearest(set[i], before[i]));
        let far: f64 = (0..3).map(|i| (near[i] - before[i]).powi(2)).sum();
        (near, far)
    });
    let picked = if sets[1].1 < sets[0].1 {
        sets[1].0
    } else {
        sets[0].0
    };
    picked.map(|a| a * UNITS_PER_RADIAN)
}

fn multiply(a: &Matrix, b: &Matrix) -> Matrix {
    let mut out = [[0.0; 3]; 3];
    for (r, row) in out.iter_mut().enumerate() {
        for (c, cell) in row.iter_mut().enumerate() {
            *cell = (0..3).map(|k| a[r][k] * b[k][c]).sum();
        }
    }
    out
}

/// The rotation three angles in 65,536ths of a turn stand for.
pub(crate) fn rotation(angles: [f64; 3]) -> Matrix {
    let [x, y, z] = angles.map(|a| a / UNITS_PER_RADIAN);
    let (sx, cx) = x.sin_cos();
    let (sy, cy) = y.sin_cos();
    let (sz, cz) = z.sin_cos();
    let about_x = [[1.0, 0.0, 0.0], [0.0, cx, -sx], [0.0, sx, cx]];
    let about_y = [[cy, 0.0, sy], [0.0, 1.0, 0.0], [-sy, 0.0, cy]];
    let about_z = [[cz, -sz, 0.0], [sz, cz, 0.0], [0.0, 0.0, 1.0]];
    multiply(&multiply(&about_y, &about_x), &about_z)
}

/// The angle in radians of the turn that takes one rotation to the other.
pub(crate) fn angle_between(a: &Matrix, b: &Matrix) -> f64 {
    // The sum of the squares of the differences between the two is
    // `8 sin^2(angle / 2)`. The angle could also be had from the trace of one
    // times the other's transpose, which is `1 + 2 cos(angle)`, but a cosine
    // hardly changes near no turn at all. Read that way, matrices that went
    // through the recorder's 32 bit floats are 0.0002 radians apart when
    // they are the same.
    let squares: f64 = (0..3)
        .map(|r| (0..3).map(|c| (a[r][c] - b[r][c]).powi(2)).sum::<f64>())
        .sum();
    2.0 * (squares / 8.0).sqrt().min(1.0).asin()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: &Matrix, b: &Matrix) -> bool {
        angle_between(a, b) < 1e-6
    }

    const TURN: f64 = ANGLE_UNITS_PER_TURN as f64;

    fn turns(t: [f64; 3]) -> [f64; 3] {
        t.map(|t| t * TURN)
    }

    fn near(a: [f64; 3], b: [f64; 3], within: f64) -> bool {
        a.iter().zip(b).all(|(a, b)| (a - b).abs() < within)
    }

    /// A matrix as the recorder's 32 bit floats carry it.
    fn as_recorded(m: &Matrix) -> Matrix {
        m.map(|row| row.map(|v| v as f32 as f64))
    }

    #[test]
    fn angles_made_into_a_matrix_and_taken_back_are_the_same_angles() {
        for t in [
            [0.0, 0.0, 0.0],
            [0.1, 0.2, 0.3],
            [-0.2, 0.45, -0.4],
            [0.24, -0.49, 0.1],
            // The angle about x past a quarter turn, which the other of the
            // two sets of angles for a rotation holds.
            [0.3, 0.1, 0.2],
            [-0.45, 0.6, -0.1],
            // More than a turn.
            [1.2, -2.6, 3.4],
        ] {
            let a = turns(t);
            // The sample before was a little way off on every angle.
            let before = [a[0] + 300.0, a[1] - 200.0, a[2] + 100.0];
            let back = angles(&rotation(a), Some(before));
            assert!(near(back, a, 1e-6), "{t:?} came back as {back:?}");
        }
    }

    #[test]
    fn with_no_sample_before_the_angles_are_the_set_nearest_rest() {
        // A quarter turn about y and a little more is not a half turn about x
        // and z with the rest about y.
        let a = turns([0.0, 0.3, 0.0]);
        assert!(near(angles(&rotation(a), None), a, 1e-6));
        // The same rotation written the long way comes back the short way.
        let long = turns([0.5, 0.8, 0.5]);
        let back = angles(&rotation(long), None);
        assert!(near(back, a, 1e-6), "{back:?}");
    }

    #[test]
    fn a_quarter_turn_about_x_keeps_the_turns_about_y_and_z_apart() {
        // At a quarter turn about x the rotation depends on y less z alone.
        // The sample before says how to share it out.
        for x in [0.25, -0.25] {
            let a = turns([x, 0.1, 0.35]);
            let m = rotation(a);
            let back = angles(&m, Some(a));
            assert!(near(back, a, 1e-3), "{back:?}");
            // With no sample before, any share is right that gives the
            // rotation back.
            assert!(close(&rotation(angles(&m, None)), &m), "{x}");
        }
    }

    #[test]
    fn angles_near_a_quarter_turn_about_x_give_back_what_was_recorded() {
        // Close to a quarter turn the turns about y and z are each read from
        // numbers near zero, and a 32 bit float has little of them left.
        for short in [1e-2, 1e-3, 1e-4, 1e-5, 1e-6, 0.0] {
            for sign in [1.0, -1.0] {
                let a = turns([sign * (0.25 - short), 0.3, -0.2]);
                let m = as_recorded(&rotation(a));
                let off = angle_between(&rotation(angles(&m, Some(a))), &m);
                // A 32 bit float near 1 is good to 1.2e-7, and a matrix of
                // nine of them is this far from a rotation at most.
                assert!(off < 1e-6, "{short} short, sign {sign}: off by {off}");
            }
        }
    }

    #[test]
    fn a_piece_tipping_through_a_quarter_turn_does_not_jump() {
        let mut before = None;
        for step in 0..=100 {
            let a = turns([0.2 + 0.001 * step as f64, 0.1, 0.05]);
            let back = angles(&as_recorded(&rotation(a)), before);
            assert!(near(back, a, 1.0), "step {step}: {back:?} for {a:?}");
            before = Some(back);
        }
    }

    #[test]
    fn two_keys_either_side_of_a_half_turn_meet_the_short_way() {
        let q = coilbox_track::Quantiser::new(3, 11, 12).unwrap();
        let before = angles(&rotation(turns([0.0, 0.47, 0.0])), None);
        let after = angles(&rotation(turns([0.0, 0.53, 0.0])), Some(before));
        let key = |frame, a: [f64; 3]| coilbox_track::PoseKey {
            frame,
            angles: a.map(|v| v.round() as i32),
            offsets: [0; 3],
        };
        let keys = [key(0, before), key(10, after)];
        let (half_way, _) = coilbox_track::pose_at(&keys, &q, 5).unwrap();
        // Through the half turn, and not back through rest.
        let half_turn = rotation(turns([0.0, 0.5, 0.0]));
        assert!(angle_between(&rotation(half_way), &half_turn) < 1e-3);
    }

    #[test]
    fn a_full_rotation_is_kept_as_a_full_rotation() {
        let mut before = None;
        let mut seen = Vec::new();
        for step in 0..=40 {
            let a = turns([0.0, step as f64 / 20.0, 0.0]);
            let back = angles(&as_recorded(&rotation(a)), before);
            seen.push(back[1]);
            before = Some(back);
        }
        assert!(seen.windows(2).all(|w| w[1] > w[0]), "{seen:?}");
        // Two whole turns, where the rotation itself is back where it began.
        assert!((seen[40] - 2.0 * TURN).abs() < 1.0, "{}", seen[40]);
    }

    /// A piece's model space matrix: its parent's, then a move to `at` in
    /// the parent's space, then a turn.
    fn under(parent: &ModelSample, at: [f64; 3], turn: &Matrix) -> ModelSample {
        let moved: [f64; 3] = [0, 1, 2].map(|r| {
            parent.translation[r]
                + parent.scale * (0..3).map(|c| parent.rotation[r][c] * at[c]).sum::<f64>()
        });
        ModelSample {
            rotation: multiply(&parent.rotation, turn),
            translation: moved,
            scale: parent.scale,
        }
    }

    #[test]
    fn a_piece_with_its_parent_taken_off_is_what_a_script_set_on_it() {
        let turret = ModelSample {
            rotation: rotation(turns([0.0, 0.2, 0.0])),
            translation: [1.0, 2.0, 3.0],
            scale: 1.0,
        };
        // The sleeve rests 3 up and 4 forward of the turret. A script has
        // tipped it a tenth of a turn and moved it 1 further forward.
        let tipped = rotation(turns([0.1, 0.0, 0.0]));
        let sleeve = under(&turret, [0.0, 3.0, 5.0], &tipped);
        let (rotation, offset) = relative(Some(&turret), &sleeve, [0.0, 3.0, 4.0]);
        assert!(close(&rotation, &tipped));
        assert!(near(offset, [0.0, 0.0, 1.0], 1e-9), "{offset:?}");
    }

    #[test]
    fn a_piece_under_a_scaled_parent_is_offset_in_the_parents_own_measure() {
        let turret = ModelSample {
            rotation: rotation(turns([0.0, 0.2, 0.0])),
            translation: [1.0, 2.0, 3.0],
            scale: 2.0,
        };
        let sleeve = under(&turret, [0.0, 3.0, 5.0], &IDENTITY);
        let (_, offset) = relative(Some(&turret), &sleeve, [0.0, 3.0, 4.0]);
        assert!(near(offset, [0.0, 0.0, 1.0], 1e-9), "{offset:?}");
    }

    #[test]
    fn the_root_piece_is_offset_from_its_own_rest_position() {
        let root = ModelSample {
            rotation: rotation(turns([0.0, 0.1, 0.0])),
            translation: [0.0, 6.5, 0.0],
            scale: 1.0,
        };
        let (turned, offset) = relative(None, &root, [0.0, 5.0, 0.0]);
        assert!(close(&turned, &root.rotation));
        assert!(near(offset, [0.0, 1.5, 0.0], 1e-9));
    }

    #[test]
    fn a_piece_reaches_as_far_as_the_geometry_on_it_and_below_it() {
        let tree = PieceTree {
            def: 1,
            pieces: ["base", "turret", "barrel", "flare", "leg"]
                .map(String::from)
                .to_vec(),
            parents: vec![0, 1, 2, 3, 1],
            model_type: None,
            offsets: None,
            bounds: None,
        };
        let offsets = [
            [0.0, 0.0, 0.0],
            [0.0, 10.0, -2.5],
            [0.0, 3.0, 4.0],
            [0.0, 0.0, 12.0],
            [-7.0, 0.0, 0.0],
        ];
        let bounds = [
            vec![-8.0, 0.0, -12.0, 8.0, 10.0, 12.0],
            vec![-5.0, 0.0, -5.0, 5.0, 4.0, 5.0],
            vec![-0.5, -0.5, 0.0, 0.5, 0.5, 12.0],
            vec![],
            vec![-2.0, -4.0, -2.0, 2.0, 0.0, 2.0],
        ];
        let reach = reaches(&tree, &offsets, &bounds);
        let is = |piece: usize, want: f64| {
            let got = reach[piece].unwrap();
            assert!(
                (got - want).abs() < 1e-9,
                "piece {piece}: {got}, not {want}"
            );
        };
        // The barrel's own far corner, 12 along and half an elmo out each way.
        is(2, 144.5f64.sqrt());
        // The turret carries the barrel, whose far corner is 3.5 up and 16
        // along from the turret's origin.
        is(1, (0.25f64 + 12.25 + 256.0).sqrt());
        // The base carries all of it: the barrel's far corner is 13.5 up and
        // 13.5 along, which is further than any corner of the base.
        is(0, (0.25f64 + 182.25 + 182.25).sqrt());
        is(4, 24.0f64.sqrt());
        // A flare has no geometry and nothing below it.
        assert_eq!(reach[3], None);
    }

    #[test]
    fn a_piece_that_is_scaled_is_not_read_as_turned() {
        let row = [1.5, 0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0];
        let sample = ModelSample::from_row(&row);
        assert!(close(&sample.rotation, &rotation([0.0; 3])));
    }

    #[test]
    fn a_row_from_the_recorder_is_read_as_columns() {
        // A quarter turn about y takes the x axis to minus z.
        let row = [0.0, 0.0, -1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 4.0, 5.0, 6.0];
        let sample = ModelSample::from_row(&row);
        assert_eq!(sample.translation, [4.0, 5.0, 6.0]);
        let quarter = rotation([0.0, ANGLE_UNITS_PER_TURN as f64 / 4.0, 0.0]);
        assert!(close(&sample.rotation, &quarter));
    }
}
