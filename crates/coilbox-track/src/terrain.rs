//! The terrain chunk: one row for each heightmap corner that changed.

use crate::chunk::Chunk;
use crate::error::{Result, TrackError};
use crate::keys::TerrainRow;
use crate::quant::check_limit;
use std::collections::HashMap;

fn corrupt(reason: impl Into<String>) -> TrackError {
    TrackError::corrupt("terrain chunk", reason)
}

/// Puts the rows of a whole match in the order the format wants and applies
/// its three rules.
///
/// 1. At most one row for a point in a frame: rows for one point in one frame
///    are merged into one that goes from the first's height before to the
///    last's height after.
/// 2. A change that rounds to nothing is not written.
/// 3. A row's height before is the height after of the previous row for that
///    point, in any window. Only a point's first row keeps the height before
///    it was given, which is the map's own height.
pub(crate) fn prepare(rows: &[TerrainRow]) -> Vec<TerrainRow> {
    let mut sorted = rows.to_vec();
    sorted.sort_by_key(|r| (r.frame, r.z, r.x));
    let mut merged: Vec<TerrainRow> = Vec::with_capacity(sorted.len());
    for r in sorted {
        match merged.last_mut() {
            Some(last) if (last.frame, last.z, last.x) == (r.frame, r.z, r.x) => {
                last.after = r.after
            }
            _ => merged.push(r),
        }
    }
    let mut height: HashMap<(u16, u16), i32> = HashMap::new();
    let mut out = Vec::with_capacity(merged.len());
    for mut r in merged {
        r.before = height.get(&(r.x, r.z)).copied().unwrap_or(r.before);
        if r.before == r.after {
            continue;
        }
        height.insert((r.x, r.z), r.after);
        out.push(r);
    }
    out
}

/// One window's rows, already in order. The first row's gap is counted from
/// the window's first frame.
pub(crate) fn encode(rows: &[TerrainRow], start: u32) -> Result<Chunk> {
    let (mut gap, mut xs, mut zs, mut before, mut delta) = (vec![], vec![], vec![], vec![], vec![]);
    let (mut frame, mut x, mut z, mut b) = (start, 0u16, 0u16, 0i32);
    for r in rows {
        let g = r
            .frame
            .checked_sub(frame)
            .and_then(|g| u16::try_from(g).ok())
            .ok_or_else(|| {
                TrackError::invalid(format!(
                    "terrain row at frame {} is out of order or too far from the one before",
                    r.frame
                ))
            })?;
        gap.push(g);
        xs.push(r.x.wrapping_sub(x));
        zs.push(r.z.wrapping_sub(z));
        check_limit(|| "a terrain height".into(), r.before as i64)?;
        check_limit(|| "a terrain height".into(), r.after as i64)?;
        before.push(r.before - b);
        delta.push(r.after - r.before);
        (frame, x, z, b) = (r.frame, r.x, r.z, r.before);
    }
    let mut c = Chunk::new();
    c.set_u16(112, gap);
    c.set_u16(113, xs);
    c.set_u16(114, zs);
    c.set_s32(115, before);
    c.set_s32(116, delta);
    Ok(c)
}

pub(crate) fn decode(c: &Chunk, start: u32) -> Result<Vec<TerrainRow>> {
    let gap = c.u16s(112)?;
    let n = gap.len();
    let check = |len: usize, id: u16| {
        if len == n {
            Ok(())
        } else {
            Err(corrupt(format!("column {id} has {len} values, not {n}")))
        }
    };
    let (xs, zs, before, delta) = (c.u16s(113)?, c.u16s(114)?, c.s32s(115)?, c.s32s(116)?);
    check(xs.len(), 113)?;
    check(zs.len(), 114)?;
    check(before.len(), 115)?;
    check(delta.len(), 116)?;
    let (mut frame, mut x, mut z, mut b) = (start, 0u16, 0u16, 0i64);
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        frame += gap[i] as u32;
        x = x.wrapping_add(xs[i]);
        z = z.wrapping_add(zs[i]);
        b += before[i] as i64;
        let (before, after) = (
            i32::try_from(b).map_err(|_| corrupt("a height is out of range"))?,
            i32::try_from(b + delta[i] as i64).map_err(|_| corrupt("a height is out of range"))?,
        );
        out.push(TerrainRow {
            frame,
            x,
            z,
            before,
            after,
        });
    }
    Ok(out)
}

/// Moves a heightmap from frame `from` to frame `to` by calling `set` with
/// each corner and the height it takes.
///
/// Going forward, a corner takes its height after for every row with a frame
/// after `from` and up to `to`, in order. Going back, it takes its height
/// before for every row with a frame after `to` and up to `from`, in reverse
/// order. `rows` are the rows of every window in between, in order, and a
/// caller seeking across several windows reads their terrain chunks and not
/// their main chunks.
pub fn apply_terrain(rows: &[TerrainRow], from: u32, to: u32, mut set: impl FnMut(u16, u16, i32)) {
    if from < to {
        for r in rows.iter().filter(|r| r.frame > from && r.frame <= to) {
            set(r.x, r.z, r.after);
        }
    } else {
        for r in rows
            .iter()
            .rev()
            .filter(|r| r.frame > to && r.frame <= from)
        {
            set(r.x, r.z, r.before);
        }
    }
}
