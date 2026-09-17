/* Sparks catalog - namespace, configuration and icon set.
 *
 * LOAD ORDER: this file must be evaluated before every other web script. It
 * creates the single `Sparks` namespace that the rest of the catalog attaches
 * to.
 *
 * Why classic scripts instead of ES modules: a `<script type="module">` is
 * fetched with CORS semantics, and browsers refuse module fetches from a
 * `file://` origin. Opening index.html straight from disk is a supported path
 * (see renderFallback in catalog.js), so the catalog stays buildless and
 * classic. Each file is an IIFE that publishes exactly one named surface on
 * `Sparks`; nothing else leaks into the global scope.
 *
 * Visual policy: every icon is inline SVG produced by the builders below. No
 * emoji glyph is used in this file, in any other script, in index.html or in
 * styles.css. Icon markup is built from constant strings and is never derived
 * from package data.
 */

window.Sparks = window.Sparks || {};

(function (Sparks) {
  'use strict';

  Sparks.VERSION = '1.4.3';

  Sparks.CONFIG = {
    indexUrl: 'index.json',
    packagesDir: 'packages/',
    tarballsDir: 'tarballs/',

    // Prefix for every localStorage key this catalog owns. `sparks_like_` is
    // kept for favourites on purpose: it is the prefix earlier releases used,
    // so existing bookmarks survive this refactor instead of silently
    // disappearing.
    storagePrefix: 'sparks_',

    // Community counter. Reads and increments go to a public, CORS-enabled
    // counter service (Abacus). It is deliberately optional: when the endpoint
    // is unreachable the catalog degrades to values it can prove locally and
    // never fabricates a number.
    //
    // The namespace is scoped to this catalog so it can never collide with
    // another Sparks deployment. scripts/init_counters.py provisions every key
    // at 0; the service answers 404 for a key nobody has incremented yet, which
    // the catalog reads as a measured zero, but browsers log those 404s as
    // console errors, so provisioning keeps a page load clean.
    counter: {
      enabled: true,
      endpoint: 'https://abacus.jasoncameron.dev',
      namespace: 'datara-sparks-catalog',
      timeoutMs: 4000,
      maxConcurrent: 4,
      failureCooldownMs: 60000,
      rateLimitCooldownMs: 15000
    }
  };

  /* ---------------------------------------------------------------- *
   * Icon builders (constant geometry, size-parameterised)
   * ---------------------------------------------------------------- */

  var HEART_PATH = '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>';
  var DOWNLOAD_PATH = '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line>';
  var COPY_PATH = '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>';
  var CHECK_PATH = '<polyline points="20 6 9 17 4 12"></polyline>';
  var SHIELD_PATH = '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>';
  var KEY_PATH = '<path d="M21 2l-2 2m-1.5 1.5L14 9l-3-3 2-2 1.5 1.5L18 4l3-2z"></path><circle cx="7.5" cy="15.5" r="5.5"></circle>';

  // Wraps a path body in the shared 24x24 stroke geometry.
  function icon(size, body, strokeWidth) {
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" fill="none" '
      + 'stroke="currentColor" stroke-width="' + (strokeWidth || 2) + '" stroke-linecap="round" '
      + 'stroke-linejoin="round" aria-hidden="true" focusable="false">' + body + '</svg>';
  }

  Sparks.ICONS = {
    // The only icon with a fill toggle: the favourite control flips between an
    // outlined and a solid heart. The 40px empty-state variant is drawn with a
    // thinner stroke so it does not read as a solid blob at that size.
    heart: function (size, filled, strokeWidth) {
      return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 24 24" '
        + 'fill="' + (filled ? 'currentColor' : 'none') + '" stroke="currentColor" '
        + 'stroke-width="' + (strokeWidth || 2) + '" '
        + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">'
        + HEART_PATH + '</svg>';
    },
    download: function (size) { return icon(size, DOWNLOAD_PATH, 2.5); },
    copy: function (size) { return icon(size, COPY_PATH, 2); },
    check: function (size) { return icon(size, CHECK_PATH, 2.5); },
    shield: function (size) { return icon(size, SHIELD_PATH, 2); },
    key: function (size) { return icon(size, KEY_PATH, 2); }
  };
})(window.Sparks);
