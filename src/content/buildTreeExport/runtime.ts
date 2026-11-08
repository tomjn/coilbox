/**
 * The exported page's runtime, as a constant string. Inlined into a `<script>`
 * for the single-file html, or written as `assets/tree.js` for the zip.
 * It has no dependencies and reimplements only the interactions the app's
 * drawer uses: faction tabs, hover highlight (green builds, yellow built-by,
 * dim rest), click to focus a unit (its neighbours rearranged around it, with a
 * panel of its stats), a unit search box, pan/zoom via the SVG `viewBox`, and a
 * minimap viewport indicator.
 *
 * Three pieces are plain JavaScript copies of code the app has in TypeScript,
 * and `buildTreeExport.test.ts` checks each against the original: the focus
 * layout (`layoutFocusTree`), the neighbour set (`focusNeighbours`) and the
 * search ranking (`searchUnits`). The script is a template string, so it holds
 * no backticks and no dollar-brace sequences of its own.
 */

import { SEARCH_LIMIT } from "../buildTreeSearch";
import { NODE_H, NODE_W } from "./types";

export const TREE_JS = `(function () {
  "use strict";
  var NODE_W = ${NODE_W};
  var NODE_H = ${NODE_H};
  // The focus layout's cell size and gaps, as layoutFocusTree's defaults.
  var CELL_W = 104;
  var CELL_H = 124;
  var GAP_X = 24;
  var BAND_GAP = 90;
  var ROW_GAP = 16;
  var FOCUS_PAD = 40;
  var SEARCH_LIMIT = ${SEARCH_LIMIT};

  function ready(fn) {
    if (document.readyState !== "loading") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }
  function each(list, fn) {
    Array.prototype.slice.call(list).forEach(fn);
  }

  // Focused unit centred, its builders in a grid above and what it builds in a
  // grid below. Positions are node top-left corners.
  function layoutFocus(focused, builds, builtBy) {
    var pos = {};
    function cols(n) { return Math.max(1, Math.min(n, Math.ceil(Math.sqrt(n)))); }
    function blockHeight(n) {
      if (n === 0) return 0;
      var rows = Math.ceil(n / cols(n));
      return rows * CELL_H + (rows - 1) * ROW_GAP;
    }
    function placeGrid(ids, topY) {
      var c = cols(ids.length);
      var rows = Math.ceil(ids.length / c);
      ids.forEach(function (id, i) {
        var r = Math.floor(i / c);
        var col = i % c;
        var rowCount = r === rows - 1 ? ids.length - r * c : c;
        var rowW = rowCount * CELL_W + (rowCount - 1) * GAP_X;
        pos[id] = { x: -rowW / 2 + col * (CELL_W + GAP_X), y: topY + r * (CELL_H + ROW_GAP) };
      });
    }
    pos[focused] = { x: -CELL_W / 2, y: 0 };
    if (builtBy.length > 0) placeGrid(builtBy, -BAND_GAP - blockHeight(builtBy.length));
    if (builds.length > 0) placeGrid(builds, CELL_H + BAND_GAP);
    return pos;
  }

  // Cubic-bezier from a source node's bottom-centre to a target's top-centre.
  function edgePath(s, t) {
    var sx = s.x + NODE_W / 2;
    var sy = s.y + NODE_H;
    var tx = t.x + NODE_W / 2;
    var ty = t.y;
    var my = (sy + ty) / 2;
    return "M" + sx + "," + sy + " C" + sx + "," + my + " " + tx + "," + my + " " + tx + "," + ty;
  }

  // Units whose label or id contains the query, prefix matches first, then in
  // label order. Mirrors searchUnits in buildTreeSearch.ts.
  function searchItems(query, items) {
    var q = query.trim().toLowerCase();
    if (!q) return [];
    var ranked = [];
    items.forEach(function (it) {
      var label = it.label.toLowerCase();
      var id = it.id.toLowerCase();
      if (label.indexOf(q) === 0 || id.indexOf(q) === 0) ranked.push({ it: it, rank: 0, label: label });
      else if (label.indexOf(q) !== -1 || id.indexOf(q) !== -1) ranked.push({ it: it, rank: 1, label: label });
    });
    ranked.sort(function (a, b) {
      if (a.rank !== b.rank) return a.rank - b.rank;
      if (a.label !== b.label) return a.label < b.label ? -1 : 1;
      return a.it.id < b.it.id ? -1 : a.it.id > b.it.id ? 1 : 0;
    });
    return ranked.slice(0, SEARCH_LIMIT).map(function (r) { return r.it; });
  }

  ready(function () {
    // --- Faction tabs: show one .faction section at a time -------------------
    var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
    var sections = Array.prototype.slice.call(document.querySelectorAll(".faction"));
    var scenes = {};
    var closeResults = function () {};
    function selectSide(side) {
      tabs.forEach(function (t) {
        t.setAttribute("aria-selected", String(t.dataset.tab === side));
      });
      sections.forEach(function (s) {
        var on = s.dataset.side === side;
        s.classList.toggle("active", on);
      });
      // A focus from another faction's tree means nothing in this one.
      Object.keys(scenes).forEach(function (k) { scenes[k].exit(); });
      closeResults();
    }
    tabs.forEach(function (t) {
      t.addEventListener("click", function () { selectSide(t.dataset.tab); });
    });
    function activeScene() {
      for (var i = 0; i < sections.length; i++) {
        if (sections[i].classList.contains("active")) return scenes[sections[i].dataset.side];
      }
      return null;
    }

    // --- Per-scene pan/zoom, hover highlight and click to focus --------------
    sections.forEach(function (section) {
      var svg = section.querySelector("svg.scene");
      if (!svg) return;
      var wrap = svg.parentNode;
      var stage = section.querySelector(".stage");
      var detail = section.querySelector(".detail");
      var w = parseFloat(svg.dataset.w) || 1;
      var h = parseFloat(svg.dataset.h) || 1;
      var vb = { x: 0, y: 0, w: w, h: h };
      var view = wrap.querySelector(".minimap-view");
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

      // Drag to pan. The pointer is only captured once it has moved a few
      // pixels: capturing on press would retarget the click that follows to
      // the svg, and a click on a unit would never reach the unit.
      var drag = null;
      var moved = false;
      var suppressClick = false;
      svg.addEventListener("pointerdown", function (e) {
        drag = { x: e.clientX, y: e.clientY, vx: vb.x, vy: vb.y };
        moved = false;
        suppressClick = false;
      });
      svg.addEventListener("pointermove", function (e) {
        if (!drag) return;
        if (!moved) {
          if (Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 4) return;
          moved = true;
          svg.classList.add("grabbing");
          try { svg.setPointerCapture(e.pointerId); } catch (_) {}
        }
        var rect = svg.getBoundingClientRect();
        vb.x = drag.vx - ((e.clientX - drag.x) / rect.width) * vb.w;
        vb.y = drag.vy - ((e.clientY - drag.y) / rect.height) * vb.h;
        apply();
      });
      function endDrag(e) {
        if (!drag) return;
        if (moved) {
          suppressClick = true;
          svg.classList.remove("grabbing");
          try { svg.releasePointerCapture(e.pointerId); } catch (_) {}
        }
        drag = null;
        moved = false;
      }
      svg.addEventListener("pointerup", endDrag);
      svg.addEventListener("pointercancel", endDrag);

      // Click the minimap to centre the viewport there.
      var mini = wrap.querySelector(".minimap");
      if (mini) {
        mini.addEventListener("click", function (e) {
          var rect = mini.getBoundingClientRect();
          vb.x = (e.clientX - rect.left) / rect.width * w - vb.w / 2;
          vb.y = (e.clientY - rect.top) / rect.height * h - vb.h / 2;
          apply();
        });
      }

      var edges = Array.prototype.slice.call(svg.querySelectorAll(".edge"));
      edges.forEach(function (ed) { ed.setAttribute("data-d0", ed.getAttribute("d")); });
      var nodes = {};
      var items = [];
      each(svg.querySelectorAll(".node"), function (n) {
        nodes[n.dataset.id] = n;
        items.push({ id: n.dataset.id, label: n.getAttribute("aria-label") || n.dataset.id });
      });
      var templates = {};
      each(stage.querySelectorAll("template[data-id]"), function (t) { templates[t.dataset.id] = t; });

      // Hover shows a unit's connections and dims the rest. While a unit is
      // focused, its own connections stay lit when nothing is hovered.
      var focused = null;
      var hovered = null;
      function paint() {
        svg.classList.remove("hi");
        edges.forEach(function (ed) { ed.classList.remove("builds", "builtby"); });
        Object.keys(nodes).forEach(function (k) { nodes[k].classList.remove("on"); });
        var id = hovered !== null ? hovered : focused;
        if (id === null) return;
        if (hovered !== null) svg.classList.add("hi");
        var on = {};
        on[id] = true;
        edges.forEach(function (ed) {
          if (ed.dataset.src === id) { ed.classList.add("builds"); on[ed.dataset.tgt] = true; }
          else if (ed.dataset.tgt === id) { ed.classList.add("builtby"); on[ed.dataset.src] = true; }
        });
        Object.keys(on).forEach(function (k) { if (nodes[k]) nodes[k].classList.add("on"); });
      }

      // What a unit builds and what builds it, each in id order.
      function neighbours(id) {
        var builds = [];
        var builtBy = [];
        edges.forEach(function (ed) {
          var s = ed.dataset.src;
          var t = ed.dataset.tgt;
          if (s === id && t !== id && nodes[t] && builds.indexOf(t) === -1) builds.push(t);
        });
        edges.forEach(function (ed) {
          var s = ed.dataset.src;
          var t = ed.dataset.tgt;
          if (t === id && s !== id && nodes[s] && builds.indexOf(s) === -1 && builtBy.indexOf(s) === -1) builtBy.push(s);
        });
        builds.sort();
        builtBy.sort();
        return { builds: builds, builtBy: builtBy };
      }

      function showDetail(id) {
        detail.textContent = "";
        var close = document.createElement("button");
        close.type = "button";
        close.className = "detail-close";
        close.setAttribute("aria-label", "Close unit details");
        close.textContent = "\\u00d7";
        close.addEventListener("click", exitFocus);
        var body = document.createElement("div");
        body.className = "detail-body";
        if (templates[id]) body.appendChild(templates[id].content.cloneNode(true));
        detail.appendChild(close);
        detail.appendChild(body);
        detail.hidden = false;
      }

      // Frame a rectangle of scene space, keeping the scene's aspect ratio and
      // never zooming in past one scene unit per pixel.
      function fit(x0, y0, x1, y1) {
        var bw = x1 - x0;
        var bh = y1 - y0;
        var fw = Math.min(w * 4, Math.max(w * 0.05, bw, bh * (w / h)));
        var fh = fw * (h / w);
        var rect = svg.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          var scale = Math.min(rect.width / fw, rect.height / fh);
          if (scale > 1) { fw *= scale; fh *= scale; }
        }
        vb.x = x0 + bw / 2 - fw / 2;
        vb.y = y0 + bh / 2 - fh / 2;
        vb.w = fw;
        vb.h = fh;
        apply();
      }

      function focusUnit(id) {
        if (!nodes[id]) return;
        var nb = neighbours(id);
        var inSet = {};
        inSet[id] = true;
        nb.builds.concat(nb.builtBy).forEach(function (k) { inSet[k] = true; });
        var pos = layoutFocus(id, nb.builds, nb.builtBy);
        var x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        Object.keys(nodes).forEach(function (k) {
          var n = nodes[k];
          if (inSet[k]) {
            var p = pos[k];
            n.classList.remove("off");
            n.setAttribute("tabindex", "0");
            n.removeAttribute("aria-hidden");
            n.setAttribute("transform", "translate(" + p.x + "," + p.y + ")");
            x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
            x1 = Math.max(x1, p.x + NODE_W); y1 = Math.max(y1, p.y + NODE_H);
          } else {
            n.classList.add("off");
            n.setAttribute("tabindex", "-1");
            n.setAttribute("aria-hidden", "true");
          }
        });
        edges.forEach(function (ed) {
          var s = ed.dataset.src;
          var t = ed.dataset.tgt;
          if (inSet[s] && inSet[t]) {
            ed.classList.remove("off");
            ed.setAttribute("d", edgePath(pos[s], pos[t]));
          } else {
            ed.classList.add("off");
          }
        });
        focused = id;
        wrap.classList.add("focus");
        showDetail(id);
        fit(x0 - FOCUS_PAD, y0 - FOCUS_PAD, x1 + FOCUS_PAD, y1 + FOCUS_PAD);
        paint();
      }

      function exitFocus() {
        if (focused === null) return;
        focused = null;
        Object.keys(nodes).forEach(function (k) {
          var n = nodes[k];
          n.classList.remove("off");
          n.setAttribute("tabindex", "0");
          n.removeAttribute("aria-hidden");
          n.setAttribute("transform", "translate(" + n.dataset.x + "," + n.dataset.y + ")");
        });
        edges.forEach(function (ed) {
          ed.classList.remove("off");
          ed.setAttribute("d", ed.getAttribute("data-d0"));
        });
        wrap.classList.remove("focus");
        detail.hidden = true;
        detail.textContent = "";
        vb.x = 0; vb.y = 0; vb.w = w; vb.h = h;
        apply();
        paint();
      }

      // One listener for every node: a click on a unit focuses it, a click on
      // the empty scene leaves focus. A click that ends a pan does neither.
      svg.addEventListener("click", function (e) {
        if (suppressClick) { suppressClick = false; return; }
        var node = e.target && e.target.closest ? e.target.closest(".node") : null;
        if (node) focusUnit(node.dataset.id);
        else exitFocus();
      });

      Object.keys(nodes).forEach(function (id) {
        var n = nodes[id];
        n.addEventListener("mouseenter", function () { hovered = id; paint(); });
        n.addEventListener("mouseleave", function () { hovered = null; paint(); });
        n.addEventListener("focus", function () { hovered = id; paint(); });
        n.addEventListener("blur", function () { hovered = null; paint(); });
        n.addEventListener("keydown", function (e) {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            focusUnit(id);
          }
        });
      });

      scenes[section.dataset.side] = {
        focusUnit: focusUnit,
        exit: exitFocus,
        isFocused: function () { return focused !== null; },
        items: items
      };
    });

    // Escape leaves focus mode (the search box handles its own Escape first).
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var s = activeScene();
      if (s) s.exit();
    });

    // --- Unit search: picking a result focuses that unit ---------------------
    var input = document.getElementById("unit-search");
    var list = document.getElementById("unit-search-results");
    if (input && list) {
      var results = [];
      var current = 0;
      closeResults = function () {
        list.hidden = true;
        list.textContent = "";
        results = [];
        input.setAttribute("aria-expanded", "false");
        input.removeAttribute("aria-activedescendant");
      };
      var mark = function () {
        each(list.children, function (li, i) {
          li.setAttribute("aria-selected", String(i === current));
          if (i === current) input.setAttribute("aria-activedescendant", li.id);
        });
      };
      var pick = function (id) {
        var s = activeScene();
        input.value = "";
        closeResults();
        if (s) s.focusUnit(id);
      };
      var refresh = function () {
        var s = activeScene();
        var q = input.value;
        if (!s || !q.trim()) { closeResults(); return; }
        results = searchItems(q, s.items);
        current = 0;
        list.textContent = "";
        if (results.length === 0) {
          var none = document.createElement("li");
          none.className = "none";
          none.textContent = "No units match.";
          list.appendChild(none);
        }
        results.forEach(function (r, i) {
          var li = document.createElement("li");
          li.id = "unit-search-option-" + i;
          li.setAttribute("role", "option");
          li.dataset.id = r.id;
          var name = document.createElement("span");
          name.className = "name";
          name.textContent = r.label;
          var key = document.createElement("span");
          key.className = "key";
          key.textContent = r.id;
          li.appendChild(name);
          li.appendChild(key);
          // mousedown, so the pick lands before the input loses focus.
          li.addEventListener("mousedown", function (e) { e.preventDefault(); pick(r.id); });
          list.appendChild(li);
        });
        list.hidden = false;
        input.setAttribute("aria-expanded", "true");
        mark();
      };
      input.addEventListener("input", refresh);
      input.addEventListener("focus", refresh);
      input.addEventListener("blur", closeResults);
      input.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && input.value !== "") {
          e.stopPropagation();
          input.value = "";
          closeResults();
        } else if (e.key === "ArrowDown" && results.length > 0) {
          e.preventDefault();
          current = (current + 1) % results.length;
          mark();
        } else if (e.key === "ArrowUp" && results.length > 0) {
          e.preventDefault();
          current = (current - 1 + results.length) % results.length;
          mark();
        } else if (e.key === "Enter" && results[current]) {
          e.preventDefault();
          pick(results[current].id);
        }
      });
    }
  });
})();
`;
