//! The ground the preview stands its unit on, when the viewport draws one
//! that is not flat.
//!
//! The shapes and their heights are the same formulas as `groundHeight` in
//! `src/lego/environment.ts`, which is what draws them. A script asking where
//! the ground is has to be told what the viewport shows, so the two have to
//! agree to the number.
//!
//! The unit stands at the origin, where both shapes are at height 0, so the
//! unit's own position is the same on every ground. What changes is which way
//! is up for it, which the viewport works out and sends as [`Ground::up`].

use serde::Deserialize;

/// A ground's shape. Both are measured in elmos, in the unit's own space,
/// which is world space because the unit stands at the origin facing +z.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum Shape {
    /// A plane through the origin that rises towards +z, ahead of the unit,
    /// at `degrees` from level.
    Slope { degrees: f64 },
    /// Rows of bumps and hollows `width` elmos from one bump to the next. It
    /// is steepest at the origin, where it rises towards +x at `degrees`.
    Uneven { degrees: f64, width: f64 },
}

impl Shape {
    /// The ground's height at `x`, `z`.
    pub fn height(&self, x: f64, z: f64) -> f64 {
        match *self {
            Shape::Slope { degrees } => z * degrees.to_radians().tan(),
            Shape::Uneven { degrees, width } => {
                let k = std::f64::consts::TAU / width;
                // `sin(kx) cos(kz)` is steepest at the origin, with a gradient
                // of `k` along x, so this amplitude makes that `tan(degrees)`.
                let amplitude = degrees.to_radians().tan() / k;
                amplitude * (k * x).sin() * (k * z).cos()
            }
        }
    }
}

/// The ground on one frame, and how the unit stands on it.
#[derive(Debug, Clone, Copy, Deserialize)]
pub struct Ground {
    pub shape: Shape,
    /// The unit's up direction, or none for a unit that stays upright. The
    /// engine turns a unit that is not upright to the ground's normal
    /// (`CSolidObject::UpdateDirVectors`).
    #[serde(default)]
    pub up: Option<[f64; 3]>,
}

impl Ground {
    pub fn height(&self, x: f64, z: f64) -> f64 {
        self.shape.height(x, z)
    }

    /// Where a point in the unit's own space is in the world, once the unit
    /// has turned to stand on this ground.
    ///
    /// The engine's turn: the shortest rotation from straight up to `up`,
    /// applied with the heading at 0 (`SolidObject.cpp:435-451`), then
    /// `GetObjectSpacePos` (`SolidObject.h:233`). The unit stands at the
    /// origin, so there is no position to add.
    pub fn place(&self, at: [f64; 3]) -> [f64; 3] {
        let Some(up) = self.up else { return at };
        // `CQuaternion quat(uDir.z, 0.0f, -uDir.x, 1.0f + uDir.y)`, normalised.
        let (qx, qy, qz, qw) = (up[2], 0.0, -up[0], 1.0 + up[1]);
        let length = (qx * qx + qy * qy + qz * qz + qw * qw).sqrt();
        if length == 0.0 {
            // Straight down, which no ground in the preview can face.
            return at;
        }
        let (qx, qy, qz, qw) = (qx / length, qy / length, qz / length, qw / length);
        // v + 2w(q x v) + 2 q x (q x v)
        let cross = |a: [f64; 3], b: [f64; 3]| {
            [
                a[1] * b[2] - a[2] * b[1],
                a[2] * b[0] - a[0] * b[2],
                a[0] * b[1] - a[1] * b[0],
            ]
        };
        let q = [qx, qy, qz];
        let t = cross(q, at);
        let u = cross(q, t);
        [
            at[0] + 2.0 * (qw * t[0] + u[0]),
            at[1] + 2.0 * (qw * t[1] + u[1]),
            at[2] + 2.0 * (qw * t[2] + u[2]),
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn a_slope_rises_ahead_of_the_unit() {
        let slope = Shape::Slope { degrees: 45.0 };
        assert!(close(slope.height(0.0, 0.0), 0.0));
        assert!(close(slope.height(30.0, 10.0), 10.0));
        assert!(close(slope.height(0.0, -20.0), -20.0));
    }

    #[test]
    fn uneven_ground_is_level_with_the_unit_at_the_origin_and_steepest_there() {
        let ground = Shape::Uneven {
            degrees: 45.0,
            width: 64.0,
        };
        assert!(close(ground.height(0.0, 0.0), 0.0));
        // A quarter of the way to the next bump is the top of this one.
        let top = 64.0 / std::f64::consts::TAU;
        assert!(close(ground.height(16.0, 0.0), top));
        assert!(close(ground.height(-16.0, 0.0), -top));
        // Half a bump along z turns the row over.
        assert!(close(ground.height(16.0, 32.0), -top));
        // The gradient at the origin is tan(45) = 1.
        let step = 1e-6;
        assert!((ground.height(step, 0.0) / step - 1.0).abs() < 1e-6);
    }

    #[test]
    fn an_upright_unit_is_not_turned() {
        let ground = Ground {
            shape: Shape::Slope { degrees: 30.0 },
            up: None,
        };
        assert_eq!(ground.place([1.0, 2.0, 3.0]), [1.0, 2.0, 3.0]);
    }

    /// On a slope rising ahead, a unit that follows it pitches back: its top
    /// leans downhill, towards -z, and its nose lifts.
    #[test]
    fn a_tilted_unit_turns_with_the_ground() {
        let angle = 30f64.to_radians();
        let ground = Ground {
            shape: Shape::Slope { degrees: 30.0 },
            up: Some([0.0, angle.cos(), -angle.sin()]),
        };
        let top = ground.place([0.0, 10.0, 0.0]);
        assert!(close(top[0], 0.0));
        assert!(close(top[1], 10.0 * angle.cos()));
        assert!(close(top[2], -10.0 * angle.sin()));
        let nose = ground.place([0.0, 0.0, 10.0]);
        assert!(close(nose[1], 10.0 * angle.sin()));
        assert!(close(nose[2], 10.0 * angle.cos()));
        // The nose lands on the slope, which is what following it means.
        assert!(close(nose[1], ground.height(nose[0], nose[2])));
    }

    #[test]
    fn reads_the_shape_the_viewport_sends() {
        let ground: Ground = serde_json::from_str(
            r#"{"shape":{"kind":"uneven","degrees":10,"width":32},"up":null}"#,
        )
        .unwrap();
        assert_eq!(
            ground.shape,
            Shape::Uneven {
                degrees: 10.0,
                width: 32.0
            }
        );
        assert_eq!(ground.up, None);
    }
}
