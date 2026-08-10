import DefaultTheme from "vitepress/theme";
import { h } from "vue";
import ArtBackdrop from "./ArtBackdrop.vue";
import "./custom.css";

// Extends the stock VitePress theme with two things: a small stylesheet
// carrying the homepage screenshot gallery and a dependency-free CSS lightbox
// (see custom.css), and the illustration behind each page (ArtBackdrop.vue).
//
// The backdrop goes in the `layout-top` slot, but it is fixed to the viewport,
// so where it lands in the DOM decides only what it paints behind rather than
// where it appears.
export default {
  extends: DefaultTheme,
  Layout: () =>
    h(DefaultTheme.Layout, null, {
      "layout-top": () => h(ArtBackdrop),
    }),
};
