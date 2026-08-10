<script setup lang="ts">
import { useData } from "vitepress";
import { computed, nextTick, onMounted, ref, watch } from "vue";
import {
  bundledBackdropSvg,
  FALLBACK_THEME_COLOR,
} from "../../../src/home/bundledArt";
import { parseColor } from "../../../src/home/proceduralArt";
import { backdropFor } from "./backdrops";

/**
 * The illustration behind the current page, if `backdrops.ts` names one.
 *
 * Tinted from the site's own `--vp-c-brand-1` rather than a colour written
 * down here. Coilbox has no single colour to match: a distribution profile
 * repaints the app, so the screenshots on the homepage are green, amber and
 * purple depending on which game is loaded. Following the site's brand
 * variable is the only choice that stays right when that variable changes.
 *
 * The variable is only readable once there is a document, so the first render
 * uses the app's own shipping default and `onMounted` replaces it. It differs
 * between the two ramps as well, so it is re-read whenever the scheme flips.
 */
const { isDark, page } = useData();

/**
 * How much of the brand colour's saturation the art keeps.
 *
 * `paletteFor` clamps a theme's saturation into a 24 to 58 band, so a brand
 * colour at full saturation, which VitePress's `#a8b1ff` is, pins every tint
 * to the top of that band. That is right for a 320px card carrying one small
 * drawing, and too much across a whole page, where it stops reading as art and
 * starts reading as a coloured wash. Cutting the input lands in the middle of
 * the same band while leaving the hue alone, so the art still follows the
 * site's colour.
 */
const SATURATION = 0.35;

const themeColor = ref(FALLBACK_THEME_COLOR);

function readBrandColour() {
  const brand = getComputedStyle(document.documentElement)
    .getPropertyValue("--vp-c-brand-1")
    .trim();
  if (!brand) return;
  const parsed = parseColor(brand);
  themeColor.value = parsed
    ? `hsl(${parsed.h} ${parsed.s * SATURATION}% ${parsed.l}%)`
    : brand;
}

const backdrop = computed(() => backdropFor(page.value.relativePath));

const svg = computed(() => {
  if (!backdrop.value) return undefined;
  return bundledBackdropSvg(
    backdrop.value.toolId,
    themeColor.value,
    isDark.value ? "dark" : "light",
    {
      viewHeight: backdrop.value.viewHeight,
      strength: backdrop.value.strength,
    },
  );
});

/**
 * Anything this small in a drawing is a star. The conquest drawing scatters 46
 * circles of radius 0.6 to 1.9 as its starfield, and its galaxy core, at
 * radius 7, is the thing this number exists to leave out. Picking them by size
 * rather than by their position in the markup means nothing here has to know
 * how `bundledArt.ts` groups its shapes, so a change to the drawing cannot
 * quietly start animating the wrong thing.
 */
const STAR_RADIUS = 2;

const host = ref<HTMLElement>();

/**
 * Sets each star going on its own clock.
 *
 * A CSS-only stagger would have to come from `nth-child` buckets, which repeat
 * often enough across 46 circles to be visible as a pattern. Two coprime
 * strides over the index give every star a different pairing of delay and
 * period instead, so the field never falls into step, and it stays the same on
 * every load rather than shuffling between renders.
 *
 * The animation itself, and its `prefers-reduced-motion` off switch, are in
 * custom.css.
 */
function startTwinkling() {
  if (!host.value || !backdrop.value?.twinkle) return;
  const circles = host.value.querySelectorAll("circle");
  circles.forEach((circle, i) => {
    const radius = Number(circle.getAttribute("r"));
    if (!(radius > 0 && radius <= STAR_RADIUS)) return;
    circle.classList.add("art-star");
    circle.style.animationDelay = `${(i * 811) % 4300}ms`;
    circle.style.animationDuration = `${2600 + ((i * 379) % 2900)}ms`;
  });
}

onMounted(() => {
  // Every redraw replaces the markup and takes the star classes and their
  // inline delays with it, so they go back on after each one. Registered
  // before the first colour read below, because that read is itself a redraw:
  // a watcher added afterwards would miss it and the stars would never start.
  watch(svg, () => nextTick(startTwinkling), {
    flush: "post",
    immediate: true,
  });
  readBrandColour();
  // The class that swaps the ramp lands before the new variable values are
  // readable, so read on the next frame rather than in the watcher body.
  watch(isDark, () => requestAnimationFrame(readBrandColour));
});
</script>

<template>
  <!-- eslint-disable-next-line vue/no-v-html -- built from this module's own
       constants and the registry, never from anything a visitor supplies. -->
  <div v-if="svg" ref="host" class="art-backdrop" aria-hidden="true" v-html="svg" />
</template>
