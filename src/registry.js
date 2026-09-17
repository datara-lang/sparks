/* Sparks catalog - registry transport: root index and per-version manifests.
 *
 * The catalog reads exactly two kinds of endpoint, both static JSON:
 *   index.json                              - the whole index
 *   packages/<id>/<version>.json            - one release manifest
 *
 * Nothing is invented. A manifest that cannot be fetched is recorded as
 * unavailable (cached as `null`) and the UI shows an explicit placeholder
 * instead of a plausible-looking size or digest.
 */

(function (Sparks) {
  'use strict';

  var CONFIG = Sparks.CONFIG;
  var util = Sparks.util;
  var store = Sparks.store;

  // "<package>@<version>" -> manifest object, or null when the fetch failed.
  // `null` is cached on purpose so a broken endpoint is not retried in a loop.
  var manifestCache = new Map();
  // In-flight requests are tracked separately so two callers never issue the
  // same request twice.
  var manifestInflight = new Map();

  function loadIndex() {
    return fetch(CONFIG.indexUrl, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP error ' + res.status);
        return res.json();
      })
      .then(function (data) {
        store.state.packages = Array.isArray(data?.packages) ? data.packages : [];
        store.state.indexLoaded = true;
        store.state.indexError = null;
        util.setText('metric-packages-count', String(store.state.packages.length));
        store.emit('index');
        return store.state.packages;
      })
      .catch(function (err) {
        console.error('Failed to load ' + CONFIG.indexUrl + ':', err);
        store.state.indexLoaded = false;
        store.state.indexError = err;
        store.emit('index-error');
        return null;
      });
  }

  function getKnownVersionManifest(pkg, version) {
    if (!pkg) return null;
    if (manifestCache.has(pkg.name + '@' + version)) return manifestCache.get(pkg.name + '@' + version);
    // index.json already carries the full manifest of the latest release.
    if (version === pkg.latest_version) return pkg;
    return null;
  }

  function fetchVersionManifest(pkg, version) {
    var cacheKey = pkg.name + '@' + version;
    if (manifestCache.has(cacheKey)) return Promise.resolve(manifestCache.get(cacheKey));
    if (manifestInflight.has(cacheKey)) return manifestInflight.get(cacheKey);

    var url = CONFIG.packagesDir
      + encodeURIComponent(util.rawPackageId(pkg.name)) + '/'
      + encodeURIComponent(version) + '.json';

    var request = fetch(url, { cache: 'no-cache' })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(function (data) {
        manifestCache.set(cacheKey, data);
        return data;
      })
      .catch(function (err) {
        console.warn('Version manifest unavailable: ' + url, err);
        manifestCache.set(cacheKey, null);
        return null;
      })
      .then(function (result) {
        manifestInflight.delete(cacheKey);
        return result;
      });

    manifestInflight.set(cacheKey, request);
    return request;
  }

  // True while a non-latest version manifest is still being fetched, so the UI
  // can say "loading" rather than "not published".
  function isManifestPending(pkg, version) {
    if (!pkg) return false;
    if (version === pkg.latest_version) return false;
    return !manifestCache.has(pkg.name + '@' + version);
  }

  function getVersionList(pkg) {
    var raw = Array.isArray(pkg.versions) && pkg.versions.length
      ? pkg.versions
      : (Array.isArray(pkg.all_versions) && pkg.all_versions.length ? pkg.all_versions : [pkg.latest_version]);
    return raw.slice().sort(util.compareVersionsDesc);
  }

  function tarballUrl(pkg, version) {
    var file = util.rawPackageId(pkg.name) + '-' + version + '.tar';
    return { href: CONFIG.tarballsDir + file, filename: file };
  }

  Sparks.registry = {
    loadIndex: loadIndex,
    fetchVersionManifest: fetchVersionManifest,
    getKnownVersionManifest: getKnownVersionManifest,
    isManifestPending: isManifestPending,
    getVersionList: getVersionList,
    tarballUrl: tarballUrl
  };
})(window.Sparks);
