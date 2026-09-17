/* Sparks catalog - package detail modal.
 *
 * Shows only what the registry actually publishes. A release manifest that has
 * not been fetched yet renders as "loading", a manifest that failed renders as
 * "not published", and a determinism receipt is shown only when the publisher
 * included one - the catalog never synthesises a receipt, a digest or a size.
 */

(function (Sparks) {
  'use strict';

  var ICONS = Sparks.ICONS;
  var util = Sparks.util;
  var store = Sparks.store;
  var counters = Sparks.counters;
  var registry = Sparks.registry;

  var escapeHtml = util.escapeHtml;
  var formatBytes = util.formatBytes;
  var formatNumber = util.formatNumber;
  var setText = util.setText;

  var TABS = ['readme', 'overview', 'versions', 'security', 'manifest'];

  /* ---------------------------------------------------------------- *
   * Open / close
   * ---------------------------------------------------------------- */

  function open(packageName) {
    var pkg = store.findPackage(packageName);
    if (!pkg) return;

    var state = store.state;
    state.modalPackage = pkg;
    state.modalVersion = pkg.latest_version;

    var versions = registry.getVersionList(pkg);

    setText('modal-title', pkg.name);
    setText('modal-author', pkg.author || 'Datara Core Team');
    setText('modal-license', pkg.license || 'MIT');
    setText('modal-desc', pkg.description || '');

    var verSelect = document.getElementById('modal-version-select');
    if (verSelect) {
      verSelect.innerHTML = versions.map(function (v) {
        return '<option value="' + escapeHtml(v) + '"' + (v === pkg.latest_version ? ' selected' : '') + '>'
          + 'v' + escapeHtml(v) + (v === pkg.latest_version ? ' (latest)' : '') + '</option>';
      }).join('');
    }

    refreshFavouriteButton(pkg);
    updateVersionView(pkg, state.modalVersion);

    var readmeContainer = document.getElementById('modal-readme-body');
    if (readmeContainer) readmeContainer.innerHTML = Sparks.markdown.renderMarkdown(pkg.readme);

    hydrateVersionsTable(pkg);
    renderCapabilityAudit(pkg);

    setText('modal-sha256', pkg.sha256 || 'not published');
    setText('modal-pk', pkg.public_key
      ? pkg.public_key.slice(0, 16) + '...' + pkg.public_key.slice(-16)
      : 'not published');
    setText('modal-keyid', pkg.key_id || 'not published');
    setText('modal-receipt', buildDeterminismReceipt(pkg));

    var manifestObj = {
      schema: 1,
      name: pkg.name,
      version: pkg.latest_version,
      description: pkg.description,
      author: pkg.author,
      license: pkg.license,
      tarball_url: pkg.tarball_url,
      sha256: pkg.sha256,
      public_key: pkg.public_key,
      signature: pkg.signature,
      key_id: pkg.key_id,
      size_bytes: pkg.size_bytes,
      capabilities: pkg.capabilities || [],
      dependencies: pkg.dependencies || {},
      tags: pkg.tags || [],
      all_versions: versions
    };
    setText('modal-manifest-json', JSON.stringify(manifestObj, null, 2));

    switchTab('readme');

    state.lastFocused = document.activeElement;
    var modal = document.getElementById('package-modal');
    if (modal) {
      modal.classList.add('active');
      document.body.classList.add('modal-open');
      var closeBtn = modal.querySelector('.btn-close-modal');
      if (closeBtn) closeBtn.focus();
    }
  }

  function close() {
    var modal = document.getElementById('package-modal');
    if (modal) modal.classList.remove('active');
    document.body.classList.remove('modal-open');

    store.state.modalPackage = null;
    store.state.modalVersion = null;

    var last = store.state.lastFocused;
    if (last && typeof last.focus === 'function') last.focus();
    store.state.lastFocused = null;
  }

  function isOpen() {
    var modal = document.getElementById('package-modal');
    return Boolean(modal && modal.classList.contains('active'));
  }

  function switchTab(tabId) {
    document.querySelectorAll('.modal-tab').forEach(function (tab) {
      var isActive = tab.getAttribute('data-tab') === tabId;
      tab.classList.toggle('active', isActive);
      tab.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    TABS.forEach(function (id) {
      var el = document.getElementById('tab-content-' + id);
      if (el) el.style.display = id === tabId ? 'block' : 'none';
    });
  }

  /* ---------------------------------------------------------------- *
   * Version-dependent fields
   * ---------------------------------------------------------------- */

  function updateVersionView(pkg, version) {
    var isLatest = version === pkg.latest_version;
    var manifest = registry.getKnownVersionManifest(pkg, version);
    var pending = registry.isManifestPending(pkg, version);

    setText('modal-badge-ver', 'v' + version);

    if (manifest && manifest.size_bytes) {
      setText('modal-size', formatBytes(manifest.size_bytes));
    } else if (pending) {
      setText('modal-size', 'loading...');
    } else {
      setText('modal-size', 'not published');
    }

    var dl = counters.downloadStat(pkg);
    setText('modal-downloads', dl.value.toLocaleString() + ' \u00b7 ' + dl.sourceLabel);
    var dlEl = document.getElementById('modal-downloads');
    if (dlEl) dlEl.title = dl.title;

    refreshLikeFields(pkg);

    var tarLink = document.getElementById('modal-tar-link');
    if (tarLink) {
      var tar = registry.tarballUrl(pkg, version);
      tarLink.href = tar.href;
      tarLink.setAttribute('download', tar.filename);
      tarLink.textContent = 'Download v' + version + ' .tar';
    }

    setText('modal-install-cmd', isLatest ? 'dpm add ' + pkg.name : 'dpm add ' + pkg.name + '@' + version);

    var codeEl = document.getElementById('modal-code-example');
    if (codeEl) {
      codeEl.textContent = pkg.sample_usage
        || 'use ' + pkg.name + '\n\nfn main() {\n    // Spark v' + version + ' ignited\n}\n';
    }

    // Non-latest versions are not described by index.json: pull the manifest.
    if (!isLatest && !manifest) {
      registry.fetchVersionManifest(pkg, version).then(function (fetched) {
        if (fetched && store.state.modalPackage === pkg && store.state.modalVersion === version) {
          updateVersionView(pkg, version);
        }
      });
    }
  }

  function onVersionChange(version) {
    var pkg = store.state.modalPackage;
    if (!pkg || !version) return;
    store.state.modalVersion = version;
    updateVersionView(pkg, version);
    util.showToast(pkg.name + ' v' + version);
  }

  function onDirectDownload() {
    var pkg = store.state.modalPackage;
    if (pkg) counters.trackDownload(pkg.name);
  }

  /* ---------------------------------------------------------------- *
   * Versions table
   * ---------------------------------------------------------------- */

  function hydrateVersionsTable(pkg) {
    var tbody = document.getElementById('modal-versions-list');
    if (!tbody || !pkg) return;

    var versions = registry.getVersionList(pkg);

    tbody.innerHTML = versions.map(function (v) {
      var isLatest = v === pkg.latest_version;
      var manifest = registry.getKnownVersionManifest(pkg, v);
      var sizeText = manifest && manifest.size_bytes ? formatBytes(manifest.size_bytes) : '...';
      var shaValue = manifest && manifest.sha256 ? String(manifest.sha256) : '';
      var shaText = shaValue ? shaValue.substring(0, 16) + '...' : '...';
      var installTarget = isLatest ? pkg.name : pkg.name + '@' + v;
      var tar = registry.tarballUrl(pkg, v);
      var latestBadge = isLatest ? '<span class="badge badge-verified ver-latest-badge">latest</span>' : '';

      return `
      <tr data-version-row="${escapeHtml(v)}">
        <td>
          <span class="ver-badge">v${escapeHtml(v)}</span>
          ${latestBadge}
        </td>
        <td>
          <a href="${escapeHtml(tar.href)}" class="btn-download" download="${escapeHtml(tar.filename)}" data-action="download" data-pkg="${escapeHtml(pkg.name)}">
            ${ICONS.download(12)}
            ${escapeHtml(tar.filename)}
          </a>
        </td>
        <td class="ver-size" data-role="size">${escapeHtml(sizeText)}</td>
        <td class="sha-cell" data-role="sha" title="${escapeHtml(shaValue)}">${escapeHtml(shaText)}</td>
        <td>
          <button class="btn-card-copy btn-copy-inline" data-action="copy-install" data-pkg="${escapeHtml(pkg.name)}" data-target="${escapeHtml('dpm add ' + installTarget)}">Copy dpm add</button>
        </td>
      </tr>
    `;
    }).join('');

    // Fill in rows whose manifest is not in index.json yet.
    versions
      .filter(function (v) { return !registry.getKnownVersionManifest(pkg, v); })
      .forEach(function (v) {
        registry.fetchVersionManifest(pkg, v).then(function (manifest) {
          if (manifest) applyVersionManifest(pkg, v, manifest);
        });
      });
  }

  function applyVersionManifest(pkg, version, manifest) {
    var tbody = document.getElementById('modal-versions-list');
    if (!tbody) return;

    var rows = tbody.querySelectorAll('tr[data-version-row]');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.getAttribute('data-version-row') !== version) continue;

      var sizeCell = row.querySelector('[data-role="size"]');
      var shaCell = row.querySelector('[data-role="sha"]');

      if (sizeCell) {
        sizeCell.textContent = manifest.size_bytes ? formatBytes(manifest.size_bytes) : 'not published';
      }
      if (shaCell) {
        var sha = manifest.sha256 ? String(manifest.sha256) : '';
        shaCell.textContent = sha ? sha.substring(0, 16) + '...' : 'not published';
        shaCell.title = sha;
      }
    }

    // Refresh the metric strip if this version is the one on screen.
    if (store.state.modalPackage === pkg && store.state.modalVersion === version) {
      updateVersionView(pkg, version);
    }
  }

  /* ---------------------------------------------------------------- *
   * Capability audit and receipt
   * ---------------------------------------------------------------- */

  function renderCapabilityAudit(pkg) {
    var container = document.getElementById('modal-caps-explanation');
    if (!container) return;

    if (!pkg.capabilities || pkg.capabilities.length === 0) {
      container.innerHTML = `
      <div class="cap-audit-row">
        ${ICONS.shield(18)}
        <div>
          <strong>Pure Compute Sandbox (0 Capabilities)</strong>
          <p class="cap-audit-desc">
            This package performs zero I/O, zero network calls, and zero filesystem operations. It executes deterministically in pure user space with compile-time sandboxing.
          </p>
        </div>
      </div>
    `;
      return;
    }

    var tokensHtml = pkg.capabilities.map(function (c) {
      return '<div class="cap-audit-token">' + ICONS.key(14) + escapeHtml(c) + '</div>';
    }).join('');

    container.innerHTML = `
    <div class="cap-audit-list">
      <div class="cap-audit-intro">
        The following capability tokens must be explicitly granted by the consumer at compile time:
      </div>
      ${tokensHtml}
    </div>
  `;
  }

  function buildDeterminismReceipt(pkg) {
    if (pkg && pkg.determinism_receipt) {
      return JSON.stringify(pkg.determinism_receipt, null, 2);
    }
    return [
      'No determinism receipt is published in this manifest.',
      '',
      'The registry does not synthesise one. A receipt is only shown when the',
      'publisher includes a "determinism_receipt" object in',
      'packages/' + util.rawPackageId(pkg ? pkg.name : '') + '/<version>.json.'
    ].join('\n');
  }

  /* ---------------------------------------------------------------- *
   * Favourite control
   * ---------------------------------------------------------------- */

  function refreshLikeFields(pkg) {
    var stat = counters.likeStat(pkg);
    setText('modal-likes-count', stat.value.toLocaleString());
    setText('modal-likes-source', stat.sourceLabel);
  }

  function refreshFavouriteButton(pkg) {
    var btn = document.getElementById('modal-btn-like');
    if (!btn || !pkg) return;

    var isFavourite = counters.isFavourite(pkg.name);
    var label = isFavourite ? 'Remove from favourites' : 'Add to favourites';

    btn.classList.toggle('liked', isFavourite);
    btn.title = label;
    btn.setAttribute('aria-pressed', isFavourite ? 'true' : 'false');
    btn.setAttribute('aria-label', label);

    var svg = btn.querySelector('svg');
    if (svg) svg.setAttribute('fill', isFavourite ? 'currentColor' : 'none');

    setText('modal-like-count', formatNumber(counters.likeStat(pkg).value));
    refreshLikeFields(pkg);
  }

  function toggleFavourite() {
    var pkg = store.state.modalPackage;
    if (pkg) counters.toggleFavourite(pkg.name);
  }

  /* ---------------------------------------------------------------- *
   * Store wiring
   * ---------------------------------------------------------------- */

  function init() {
    store.subscribe(function (reason) {
      var text = String(reason);
      if (text.indexOf('counter') < 0 && text.indexOf('favourite') < 0) return;

      var pkg = store.state.modalPackage;
      if (!pkg) return;

      refreshFavouriteButton(pkg);
      if (store.state.modalVersion === pkg.latest_version) {
        var dl = counters.downloadStat(pkg);
        setText('modal-downloads', dl.value.toLocaleString() + ' \u00b7 ' + dl.sourceLabel);
      }
    });
  }

  Sparks.modal = {
    init: init,
    open: open,
    close: close,
    isOpen: isOpen,
    switchTab: switchTab,
    onVersionChange: onVersionChange,
    onDirectDownload: onDirectDownload,
    hydrateVersionsTable: hydrateVersionsTable,
    applyVersionManifest: applyVersionManifest,
    renderCapabilityAudit: renderCapabilityAudit,
    buildDeterminismReceipt: buildDeterminismReceipt,
    refreshFavouriteButton: refreshFavouriteButton,
    toggleFavourite: toggleFavourite
  };
})(window.Sparks);
