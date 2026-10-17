/**
 * Animation settings for single copies of a module (#4315).
 *
 * An applied preset has one set of shared params. A unit holding the same
 * module twice can give one copy settings of its own, stored on the applied
 * preset as `instances[instanceId]` and holding only the params that differ
 * from the shared ones. A copy with no entry uses the shared params.
 */

import { type AppliedPreset, presetById } from "./animPresets";
import type { LegoProject } from "./model";

/** What a param is for a preset when nothing sets it. */
function fallbackOf(presetId: string, param: string): number | undefined {
  return presetById(presetId)?.params.find((p) => p.id === param)?.fallback;
}

/** A param's value for one copy: its own, else the shared, else the default. */
export function paramFor(
  entry: AppliedPreset,
  instance: string | null,
  param: string,
): number {
  return (
    (instance !== null ? entry.instances?.[instance]?.[param] : undefined) ??
    entry.params[param] ??
    fallbackOf(entry.presetId, param) ??
    0
  );
}

/** The preset with `instances` set to `next`, or without it when empty. */
function withInstances(
  entry: AppliedPreset,
  next: Record<string, Record<string, number>>,
): AppliedPreset {
  const { instances: _old, ...rest } = entry;
  return Object.keys(next).length > 0 ? { ...rest, instances: next } : rest;
}

/**
 * One param set for one copy. A value equal to what the copy would otherwise
 * use is dropped rather than stored, so the entry holds only differences.
 */
export function withInstanceParam(
  entry: AppliedPreset,
  instance: string,
  param: string,
  next: number,
): AppliedPreset {
  const shared = entry.params[param] ?? fallbackOf(entry.presetId, param) ?? 0;
  const { [instance]: current = {}, ...others } = entry.instances ?? {};
  const { [param]: _dropped, ...kept } = current;
  const own = next === shared ? kept : { ...kept, [param]: next };
  return withInstances(
    entry,
    Object.keys(own).length > 0 ? { ...others, [instance]: own } : others,
  );
}

/** The preset with one copy's own settings cleared. */
export function withoutInstanceSettings(
  entry: AppliedPreset,
  instance: string,
): AppliedPreset {
  if (!entry.instances?.[instance]) return entry;
  const { [instance]: _gone, ...others } = entry.instances;
  return withInstances(entry, others);
}

/** The ids of the instances that have pieces in the unit. */
function liveInstances(project: LegoProject): Set<string> {
  return new Set(project.pieces.map((piece) => piece.module?.instance ?? ""));
}

/**
 * The unit with the settings of instances that no longer have a piece removed.
 * The same object when there is nothing to remove, so an edit that touches no
 * instance is not seen as a change.
 */
export function pruneInstanceSettings(project: LegoProject): LegoProject {
  if (!project.animations?.some((entry) => entry.instances)) return project;
  const live = liveInstances(project);
  let changed = false;
  const animations = project.animations.map((entry) => {
    if (!entry.instances) return entry;
    const kept = Object.entries(entry.instances).filter(([id]) => live.has(id));
    if (kept.length === Object.keys(entry.instances).length) return entry;
    changed = true;
    return withInstances(entry, Object.fromEntries(kept));
  });
  return changed ? { ...project, animations } : project;
}

/**
 * Give instance `to` a copy of instance `from`'s settings, for each preset
 * `keep` accepts. Nothing happens for a preset where `from` has none.
 */
export function copyInstanceSettings(
  project: LegoProject,
  from: string,
  to: string,
  keep: (presetId: string) => boolean = () => true,
): LegoProject {
  if (from === to || !project.animations) return project;
  let changed = false;
  const animations = project.animations.map((entry) => {
    const own = entry.instances?.[from];
    if (!own || !keep(entry.presetId)) return entry;
    changed = true;
    return withInstances(entry, {
      ...entry.instances,
      [to]: { ...own },
    });
  });
  return changed ? { ...project, animations } : project;
}

/**
 * The params of `module` for one preset that the unit's shared params do not
 * already give, which are the module's own settings for a copy dropped into a
 * unit that has the preset. A param the module leaves unset is not its own
 * setting, so it is not carried.
 */
export function moduleOwnSettings(
  have: AppliedPreset,
  module: AppliedPreset,
): Record<string, number> {
  const own: Record<string, number> = {};
  for (const [param, given] of Object.entries(module.params)) {
    if (given !== paramFor(have, null, param)) own[param] = given;
  }
  return own;
}
