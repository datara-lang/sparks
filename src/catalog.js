/* Sparks catalog - the package grid.
 *
 * Every interpolation into an HTML template below is either escaped, produced
 * by a formatting helper, or a constant icon string. Package data never reaches
 * an attribute or a text node unescaped.
 *
 * Controls are wired by delegation (`data-action`), never by an inline
 * `onclick` built from package data.
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

  function isFavouritesFilter() {
    var tag = String(store.state.filterTag || '').toLowerCase();
    // Both spellings are accepted: "favourites" is the copy the UI uses, while
    // "favorites" is the data-tag value index.html has always shipped.
    return tag === 'favourites' || tag === 'favorites';
  }

  /* ---------------------------------------------------------------- *
   * Filtering and sorting
   * ---------------------------------------------------------------- */

  function visiblePackages() {
    var state = store.state;
    var query = String(state.query || '').toLowerCase();

    return state.packages.filter(function (pkg) {
      if (isFavouritesFilter()) {
        if (!counters.isFavourite(pkg.name)) return false;
      } else if (state.filterTag === 'pure') {
        if (pkg.capabilities && pkg.capabilities.length > 0) return false;
      } else if (state.filterTag !== 'all') {
        var wanted = String(state.filterTag).toLowerCase();
        var hasTag = (pkg.tags || []).some(function (t) {
          return String(t).toLowerCase() === wanted;
        });
        if (!hasTag) return false;
      }

      if (query) {
        var nameMatch = String(pkg.name || '').toLowerCase().indexOf(query) >= 0;
        var descMatch = String(pkg.description || '').toLowerCase().indexOf(query) >= 0;
        var authorMatch = String(pkg.author || '').toLowerCase().indexOf(query) >= 0;
        var tagMatch = (pkg.tags || []).some(function (t) {
          return String(t).toLowerCase().indexOf(query) >= 0;
        });
        var capMatch = (pkg.capabilities || []).some(function (c) {
          return String(c).toLowerCase().indexOf(query) >= 0;
        });
        if (!nameMatch && !descMatch && !authorMatch && !tagMatch && !capMatch) return false;
      }

      return true;
    });
  }

  function sortPackages(list) {
    var sort = store.state.sort;

    if (sort === 'likes') {
      list.sort(function (a, b) {
        return counters.likeStat(b).value - counters.likeStat(a).value
          || counters.downloadStat(b).value - counters.downloadStat(a).value;
      });
    } else if (sort === 'downloads' || sort === 'featured') {
      list.sort(function (a, b) {
        return counters.downloadStat(b).value - counters.downloadStat(a).value;
      });
    } else if (sort === 'name-asc') {
      list.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    } else if (sort === 'name-desc') {
      list.sort(function (a, b) { return String(b.name).localeCompare(String(a.name)); });
    } else if (sort === 'size') {
      list.sort(function (a, b) { return (b.size_bytes || 0) - (a.size_bytes || 0); });
    }

    return list;
  }

  /* ---------------------------------------------------------------- *
   * Card markup
   * ---------------------------------------------------------------- */

  // The counter's source is stated in the tooltip and in the modal, never
  // silently blended into a single number.
  function downloadBadgeHtml(stat) {
    return '<span class="badge badge-downloads" data-role="downloads" data-source="'
      + escapeHtml(stat.source) + '" title="' + escapeHtml(stat.title) + '">'
      + ICONS.download(11) + ' ' + escapeHtml(formatNumber(stat.value)) + '</span>';
  }

  function favouriteButtonHtml(pkg, size) {
    var isFavourite = counters.isFavourite(pkg.name);
    var stat = counters.likeStat(pkg);
    var label = isFavourite ? 'Remove from favourites' : 'Add to favourites';
    var count = formatNumber(stat.value);
    var title = label + ' - appreciations from the ' + stat.sourceLabel + ': ' + count;

    return '<button class="btn-like' + (isFavourite ? ' liked' : '') + '" data-action="favorite"'
      + ' data-pkg="' + escapeHtml(pkg.name) + '"'
      + ' aria-pressed="' + (isFavourite ? 'true' : 'false') + '"'
      + ' title="' + escapeHtml(title) + '"'
      + ' aria-label="' + escapeHtml(label) + '">'
      + ICONS.heart(size, isFavourite)
      + '<span class="like-count">' + escapeHtml(count) + '</span></button>';
  }

  // Every interpolation below is either escaped or a pre-sanitized fragment.
  function createPackageCardHtml(pkg) {
    var isPure = !pkg.capabilities || pkg.capabilities.length === 0;
    var capsBadge = isPure
      ? '<span class="badge badge-verified badge-pure" title="This spark requests zero capability tokens">'
        + ICONS.check(13) + ' Pure (0 Caps)</span>'
      : pkg.capabilities.map(function (c) {
        return '<span class="badge" title="Capability token required at compile time">'
          + escapeHtml(String(c).replace('Capability<', '').replace('>', '')) + '</span>';
      }).join('');

    var tagsHtml = (pkg.tags || []).map(function (t) {
      return '<span class="card-tag">#' + escapeHtml(t) + '</span>';
    }).join('');

    var installCmd = 'dpm add ' + pkg.name;
    var sizeDisp = formatBytes(pkg.size_bytes || 0);
    var dlBadge = downloadBadgeHtml(counters.downloadStat(pkg));
    var keyIdBadge = pkg.key_id
      ? '<span class="badge" title="Author Key ID: ' + escapeHtml(pkg.key_id) + '">' + escapeHtml(pkg.key_id) + '</span>'
      : '';
    var likeBtn = favouriteButtonHtml(pkg, 12);

    var tarball = registry.tarballUrl(pkg, pkg.latest_version);
    var tarballUrl = pkg.tarball_url || tarball.href;

    return `
    <div class="package-card" data-pkg="${escapeHtml(pkg.name)}">
      <div class="card-top">
        <div class="card-header-row">
          <button class="package-name" data-action="open" data-pkg="${escapeHtml(pkg.name)}" title="Open package details">${escapeHtml(pkg.name)}</button>
          <div class="card-header-actions">
            ${likeBtn}
            <span class="badge badge-verified">v${escapeHtml(pkg.latest_version)}</span>
          </div>
        </div>

        <div class="badges-row">
          ${capsBadge}
          ${dlBadge}
          <span class="badge">${escapeHtml(pkg.license || 'MIT')}</span>
          <span class="badge" title="Uncompressed payload size">${escapeHtml(sizeDisp)}</span>
          ${keyIdBadge}
        </div>

        <p class="package-desc">${escapeHtml(pkg.description)}</p>

        <div class="card-tags">
          ${tagsHtml}
        </div>
      </div>

      <div class="card-bottom">
        <div class="install-command-box">
          <code>${escapeHtml(installCmd)}</code>
          <button class="btn-card-copy" data-action="copy-install" data-pkg="${escapeHtml(pkg.name)}" data-target="${escapeHtml(installCmd)}" title="Copy install command" aria-label="Copy install command">
            ${ICONS.copy(14)}
          </button>
        </div>
        <div class="card-actions">
          <a href="${escapeHtml(tarballUrl)}" class="btn-download" title="Download .tar archive" download="${escapeHtml(tarball.filename)}" data-action="download" data-pkg="${escapeHtml(pkg.name)}">
            ${ICONS.download(13)}
            .tar
          </a>
          <button class="btn-details" data-action="details" data-pkg="${escapeHtml(pkg.name)}">Details</button>
        </div>
      </div>
    </div>
  `;
  }

  /* ---------------------------------------------------------------- *
   * Grid painting
   * ---------------------------------------------------------------- */

  /* The grid is rebuilt from markup on every state change, which destroys and
   * recreates every node. That is usually invisible, but it is fatal to an
   * in-flight click: if the control under the pointer is removed between
   * mousedown and mouseup, the browser dispatches the resulting `click` on the
   * nearest common ancestor of two detached nodes, so it never reaches the
   * delegated listener in actions.js and the control silently does nothing.
   *
   * The concrete failure this prevents: typing in the search box leaves it
   * focused. Clicking a card control then blurs the input, which fires `change`,
   * which re-renders the grid, which destroys the control under the cursor -
   * swallowing the first click on any in-grid button. Repainting only when the
   * markup actually differs removes the whole class of bug.
   */
  var lastGridHtml = null;

  function paint(container, html) {
    if (html === lastGridHtml && container.firstChild) return;
    container.innerHTML = html;
    lastGridHtml = html;
  }

  /* ---------------------------------------------------------------- *
   * States
   * ---------------------------------------------------------------- */

  function renderEmptyState(container) {
    var isFavouritesView = isFavouritesFilter();
    var isSearchView = !isFavouritesView && (store.state.query !== '' || store.state.filterTag !== 'all');

    var title = isFavouritesView ? 'No favourites yet' : 'No sparks found';
    var desc = isFavouritesView
      ? 'Use the heart control on any package card to bookmark it here. Favourites are stored locally in this browser only.'
      : isSearchView
        ? 'Nothing matches the current query and category filter. Reset to browse the full registry.'
        : 'The registry index is empty. Once a manifest is merged into packages/, it appears here automatically.';

    paint(container, `
    <div class="empty-state">
      <div class="empty-state-icon" aria-hidden="true">${ICONS.heart(40, false, 1.5)}</div>
      <div class="empty-state-title">${escapeHtml(title)}</div>
      <div class="empty-state-desc">${escapeHtml(desc)}</div>
      <button class="btn-copy" data-action="reset-filters">Reset filters</button>
    </div>
  `);
  }

  // Shown while index.json is in flight, so the grid never flashes a
  // "registry is empty" message during a healthy load.
  function renderLoading(container) {
    paint(container, `
    <div class="empty-state">
      <div class="empty-state-title">Loading registry index</div>
      <div class="empty-state-desc">Fetching index.json from the static registry root.</div>
    </div>
  `);
  }

  // Shown when index.json could not be fetched at all - typically a file://
  // origin, where fetch is blocked, or a cold mirror.
  function renderFallback(container) {
    paint(container, `
    <div class="empty-state">
      <div class="empty-state-title">Static Registry Ready</div>
      <div class="empty-state-desc">Serving via local file:// protocol. When published to GitHub Pages, index.json loads automatically.</div>
      <button class="btn-copy" data-action="reload-index">Retry loading index.json</button>
    </div>
  `);
  }

  /* ---------------------------------------------------------------- *
   * Render entry point
   * ---------------------------------------------------------------- */

  function render() {
    var container = document.getElementById('packages-grid');
    if (!container) return;

    if (!store.state.indexLoaded) {
      if (store.state.indexError) renderFallback(container);
      else renderLoading(container);
      updateFavouriteIndicators();
      return;
    }

    var list = sortPackages(visiblePackages());
    setText('results-count', '(' + list.length + ' package' + (list.length === 1 ? '' : 's') + ')');

    if (list.length === 0) {
      renderEmptyState(container);
    } else {
      paint(container, list.map(createPackageCardHtml).join(''));
    }

    updateFavouriteIndicators();

    // Ask the public counter about exactly the packages now on screen. Cached
    // keys resolve immediately, so this is free on re-render.
    counters.ensureStats(list);
  }

  // Keeps the favourites chip counter and the hero metric in sync with storage.
  function updateFavouriteIndicators() {
    var count = counters.favouriteNames().length;
    setText('fav-chip-count', String(count));
    setText('metric-favorites-count', String(count));

    var chip = document.querySelector('.filter-chip[data-tag="favorites"]');
    if (chip) chip.classList.toggle('has-favorites', count > 0);
  }

  function init() {
    store.subscribe(render);
    render();
  }

  Sparks.catalog = {
    init: init,
    render: render,
    visiblePackages: visiblePackages,
    createPackageCardHtml: createPackageCardHtml,
    updateFavouriteIndicators: updateFavouriteIndicators
  };
})(window.Sparks);
