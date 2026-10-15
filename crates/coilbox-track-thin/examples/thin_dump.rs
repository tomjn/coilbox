//! Thins a rewind dump into a track from the command line, and prints what
//! it kept.
//!
//! ```sh
//! cargo run --release -p coilbox-track-thin --example thin_dump -- <dump> <track>
//! ```
//!
//! `--tolerance <elmos>`, `--rotation-bits <8 to 16>` and
//! `--resource-tolerance <amount>` change the three settings a measurement
//! varies. `/usr/bin/time -l` in front of the built example gives the peak
//! memory.

use coilbox_track_thin::{thin_dump, KeyCounts, ThinOptions};
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::Instant;

fn counts(label: &str, c: &KeyCounts) {
    println!("{label}:");
    println!("  units                 {}", c.units);
    println!("  transform keys        {}", c.transform);
    println!("  status keys           {}", c.status);
    println!("  target tracks, keys   {}, {}", c.target_tracks, c.target);
    println!("  pose tracks, keys     {}, {}", c.pose_tracks, c.pose);
    println!("  queue keys, items     {}, {}", c.queue, c.queue_items);
    println!(
        "  projectiles, keys     {}, {}",
        c.projectiles, c.projectile
    );
    println!("  features              {}", c.features);
    println!("  terrain rows          {}", c.terrain_rows);
    println!(
        "  team number tracks, keys  {}, {}",
        c.value_tracks, c.value
    );
}

fn main() -> ExitCode {
    let mut options = ThinOptions::default();
    let mut paths = Vec::new();
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        let mut value = |what: &str| {
            args.next()
                .unwrap_or_else(|| panic!("{arg} needs {what} after it"))
        };
        match arg.as_str() {
            "--tolerance" => options.tolerance = value("a number of elmos").parse().expect("elmos"),
            "--rotation-bits" => {
                options.rotation_bits = Some(value("a number of bits").parse().expect("bits"))
            }
            "--resource-tolerance" => {
                options.value_tolerance = value("an amount of metal or energy")
                    .parse()
                    .expect("an amount")
            }
            "--resource-fraction" => {
                options.value_fraction =
                    value("a fraction of a sample").parse().expect("a fraction")
            }
            _ => paths.push(PathBuf::from(arg)),
        }
    }
    let [dump, track] = &paths[..] else {
        eprintln!(
            "usage: thin_dump [--tolerance <elmos>] [--rotation-bits <bits>] [--resource-tolerance <amount>] [--resource-fraction <fraction>] <dump> <track>"
        );
        return ExitCode::FAILURE;
    };

    let started = Instant::now();
    let report = match thin_dump(dump, track, &options) {
        Ok(report) => report,
        Err(e) => {
            eprintln!("{e}");
            return ExitCode::FAILURE;
        }
    };
    let h = &report.header;
    println!("{}", track.display());
    println!(
        "  {} bytes, written in {:.2?}",
        report.bytes,
        started.elapsed()
    );
    println!(
        "  frames {} to {}, {} windows of {}",
        h.first_frame, h.last_frame, h.window_count, h.window_length
    );
    println!(
        "  tolerance {} elmos, position shift {}, velocity shift {}, rotation bits {}",
        h.tolerance, h.position_shift, h.velocity_shift, h.rotation_bits
    );
    println!("  largest unit radius {} elmos", report.weighting_length);
    println!(
        "  resource tolerance {}, or {} of the sample when that is more",
        h.value_tolerance, h.value_fraction
    );
    println!(
        "samples read: {} unit, {} piece pose, {} projectile, {} team number",
        report.samples.units,
        report.samples.poses,
        report.samples.projectiles,
        report.samples.values
    );
    counts("kept by thinning, over the whole match", &report.kept);
    counts("written, counted over every window", &report.written);
    println!("furthest sample from the track:");
    for (label, worst) in [
        ("unit", &report.worst.transform),
        ("piece", &report.worst.pose),
        ("projectile", &report.worst.projectile),
        ("health or build", &report.worst.status),
        ("projectile velocity", &report.worst.projectile_velocity),
        ("team resource", &report.worst.value),
    ] {
        match worst {
            Some(w) => println!("  {label:16} {w}"),
            None => println!("  {label:16} no samples"),
        }
    }
    if report.worst.value.is_some() {
        println!(
            "  {:16} which is allowed {}",
            "", report.worst.value_allowed
        );
    }
    if !report.unread_rest_rotations.is_empty() {
        println!(
            "pose angles hold a rest rotation the dump does not have, for {} unit definitions: {}",
            report.unread_rest_rotations.len(),
            report.unread_rest_rotations.join(", ")
        );
    }
    ExitCode::SUCCESS
}
