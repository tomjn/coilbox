//! A piece's recorded matrix as the six numbers a pose key stores.
//!
//! This is a stand-in for issue #3783. The recorder writes a piece as a
//! matrix in the unit's model space. A pose key is meant to hold the three
//! turn angles and the offset a unit script would set on the piece, relative
//! to its parent. Until that issue lands, the angles here are the model space
//! rotation taken apart as a turn about y, then x, then z, and the offsets
//! are the model space translation.
//!
//! Everything else treats a pose as a rotation matrix and a translation, and
//! comes through the two functions here. Thinning and its check measure a
//! pose key by putting its angles back together as a matrix, so they do not
//! depend on which angles these are.

use coilbox_track::ANGLE_UNITS_PER_TURN;
use std::f64::consts::TAU;

/// A rotation as rows of columns: `m[row][column]`.
pub(crate) type Matrix = [[f64; 3]; 3];

/// A piece as it was recorded.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) struct PieceSample {
    pub rotation: Matrix,
    pub translation: [f64; 3],
}

impl PieceSample {
    /// From the twelve numbers of a piece pose row: the x axis, the y axis,
    /// the z axis, then the translation.
    pub fn from_row(m: &[f32; 12]) -> Self {
        let v = m.map(|n| n as f64);
        // Each axis is scaled to unit length. A pose key has no scale to
        // store, and an axis that is a little long or short would read as a
        // turn when two matrices are compared.
        let axis = |at: usize| {
            let a = [v[at], v[at + 1], v[at + 2]];
            let length = a.iter().map(|c| c * c).sum::<f64>().sqrt();
            (length > 0.0).then(|| a.map(|c| c / length))
        };
        let rotation = match (axis(0), axis(3), axis(6)) {
            (Some(x), Some(y), Some(z)) => {
                [[x[0], y[0], z[0]], [x[1], y[1], z[1]], [x[2], y[2], z[2]]]
            }
            // A piece scaled to nothing has no direction to record.
            _ => [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]],
        };
        Self {
            rotation,
            translation: [v[9], v[10], v[11]],
        }
    }
}

const UNITS_PER_RADIAN: f64 = ANGLE_UNITS_PER_TURN as f64 / TAU;

/// The angles about x, y and z, in 65,536ths of a turn, of the rotation
/// `turn about y * turn about x * turn about z`.
///
/// Each angle is moved by whole turns to sit nearest `previous`, the angles of
/// the sample before, so a piece that turns past half a turn does not jump a
/// whole turn back.
pub(crate) fn angles(m: &Matrix, previous: Option<[f64; 3]>) -> [f64; 3] {
    let sin_x = (-m[1][2]).clamp(-1.0, 1.0);
    let raw = if sin_x.abs() < 1.0 - 1e-9 {
        [sin_x.asin(), m[0][2].atan2(m[2][2]), m[1][0].atan2(m[1][1])]
    } else {
        // Pointing straight up or down, where the turns about y and z are
        // one turn between them. All of it goes to y.
        [sin_x.asin(), (-m[2][0]).atan2(m[0][0]), 0.0]
    };
    let turn = ANGLE_UNITS_PER_TURN as f64;
    let mut out = raw.map(|a| a * UNITS_PER_RADIAN);
    if let Some(previous) = previous {
        for (a, p) in out.iter_mut().zip(previous) {
            *a += ((p - *a) / turn).round() * turn;
        }
    }
    out
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
    // The trace of `transpose(a) * b`, which is 1 + 2 cos(angle).
    let trace: f64 = (0..3)
        .map(|r| (0..3).map(|c| a[r][c] * b[r][c]).sum::<f64>())
        .sum();
    ((trace - 1.0) / 2.0).clamp(-1.0, 1.0).acos()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: &Matrix, b: &Matrix) -> bool {
        angle_between(a, b) < 1e-6
    }

    #[test]
    fn angles_taken_from_a_rotation_put_it_back_together() {
        for turns in [
            [0.0, 0.0, 0.0],
            [0.1, 0.2, 0.3],
            [-0.2, 0.45, -0.4],
            [0.24, -0.49, 0.1],
            // Straight up, where y and z cannot be told apart.
            [0.25, 0.1, 0.2],
            [-0.25, -0.3, 0.05],
        ] {
            let m = rotation(turns.map(|t| t * ANGLE_UNITS_PER_TURN as f64));
            let back = rotation(angles(&m, None));
            assert!(close(&m, &back), "{turns:?}");
        }
    }

    #[test]
    fn an_angle_stays_near_the_one_before_it() {
        let turn = ANGLE_UNITS_PER_TURN as f64;
        // 0.49 of a turn about y, then a little further, which is past half.
        let before = angles(&rotation([0.0, 0.49 * turn, 0.0]), None);
        let after = angles(&rotation([0.0, 0.52 * turn, 0.0]), Some(before));
        assert!((after[1] - 0.52 * turn).abs() < 1e-6, "{after:?}");
        let alone = angles(&rotation([0.0, 0.52 * turn, 0.0]), None);
        assert!((alone[1] + 0.48 * turn).abs() < 1e-6, "{alone:?}");
    }

    #[test]
    fn a_piece_that_is_scaled_is_not_read_as_turned() {
        let row = [1.5, 0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 0.0, 2.0, 0.0, 0.0, 0.0];
        let sample = PieceSample::from_row(&row);
        assert!(close(&sample.rotation, &rotation([0.0; 3])));
    }

    #[test]
    fn a_row_from_the_recorder_is_read_as_columns() {
        // A quarter turn about y takes the x axis to minus z.
        let row = [0.0, 0.0, -1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 4.0, 5.0, 6.0];
        let sample = PieceSample::from_row(&row);
        assert_eq!(sample.translation, [4.0, 5.0, 6.0]);
        let quarter = rotation([0.0, ANGLE_UNITS_PER_TURN as f64 / 4.0, 0.0]);
        assert!(close(&sample.rotation, &quarter));
    }
}
