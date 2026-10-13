//! The info chunk and the features chunk. Each is read once.

use crate::chunk::Chunk;
use crate::error::{Result, TrackError};
use crate::keys::*;

fn corrupt(part: &str, reason: impl Into<String>) -> TrackError {
    TrackError::corrupt(part, reason)
}

/// A list of strings is two columns: the length of each in bytes as `u16`,
/// and the bytes of all of them end to end as `u8`.
fn put_strings<S: AsRef<str>>(c: &mut Chunk, lengths: u16, bytes: u16, list: &[S]) -> Result<()> {
    let mut len = Vec::with_capacity(list.len());
    let mut data = Vec::new();
    for s in list {
        let s = s.as_ref();
        len.push(u16::try_from(s.len()).map_err(|_| TrackError::OutOfRange {
            what: "the length of a string".into(),
            value: s.len() as i64,
            limit: u16::MAX as i64,
        })?);
        data.extend_from_slice(s.as_bytes());
    }
    c.set_u16(lengths, len);
    c.set_u8(bytes, data);
    Ok(())
}

fn get_strings(c: &Chunk, lengths: u16, bytes: u16) -> Result<Vec<String>> {
    let (len, data) = (c.u16s(lengths)?, c.u8s(bytes)?);
    let mut out = Vec::with_capacity(len.len());
    let mut at = 0usize;
    for n in len {
        let end = at + *n as usize;
        let s = data.get(at..end).ok_or_else(|| {
            corrupt(
                "info chunk",
                format!("column {bytes} is shorter than the lengths in column {lengths}"),
            )
        })?;
        out.push(String::from_utf8(s.to_vec()).map_err(|_| {
            corrupt(
                "info chunk",
                format!("column {bytes} has text that is not UTF-8"),
            )
        })?);
        at = end;
    }
    if at != data.len() {
        return Err(corrupt(
            "info chunk",
            format!("column {bytes} is longer than the lengths in column {lengths}"),
        ));
    }
    Ok(out)
}

pub(crate) fn encode_info(info: &Info) -> Result<Chunk> {
    if !info.unit_footprints.is_empty() && info.unit_footprints.len() != info.unit_defs.len() {
        return Err(TrackError::invalid(format!(
            "the info has {} footprints for {} unit definitions",
            info.unit_footprints.len(),
            info.unit_defs.len()
        )));
    }
    let mut c = Chunk::new();
    put_strings(
        &mut c,
        160,
        161,
        &[&info.engine_version, &info.game, &info.map, &info.writer],
    )?;
    put_strings(&mut c, 162, 163, &info.unit_defs)?;
    put_strings(&mut c, 164, 165, &info.weapon_defs)?;
    put_strings(&mut c, 166, 167, &info.feature_defs)?;
    c.set_u16(168, info.posed_pieces.iter().map(|p| p.unit_def).collect());
    let mut counts = Vec::new();
    for p in &info.posed_pieces {
        counts.push(
            u16::try_from(p.pieces.len()).map_err(|_| TrackError::OutOfRange {
                what: "the posed pieces of a unit definition".into(),
                value: p.pieces.len() as i64,
                limit: u16::MAX as i64,
            })?,
        );
    }
    c.set_u16(169, counts);
    let names: Vec<&String> = info.posed_pieces.iter().flat_map(|p| &p.pieces).collect();
    put_strings(&mut c, 170, 171, &names)?;
    c.set_u8(172, info.teams.iter().map(|t| t.id).collect());
    c.set_u8(173, info.teams.iter().map(|t| t.ally_team).collect());
    c.set_u8(174, info.teams.iter().map(|t| t.flags).collect());
    c.set_u8(175, info.teams.iter().flat_map(|t| t.colour).collect());
    let sides: Vec<&String> = info.teams.iter().map(|t| &t.side).collect();
    put_strings(&mut c, 176, 177, &sides)?;
    let leaders: Vec<&String> = info.teams.iter().map(|t| &t.leader).collect();
    put_strings(&mut c, 178, 179, &leaders)?;
    c.set_u32(180, info.map_size.to_vec());
    c.set_u16(181, info.unit_footprints.iter().map(|f| f[0]).collect());
    c.set_u16(182, info.unit_footprints.iter().map(|f| f[1]).collect());
    put_strings(&mut c, 183, 184, &info.team_params)?;
    put_strings(&mut c, 185, 186, &info.game_params)?;
    Ok(c)
}

pub(crate) fn decode_info(c: &Chunk) -> Result<Info> {
    let bad = |reason: String| corrupt("info chunk", reason);
    let mut texts = get_strings(c, 160, 161)?;
    if texts.len() < 4 {
        return Err(bad(format!(
            "it has {} lines of track text, not 4",
            texts.len()
        )));
    }
    // A later writer may add lines after the four.
    texts.truncate(4);
    let [engine_version, game, map, writer]: [String; 4] = texts.try_into().expect("four");
    let piece_defs = c.u16s(168)?;
    let piece_counts = c.u16s(169)?;
    if piece_defs.len() != piece_counts.len() {
        return Err(bad("columns 168 and 169 have different lengths".into()));
    }
    let mut names = get_strings(c, 170, 171)?.into_iter();
    let mut posed_pieces = Vec::new();
    for (def, n) in piece_defs.iter().zip(piece_counts) {
        let pieces: Vec<String> = names.by_ref().take(*n as usize).collect();
        if pieces.len() != *n as usize {
            return Err(bad(
                "column 170 has fewer names than column 169 counts".into()
            ));
        }
        posed_pieces.push(PosedPieces {
            unit_def: *def,
            pieces,
        });
    }
    let ids = c.u8s(172)?;
    let n = ids.len();
    let (ally, flags, colour) = (c.u8s(173)?, c.u8s(174)?, c.u8s(175)?);
    let (sides, leaders) = (get_strings(c, 176, 177)?, get_strings(c, 178, 179)?);
    if [ally.len(), flags.len(), sides.len(), leaders.len()]
        .iter()
        .any(|l| *l != n)
        || colour.len() != 3 * n
    {
        return Err(bad("the team columns have different lengths".into()));
    }
    let teams = (0..n)
        .map(|i| Team {
            id: ids[i],
            ally_team: ally[i],
            flags: flags[i],
            colour: [colour[3 * i], colour[3 * i + 1], colour[3 * i + 2]],
            side: sides[i].clone(),
            leader: leaders[i].clone(),
        })
        .collect();
    let size = c.u32s(180)?;
    let unit_defs = get_strings(c, 162, 163)?;
    let (across, along) = (c.u16s(181)?, c.u16s(182)?);
    // A track from before recorder version 3 has neither column.
    if across.len() != along.len() || (!across.is_empty() && across.len() != unit_defs.len()) {
        return Err(bad(format!(
            "columns 181 and 182 have {} and {} footprints for {} unit definitions",
            across.len(),
            along.len(),
            unit_defs.len()
        )));
    }
    Ok(Info {
        engine_version,
        game,
        map,
        writer,
        unit_defs,
        unit_footprints: across.iter().zip(along).map(|(x, z)| [*x, *z]).collect(),
        weapon_defs: get_strings(c, 164, 165)?,
        feature_defs: get_strings(c, 166, 167)?,
        posed_pieces,
        teams,
        map_size: match size {
            [] => [0, 0],
            [x, z] => [*x, *z],
            _ => return Err(bad("column 180 does not have two values".into())),
        },
        // A track from before recorder version 4 has none of the four columns.
        team_params: get_strings(c, 183, 184)?,
        game_params: get_strings(c, 185, 186)?,
    })
}

pub(crate) fn encode_features(features: &[Feature]) -> Chunk {
    let mut c = Chunk::new();
    c.set_u16(128, features.iter().map(|f| f.engine_id).collect());
    c.set_u16(129, features.iter().map(|f| f.feature_def).collect());
    c.set_u8(130, features.iter().map(|f| f.team).collect());
    c.set_u8(131, features.iter().map(|f| f.flags).collect());
    c.set_u32(132, features.iter().map(|f| f.first_frame).collect());
    c.set_u32(133, features.iter().map(|f| f.last_frame).collect());
    for a in 0..3 {
        c.set_s32(
            134 + a as u16,
            features.iter().map(|f| f.position[a]).collect(),
        );
    }
    c.set_u8(137, features.iter().map(|f| f.rotation.dropped).collect());
    for a in 0..3 {
        c.set_u16(
            138 + a as u16,
            features.iter().map(|f| f.rotation.kept[a] as u16).collect(),
        );
    }
    c
}

pub(crate) fn decode_features(c: &Chunk) -> Result<Vec<Feature>> {
    let ids = c.u16s(128)?;
    let n = ids.len();
    let part = "features chunk";
    let check = |len: usize, id: u16| {
        if len == n {
            Ok(())
        } else {
            Err(corrupt(
                part,
                format!("column {id} has {len} values, not {n}"),
            ))
        }
    };
    let (defs, teams, flags) = (c.u16s(129)?, c.u8s(130)?, c.u8s(131)?);
    let (first, last) = (c.u32s(132)?, c.u32s(133)?);
    let pos = [c.s32s(134)?, c.s32s(135)?, c.s32s(136)?];
    let dropped = c.u8s(137)?;
    let kept = [c.u16s(138)?, c.u16s(139)?, c.u16s(140)?];
    check(defs.len(), 129)?;
    check(teams.len(), 130)?;
    check(flags.len(), 131)?;
    check(first.len(), 132)?;
    check(last.len(), 133)?;
    check(dropped.len(), 137)?;
    for a in 0..3 {
        check(pos[a].len(), 134 + a as u16)?;
        check(kept[a].len(), 138 + a as u16)?;
    }
    Ok((0..n)
        .map(|i| Feature {
            engine_id: ids[i],
            feature_def: defs[i],
            team: teams[i],
            flags: flags[i],
            first_frame: first[i],
            last_frame: last[i],
            position: [pos[0][i], pos[1][i], pos[2][i]],
            rotation: Rotation {
                dropped: dropped[i],
                kept: [kept[0][i] as i16, kept[1][i] as i16, kept[2][i] as i16],
            },
        })
        .collect())
}
