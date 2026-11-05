import { i18n, type MessageDescriptor } from "@lingui/core";
import { msg } from "@lingui/core/macro";
import type { MetricKey } from "./bindings";

/**
 * What each metric and ratio is called, per language.
 *
 * The registry in `crates/tauri-plugin-coilbox-content/src/metrics.rs` still
 * carries an English `label` for every entry. It is the fallback here, for a key
 * this table does not have yet. The frontend owns the words, keyed the same way
 * `UiError` codes are, so a translator sees them in the catalog.
 *
 * `metricLabels.test.ts` fails when a key the Rust registry publishes is missing
 * from these tables, and `Record<MetricKey, ...>` makes the compiler do the same
 * for the metrics the bindings declare.
 */
export const METRIC_LABEL: Record<MetricKey, MessageDescriptor> = {
  metalUsed: msg`Metal used`,
  energyUsed: msg`Energy used`,
  metalProduced: msg`Metal produced`,
  energyProduced: msg`Energy produced`,
  metalExcess: msg`Metal excess`,
  energyExcess: msg`Energy excess`,
  metalReceived: msg`Metal received`,
  energyReceived: msg`Energy received`,
  metalSent: msg`Metal sent`,
  energySent: msg`Energy sent`,
  damageDealt: msg`Damage dealt`,
  damageReceived: msg`Damage received`,
  unitsProduced: msg`Units built`,
  unitsDied: msg`Units lost`,
  unitsReceived: msg`Units received`,
  unitsSent: msg`Units given away`,
  unitsCaptured: msg`Units captured`,
  unitsOutCaptured: msg`Units lost to capture`,
  unitsKilled: msg`Units killed`,
};

/** A ratio's key is never a metric key, so it has a table of its own. */
export const RATIO_LABEL: Record<string, MessageDescriptor> = {
  unitsLostPerUnitKilled: msg`Units lost per unit killed`,
};

/**
 * The name to show for a metric in the current language. Call it when the name
 * is drawn, after a catalog is active, and not when a module loads.
 */
export function labelOfMetric(metric: { key: string; label: string }): string {
  const descriptor = (
    METRIC_LABEL as Partial<Record<string, MessageDescriptor>>
  )[metric.key];
  return descriptor ? i18n._(descriptor) : metric.label;
}

/** The name to show for a ratio in the current language. */
export function labelOfRatio(ratio: { key: string; label: string }): string {
  const descriptor = RATIO_LABEL[ratio.key];
  return descriptor ? i18n._(descriptor) : ratio.label;
}
