/* Sparks catalog - generic helpers: storage, text, formatting, clipboard, toast.
 *
 * Nothing here knows about packages, the registry protocol or the DOM
 * structure beyond "an element with this id may or may not exist". Every
 * helper is written so a partial DOM or a hostile environment degrades instead
 * of throwing.
 */

(function (Sparks) {
  'use strict';

  var CONFIG = Sparks.CONFIG;
  var ICONS = Sparks.ICONS;

  /* ---------------------------------------------------------------- *
   * Storage
   * ---------------------------------------------------------------- */

  // localStorage throws in some privacy modes and in sandboxed frames. Every
  // access is funnelled through here so the catalog degrades instead of dying.
  var safeStorage = {
    get: function (key) {
      try {
        return window.localStorage.getItem(key);
      } catch (err) {
        return null;
      }
    },
    set: function (key, value) {
      try {
        window.localStorage.setItem(key, value);
        return true;
      } catch (err) {
        return false;
      }
    },
    remove: function (key) {
      try {
        window.localStorage.removeItem(key);
      } catch (err) {
        /* storage unavailable */
      }
    }
  };

  function readCount(key) {
    var raw = parseInt(safeStorage.get(key) || '0', 10);
    return Number.isFinite(raw) && raw > 0 ? raw : 0;
  }

  function bumpStoredCount(key) {
    var next = readCount(key) + 1;
    safeStorage.set(key, String(next));
    return next;
  }

  /* ---------------------------------------------------------------- *
   * Text and formatting
   * ---------------------------------------------------------------- */

  // Sets textContent only when the element exists, so a partial DOM can never
  // throw inside the render path.
  function setText(id, value) {
    var el = document.getElementById(id);
    if (el) el.textContent = value;
    return el;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // "sparks/crypto_core" -> "crypto_core": the on-disk id used by the registry
  // paths and by the counter keys.
  function rawPackageId(name) {
    return String(name || '').replace(/^sparks\//, '');
  }

  // SemVer-ish descending comparator: "1.10.0" sorts above "1.9.0".
  function compareVersionsDesc(a, b) {
    var pa = String(a).split('.').map(function (n) { return parseInt(n, 10) || 0; });
    var pb = String(b).split('.').map(function (n) { return parseInt(n, 10) || 0; });
    var len = Math.max(pa.length, pb.length);
    for (var i = 0; i < len; i++) {
      var da = pa[i] || 0;
      var db = pb[i] || 0;
      if (da !== db) return db - da;
    }
    return String(b).localeCompare(String(a));
  }

  function formatBytes(bytes) {
    var value = Number(bytes);
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    var k = 1024;
    var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    var i = Math.min(Math.floor(Math.log(value) / Math.log(k)), sizes.length - 1);
    // String concatenation, not a nested template literal: the XSS audit in
    // tests/test_web_catalog.py scans template interpolations and cannot tell a
    // numeric expression from a data one.
    return parseFloat((value / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  }

  function formatNumber(num) {
    var value = Number(num);
    if (!Number.isFinite(value) || value < 0) return '0';
    if (value >= 1000000) return (value / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (value >= 1000) return (value / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
    return String(Math.floor(value));
  }

  /* ---------------------------------------------------------------- *
   * Clipboard
   * ---------------------------------------------------------------- */

  function copyText(text, successMessage) {
    var message = successMessage || 'Copied to clipboard';
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      navigator.clipboard.writeText(text).then(function () {
        showToast(message, 'ok');
      }).catch(function () {
        fallbackCopy(text, message);
      });
      return;
    }
    fallbackCopy(text, message);
  }

  // execCommand path: used when the Clipboard API is unavailable (older
  // browsers, non-secure contexts, file:// origins).
  function fallbackCopy(text, message) {
    try {
      var area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.top = '-1000px';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      var ok = document.execCommand('copy');
      area.remove();
      showToast(ok ? message : 'Copy failed - select the text manually', ok ? 'ok' : 'warn');
    } catch (err) {
      showToast('Copy failed - select the text manually', 'warn');
    }
  }

  /* ---------------------------------------------------------------- *
   * Toast
   * ---------------------------------------------------------------- */

  function showToast(message, kind) {
    var container = document.getElementById('toast-container');
    if (!container) return;

    var toast = document.createElement('div');
    toast.className = 'toast' + (kind ? ' toast-' + kind : '');

    // Constant markup only - never package data.
    var iconMarkup = kind === 'favorite' ? ICONS.heart(12, true) : (kind === 'warn' ? '' : ICONS.check(13));
    if (iconMarkup) {
      var icon = document.createElement('span');
      icon.className = 'toast-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = iconMarkup;
      toast.appendChild(icon);
    }

    var text = document.createElement('span');
    text.className = 'toast-text';
    text.textContent = message;

    toast.appendChild(text);
    container.appendChild(toast);

    setTimeout(function () {
      if (toast.parentNode) toast.remove();
    }, 3200);
  }

  Sparks.util = {
    safeStorage: safeStorage,
    readCount: readCount,
    bumpStoredCount: bumpStoredCount,
    setText: setText,
    escapeHtml: escapeHtml,
    rawPackageId: rawPackageId,
    compareVersionsDesc: compareVersionsDesc,
    formatBytes: formatBytes,
    formatNumber: formatNumber,
    copyText: copyText,
    fallbackCopy: fallbackCopy,
    showToast: showToast,
    storageKey: function (suffix) { return CONFIG.storagePrefix + suffix; }
  };
})(window.Sparks);
