import type { I18n, MessageDescriptor } from "@lingui/core";
import type { FramePlugin, FrameRoute } from "@picoframe/plugin-sdk";

/**
 * Nav labels, breadcrumbs and settings titles are plain strings in a plugin's
 * `index.ts`, built once when the module loads, so a `t` call there would be
 * stuck in the language the app booted in. `lazyText(msg`Maps`)` records the
 * message instead, and `localisePlugins` translates each recorded string when
 * the frame renders, so they follow the Language picker like everything else.
 */
const recorded = new Map<string, MessageDescriptor>();

/**
 * A plugin string that is translated at render. Returns the English source in
 * dev and tests, so code and tests that read a label see English. A release
 * build strips the source from descriptors and this returns the message ID,
 * which `localisePlugins` always replaces before anything draws it.
 */
export function lazyText(descriptor: MessageDescriptor): string {
  const key = descriptor.message ?? descriptor.id;
  recorded.set(key, descriptor);
  return key;
}

/** `text` translated when `lazyText` recorded it, otherwise `text` unchanged. */
function tr(i18n: I18n, text: string): string;
function tr(i18n: I18n, text: string | undefined): string | undefined;
function tr(i18n: I18n, text: string | undefined) {
  const descriptor = text === undefined ? undefined : recorded.get(text);
  return descriptor ? i18n._(descriptor) : text;
}

function trCrumb<T extends string | string[]>(i18n: I18n, crumb: T): T {
  return (
    Array.isArray(crumb) ? crumb.map((c) => tr(i18n, c)) : tr(i18n, crumb)
  ) as T;
}

function localiseRoute(i18n: I18n, route: FrameRoute): FrameRoute {
  const { crumb, children } = route;
  return {
    ...route,
    crumb: typeof crumb === "function" || !crumb ? crumb : trCrumb(i18n, crumb),
    children: children?.map((c) => localiseRoute(i18n, c)),
  };
}

/**
 * `plugins` with every `lazyText` string translated into the active locale.
 * Strings that were never recorded, such as a distribution profile's own page
 * titles, pass through as they are. Hooks, components and route loaders keep
 * their identity, so a language change re-renders the frame without remounting
 * a plugin's provider or page.
 */
export function localisePlugins(
  plugins: FramePlugin[],
  i18n: I18n,
): FramePlugin[] {
  return plugins.map((p) => ({
    ...p,
    nav: p.nav?.map((group) => ({
      ...group,
      label: tr(i18n, group.label),
      items: group.items.map((item) => ({
        ...item,
        label: tr(i18n, item.label),
        description:
          typeof item.description === "string"
            ? tr(i18n, item.description)
            : item.description,
      })),
    })),
    routes: p.routes.map((r) => localiseRoute(i18n, r)),
    crumbs:
      p.crumbs &&
      Object.fromEntries(
        Object.entries(p.crumbs).map(([path, c]) => [path, trCrumb(i18n, c)]),
      ),
    settings: p.settings?.map((s) => ({
      ...s,
      title: tr(i18n, s.title),
      description: tr(i18n, s.description),
    })),
  }));
}
