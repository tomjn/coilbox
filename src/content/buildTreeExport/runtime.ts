/**
 * The exported page's runtime, as a constant string. Inlined into a `<script>`
 * for the single-file html, or written as `assets/tree.js` for the zip.
 * Dependency-free — it reimplements only the interactions the app's drawer uses:
 * faction tabs, hover/focus highlight (green builds / yellow built-by / dim rest),
 * pan/zoom via the SVG `viewBox`, and a minimap viewport indicator.
 */
export const TREE_JS = `(function () {
  "use strict";
  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  ready(function () {
    // --- Faction tabs: show one .faction section at a time -------------------
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
    var sections = Array.prototype.slice.call(document.querySelectorAll(".faction"));
    function selectSide(side) {
      tabs.forEach(function (t) {
        t.setAttribute("aria-selected", String(t.dataset.tab === side));
      });
      sections.forEach(function (s) {
        var on = s.dataset.side === side;
        s.classList.toggle("active", on);
      });
    }
    tabs.forEach(function (t) {
      t.addEventListener("click", function () { selectSide(t.dataset.tab); });
    });

    // --- Per-scene pan/zoom + hover highlight --------------------------------
    Array.prototype.slice.call(document.querySelectorAll("svg.scene")).forEach(function (svg) {
      var w = parseFloat(svg.dataset.w) || 1;
      var h = parseFloat(svg.dataset.h) || 1;
      var vb = { x: 0, y: 0, w: w, h: h };
      var view = svg.parentNode.querySelector(".minimap-view");
      function apply() {
        svg.setAttribute("viewBox", vb.x + " " + vb.y + " " + vb.w + " " + vb.h);
        if (view) {
          view.setAttribute("x", vb.x);
          view.setAttribute("y", vb.y);
          view.setAttribute("width", vb.w);
          view.setAttribute("height", vb.h);
        }
      }
      apply();

      // Zoom around the pointer, clamped so the scene stays usable.
      svg.addEventListener("wheel", function (e) {
        e.preventDefault();
        var rect = svg.getBoundingClientRect();
        var px = vb.x + ((e.clientX - rect.left) / rect.width) * vb.w;
        var py = vb.y + ((e.clientY - rect.top) / rect.height) * vb.h;
        var f = e.deltaY < 0 ? 0.9 : 1.1;
        var nw = Math.min(w * 4, Math.max(w * 0.05, vb.w * f));
        var nh = nw * (h / w);
        vb.x = px - ((px - vb.x) * nw) / vb.w;
        vb.y = py - ((py - vb.y) * nh) / vb.h;
        vb.w = nw; vb.h = nh;
        apply();
      }, { passive: false });

      // Drag to pan.
      var drag = null;
      svg.addEventListener("pointerdown", function (e) {
        drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y };
        svg.classList.add("grabbing");
        svg.setPointerCapture(e.pointerId);
      });
      svg.addEventListener("pointermove", function (e) {
        if (!drag) return;
        var rect = svg.getBoundingClientRect();
        vb.x = drag.vx - ((e.clientX - drag.x) / rect.width) * vb.w;
        vb.y = drag.vy - ((e.clientY - drag.y) / rect.height) * vb.h;
        apply();
      });
      function endDrag(e) {
        if (!drag) return;
        drag = null;
        svg.classList.remove("grabbing");
        try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
      }
      svg.addEventListener("pointerup", endDrag);
      svg.addEventListener("pointercancel", endDrag);

      // Click the minimap to centre the viewport there.
      var mini = svg.parentNode.querySelector(".minimap");
      if (mini) {
        mini.addEventListener("click", function (e) {
          var rect = mini.getBoundingClientRect();
          vb.x = (e.clientX - rect.left) / rect.width * w - vb.w / 2;
          vb.y = (e.clientY - rect.top) / rect.height * h - vb.h / 2;
          apply();
        });
      }

      // Hover/focus highlight: dim the scene, light incident edges + neighbours.
      var edges = Array.prototype.slice.call(svg.querySelectorAll(".edge"));
      var nodes = {};
      Array.prototype.slice.call(svg.querySelectorAll(".node")).forEach(function (n) {
        nodes[n.dataset.id] = n;
      });
      function highlight(id) {
        svg.classList.add("hi");
        var on = {};
        on[id] = true;
        edges.forEach(function (ed) {
          if (ed.dataset.src === id) { ed.classList.add("builds"); on[ed.dataset.tgt] = true; }
          else if (ed.dataset.tgt === id) { ed.classList.add("builtby"); on[ed.dataset.src] = true; }
        });
        Object.keys(on).forEach(function (k) { if (nodes[k]) nodes[k].classList.add("on"); });
      }
      function clear() {
        svg.classList.remove("hi");
        edges.forEach(function (ed) { ed.classList.remove("builds", "builtby"); });
        Object.keys(nodes).forEach(function (k) { nodes[k].classList.remove("on"); });
      }
      Object.keys(nodes).forEach(function (id) {
        var n = nodes[id];
        n.addEventListener("mouseenter", function () { highlight(id); });
        n.addEventListener("mouseleave", clear);
        n.addEventListener("focus", function () { highlight(id); });
        n.addEventListener("blur", clear);
      });
    });
  });
})();
`;
