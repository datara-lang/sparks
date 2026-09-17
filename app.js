// Sparks Package Registry web catalog - entry point.
//
// The catalog is split into focused modules under src/. Load order is declared
// explicitly in index.html, and each module attaches exactly one surface to the
// shared `Sparks` namespace:
//
//   src/core.js       namespace, configuration, SVG icon builders
//   src/util.js       storage, escaping, formatting, clipboard, toasts
//   src/markdown.js   safe Markdown renderer
//   src/store.js      observable application state
//   src/registry.js   index.json and per-version manifest transport
//   src/counters.js   public community counter + local counters
//   src/catalog.js    the package grid
//   src/modal.js      the package detail modal
//   src/generator.js  the Schema 1 manifest generator
//   src/actions.js    delegated event wiring
//
// This file only boots the modules; it holds no application logic.
//
// Visual policy: every icon is inline SVG. No emoji glyph appears anywhere in
// this project's web assets.
//
// Data honesty policy: the catalog renders only values it can source - a
// measured counter, a value published in the manifest (labelled as unverified),
// or an explicit placeholder. It never invents a number.

(function (Sparks) {
  'use strict';

  var booted = false;

  function boot() {
    if (booted) return;
    booted = true;

    // Order matters: the catalog subscribes to the store and paints the
    // initial (loading) state before the first network request goes out.
    Sparks.catalog.init();
    Sparks.modal.init();
    Sparks.counters.init();
    Sparks.actions.init();
    Sparks.generator.init();

    Sparks.registry.loadIndex();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  Sparks.boot = boot;
})(window.Sparks);
