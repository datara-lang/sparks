/* Sparks catalog - download and appreciation counters.
 *
 * Two independent layers, and the UI always says which one it is showing:
 *
 *   1. Public community counter (Abacus, https://abacus.jasoncameron.dev).
 *      A real, shared number: every visitor reads the same value and every
 *      download or first-time favourite adds one. It is a third-party service,
 *      so it is treated as best-effort - the catalog keeps working without it.
 *
 *   2. Local, per-browser state (localStorage).
 *      Favourites (personal bookmarks) and the number of downloads this browser
 *      recorded. This never leaves the machine and is never presented as a
 *      global figure.
 *
 * Honesty rules enforced here:
 *   - A value is only ever reported as "public" when the service actually
 *     answered. A 404 from the service means "nobody has counted yet", which is
 *     a measured zero - not a missing value.
 *   - When the service is unreachable the catalog falls back to the value the
 *     manifest publishes and labels it as unverified. It never invents a number
 *     and never silently adds a claimed figure to a measured one.
 *   - The public counter has no decrement endpoint, so an appreciation is
 *     monotonic. Un-favouriting removes the local bookmark; it does not retract
 *     the contribution, and the UI does not pretend otherwise.
 */

(function (Sparks) {
  'use strict';

  var CONFIG = Sparks.CONFIG;
  var util = Sparks.util;
  var store = Sparks.store;

  var FAVOURITE_PREFIX = util.storageKey('like_');
  var LOCAL_DOWNLOAD_PREFIX = util.storageKey('dl_');
  var CONTRIBUTION_PREFIX = util.storageKey('contrib_');

  var KIND_DOWNLOAD = 'dl';
  var KIND_LIKE = 'like';

  var publicCounts = new Map();    // counter key -> measured number
  var publicFailUntil = new Map(); // counter key -> epoch ms of the next retry
  var publicInflight = new Map();  // counter key -> in-flight promise
  var rateLimitedUntil = 0;
  var successes = 0;
  var failures = 0;

  // Bounded request queue: the service allows 30 requests per 10 seconds per
  // IP, and a catalog page reads two counters per visible package.
  var active = 0;
  var queue = [];

  function schedule(task) {
    return new Promise(function (resolve, reject) {
      queue.push({ task: task, resolve: resolve, reject: reject });
      pump();
    });
  }

  function pump() {
    while (active < CONFIG.counter.maxConcurrent && queue.length) {
      (function (job) {
        active += 1;
        job.task().then(job.resolve, job.reject).then(function () {
          active -= 1;
          pump();
        });
      })(queue.shift());
    }
  }

  /* ---------------------------------------------------------------- *
   * Transport
   * ---------------------------------------------------------------- */

  // The service accepts keys matching ^[A-Za-z0-9_-.]{3,64}$.
  function counterKey(kind, pkgName) {
    var slug = util.rawPackageId(pkgName).replace(/[^A-Za-z0-9_.-]/g, '_');
    if (!slug) slug = 'unknown';
    return (kind + '_' + slug).slice(0, 64);
  }

  function counterUrl(action, key) {
    return CONFIG.counter.endpoint + '/' + action + '/'
      + encodeURIComponent(CONFIG.counter.namespace) + '/'
      + encodeURIComponent(key);
  }

  function requestJson(url) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = null;
    if (controller) {
      timer = setTimeout(function () { controller.abort(); }, CONFIG.counter.timeoutMs);
    }

    var options = controller ? { signal: controller.signal, cache: 'no-store' } : { cache: 'no-store' };

    function stopTimer() {
      if (timer !== null && typeof clearTimeout === 'function') clearTimeout(timer);
      timer = null;
    }

    return fetch(url, options).then(function (res) {
      return res.json().then(
        function (body) { return { status: res.status, ok: res.ok, body: body }; },
        function () { return { status: res.status, ok: res.ok, body: null }; }
      );
    }).then(function (result) {
      stopTimer();
      return result;
    }, function (err) {
      stopTimer();
      throw err;
    });
  }

  function recordFailure(key, detail) {
    failures += 1;
    publicFailUntil.set(key, Date.now() + CONFIG.counter.failureCooldownMs);
    store.emitSoon('counter-status');
    console.warn('Community counter unavailable for "' + key + '": ' + detail);
    return null;
  }

  function recordSuccess(key, value) {
    publicCounts.set(key, value);
    publicFailUntil.delete(key);
    successes += 1;
    store.emitSoon('counters');
    return value;
  }

  /* ---------------------------------------------------------------- *
   * Public counter
   * ---------------------------------------------------------------- */

  function readPublicCount(kind, pkgName) {
    var counter = CONFIG.counter;
    if (!counter.enabled || !pkgName) return Promise.resolve(null);

    var key = counterKey(kind, pkgName);
    if (publicCounts.has(key)) return Promise.resolve(publicCounts.get(key));
    if (publicInflight.has(key)) return publicInflight.get(key);
    if (Date.now() < rateLimitedUntil) return Promise.resolve(null);

    var failUntil = publicFailUntil.get(key);
    if (failUntil && Date.now() < failUntil) return Promise.resolve(null);

    var request = schedule(function () {
      return requestJson(counterUrl('get', key));
    }).then(function (result) {
      if (result.ok && result.body && typeof result.body.value === 'number') {
        return recordSuccess(key, result.body.value);
      }
      if (result.status === 404) {
        // The service answers 404 for a key nobody has incremented yet. That is
        // a measured zero, not an unknown value.
        return recordSuccess(key, 0);
      }
      if (result.status === 429) {
        rateLimitedUntil = Date.now() + counter.rateLimitCooldownMs;
      }
      return recordFailure(key, 'HTTP ' + result.status);
    }).catch(function (err) {
      return recordFailure(key, err && err.message ? err.message : String(err));
    }).then(function (value) {
      publicInflight.delete(key);
      return value;
    });

    publicInflight.set(key, request);
    return request;
  }

  function bumpPublicCount(kind, pkgName) {
    var counter = CONFIG.counter;
    if (!counter.enabled || !pkgName) return Promise.resolve(null);

    var key = counterKey(kind, pkgName);
    return schedule(function () {
      return requestJson(counterUrl('hit', key));
    }).then(function (result) {
      if (result.ok && result.body && typeof result.body.value === 'number') {
        return recordSuccess(key, result.body.value);
      }
      if (result.status === 429) {
        rateLimitedUntil = Date.now() + counter.rateLimitCooldownMs;
      }
      failures += 1;
      return null;
    }).catch(function () {
      failures += 1;
      return null;
    });
  }

  // Synchronous read of what is already known. Returns null when the public
  // value is genuinely unknown, which is different from a measured zero.
  function cachedPublicCount(kind, pkgName) {
    if (!CONFIG.counter.enabled || !pkgName) return null;
    var key = counterKey(kind, pkgName);
    return publicCounts.has(key) ? publicCounts.get(key) : null;
  }

  // Requests the counters for the packages currently on screen. Cached keys
  // resolve immediately, so calling this on every render costs nothing.
  function ensureStats(packages) {
    if (!CONFIG.counter.enabled) return;
    (packages || []).forEach(function (pkg) {
      if (!pkg || !pkg.name) return;
      readPublicCount(KIND_DOWNLOAD, pkg.name);
      readPublicCount(KIND_LIKE, pkg.name);
    });
  }

  function counterStatus() {
    if (!CONFIG.counter.enabled) {
      return { state: 'disabled', label: 'Community counter disabled' };
    }
    if (Date.now() < rateLimitedUntil) {
      return { state: 'throttled', label: 'Community counter rate-limited, retrying shortly' };
    }
    if (successes === 0 && failures > 0) {
      return { state: 'unavailable', label: 'Community counter unavailable, showing published data only' };
    }
    if (successes > 0) {
      return { state: 'live', label: 'Community counter live' };
    }
    return { state: 'connecting', label: 'Community counter connecting' };
  }

  /* ---------------------------------------------------------------- *
   * Honest statistics
   * ---------------------------------------------------------------- */

  function downloadStat(pkg) {
    if (!pkg) return { value: 0, source: 'none', sourceLabel: 'no data', title: '' };

    var measured = cachedPublicCount(KIND_DOWNLOAD, pkg.name);
    var published = Number(pkg.downloads) || 0;
    var local = util.readCount(LOCAL_DOWNLOAD_PREFIX + pkg.name);
    var stat;

    if (measured !== null) {
      stat = { value: measured, source: 'public', sourceLabel: 'public counter' };
    } else if (published > 0) {
      stat = { value: published, source: 'manifest', sourceLabel: 'manifest, unverified' };
    } else {
      stat = { value: 0, source: 'none', sourceLabel: 'no data' };
    }

    var parts = [];
    if (stat.source === 'public') {
      parts.push('Measured by the public community counter: ' + util.formatNumber(measured) + ' install events.');
    } else if (stat.source === 'manifest') {
      parts.push('The manifest claims ' + util.formatNumber(published) + ' downloads. No independent measurement is available.');
    } else {
      parts.push('Neither the manifest nor the public counter reports downloads for this spark yet.');
    }
    if (stat.source === 'public' && published > 0) {
      parts.push('The manifest separately claims ' + util.formatNumber(published) + ', which is not verified.');
    }
    if (local > 0) {
      parts.push('You recorded ' + local + ' in this browser.');
    }
    stat.title = parts.join(' ');
    return stat;
  }

  function likeStat(pkg) {
    if (!pkg) return { value: 0, source: 'none', sourceLabel: 'no data' };

    var measured = cachedPublicCount(KIND_LIKE, pkg.name);
    var published = Number(pkg.likes) || 0;

    if (measured !== null) return { value: measured, source: 'public', sourceLabel: 'public counter' };
    if (published > 0) return { value: published, source: 'manifest', sourceLabel: 'manifest, unverified' };
    return { value: 0, source: 'none', sourceLabel: 'no data' };
  }

  /* ---------------------------------------------------------------- *
   * Favourites (local bookmarks) + appreciation contribution
   * ---------------------------------------------------------------- */

  function isFavourite(pkgName) {
    return util.safeStorage.get(FAVOURITE_PREFIX + pkgName) === '1';
  }

  function favouriteNames() {
    return store.state.packages
      .filter(function (pkg) { return isFavourite(pkg.name); })
      .map(function (pkg) { return pkg.name; });
  }

  // One appreciation per browser per package. The guard is cleared when the
  // contribution could not be delivered, so a later attempt can still land.
  function contributeAppreciation(pkgName) {
    var guard = CONTRIBUTION_PREFIX + pkgName;
    if (util.safeStorage.get(guard) === '1') return;
    util.safeStorage.set(guard, '1');
    bumpPublicCount(KIND_LIKE, pkgName).then(function (value) {
      if (value === null) util.safeStorage.remove(guard);
    });
  }

  function toggleFavourite(pkgName) {
    if (!pkgName) return false;

    var willFavourite = !isFavourite(pkgName);
    if (willFavourite) {
      util.safeStorage.set(FAVOURITE_PREFIX + pkgName, '1');
      contributeAppreciation(pkgName);
    } else {
      util.safeStorage.remove(FAVOURITE_PREFIX + pkgName);
    }

    store.emit('favourites');
    return willFavourite;
  }

  function localDownloadCount(pkgName) {
    return util.readCount(LOCAL_DOWNLOAD_PREFIX + pkgName);
  }

  // Records the click locally and contributes to the public counter. The store
  // change is deferred on purpose: re-rendering the grid synchronously would
  // replace the anchor element in the middle of its own click event.
  function trackDownload(pkgName) {
    if (!pkgName) return 0;
    var local = util.bumpStoredCount(LOCAL_DOWNLOAD_PREFIX + pkgName);
    bumpPublicCount(KIND_DOWNLOAD, pkgName);
    store.emitSoon('counters');
    return local;
  }

  /* ---------------------------------------------------------------- *
   * Status indicator
   * ---------------------------------------------------------------- */

  function renderStatus() {
    var status = counterStatus();
    var el = document.getElementById('counter-status');
    if (el) el.setAttribute('data-state', status.state);
    util.setText('counter-status-text', status.label);
  }

  function init() {
    store.subscribe(function (reason) {
      var text = String(reason);
      if (text.indexOf('counter') >= 0 || text.indexOf('index') >= 0) renderStatus();
    });
    renderStatus();
  }

  Sparks.counters = {
    KINDS: { download: KIND_DOWNLOAD, like: KIND_LIKE },
    counterKey: counterKey,
    readPublicCount: readPublicCount,
    bumpPublicCount: bumpPublicCount,
    cachedPublicCount: cachedPublicCount,
    ensureStats: ensureStats,
    counterStatus: counterStatus,
    downloadStat: downloadStat,
    likeStat: likeStat,
    isFavourite: isFavourite,
    favouriteNames: favouriteNames,
    toggleFavourite: toggleFavourite,
    localDownloadCount: localDownloadCount,
    trackDownload: trackDownload,
    renderStatus: renderStatus,
    init: init
  };
})(window.Sparks);
