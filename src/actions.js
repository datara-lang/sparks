/* Sparks catalog - event wiring.
 *
 * Every interactive control in index.html and in the generated markup is bound
 * through one delegated listener and one `data-action` name. Nothing looks up a
 * global function by name at click time, which removes the whole class of bug
 * where index.html references a handler that the JavaScript no longer defines.
 *
 * tests/web_dom_harness.js asserts that every `data-action` value appearing in
 * index.html has a handler in `Sparks.actions.handlers`.
 */

(function (Sparks) {
  'use strict';

  var util = Sparks.util;
  var store = Sparks.store;
  var counters = Sparks.counters;
  var modal = Sparks.modal;
  var generator = Sparks.generator;
  var registry = Sparks.registry;

  /* ---------------------------------------------------------------- *
   * Shared behaviours
   * ---------------------------------------------------------------- */

  function syncSearchClear(hasText) {
    var clearBtn = document.getElementById('search-clear');
    if (clearBtn) clearBtn.hidden = !hasText;
  }

  function resetFilters() {
    var changed = store.state.query !== ''
      || store.state.filterTag !== 'all'
      || store.state.sort !== 'downloads';

    store.state.query = '';
    store.state.filterTag = 'all';
    store.state.sort = 'downloads';

    var searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    syncSearchClear(false);

    var sortSelect = document.getElementById('sort-select');
    if (sortSelect) sortSelect.value = 'downloads';

    var bar = document.getElementById('filter-tags-bar');
    if (bar) {
      bar.querySelectorAll('.filter-chip').forEach(function (chip) {
        var isAll = chip.getAttribute('data-tag') === 'all';
        chip.classList.toggle('active', isAll);
        chip.setAttribute('aria-pressed', isAll ? 'true' : 'false');
      });
    }

    if (!changed) return;
    store.emit('filters');
  }

  function toggleFavourite(pkgName) {
    if (!pkgName) return;
    var nowFavourite = counters.toggleFavourite(pkgName);
    util.showToast(
      pkgName + (nowFavourite ? ' added to favourites' : ' removed from favourites'),
      nowFavourite ? 'favorite' : 'warn'
    );
  }

  function openDetails(pkgName) {
    if (pkgName) modal.open(pkgName);
  }

  /* ---------------------------------------------------------------- *
   * Action registry
   * ---------------------------------------------------------------- */

  var handlers = {
    'copy-text': function (el) {
      util.copyText(el.getAttribute('data-copy') || '', el.getAttribute('data-toast') || 'Copied to clipboard');
    },

    // Copies the text of another element, read at click time. This is how the
    // modal's Copy buttons stay correct when the selected version changes
    // without re-binding a handler on every open.
    'copy-from': function (el) {
      var source = document.getElementById(el.getAttribute('data-source-id') || '');
      if (source) util.copyText(source.textContent, el.getAttribute('data-toast') || 'Copied to clipboard');
    },

    'copy-manifest': function () {
      generator.copyManifestJson();
    },

    'favorite': function (el) {
      toggleFavourite(el.getAttribute('data-pkg'));
    },

    // Copying an install command is not a download, so it does not touch the
    // public download counter.
    'copy-install': function (el) {
      var target = el.getAttribute('data-target') || ('dpm add ' + (el.getAttribute('data-pkg') || ''));
      util.copyText(target, 'Install command copied');
    },

    'download': function (el) {
      counters.trackDownload(el.getAttribute('data-pkg'));
    },

    'details': function (el) {
      openDetails(el.getAttribute('data-pkg'));
    },

    'open': function (el) {
      openDetails(el.getAttribute('data-pkg'));
    },

    'reset-filters': function () {
      resetFilters();
    },

    'reload-index': function () {
      registry.loadIndex();
    },

    'search': function (el) {
      var next = String(el.value || '').trim();
      // `change` fires on blur as well as on edit. Without this guard, merely
      // clicking away from the search box re-renders the grid, which destroys the
      // control under the cursor and swallows the click (see catalog.js paint()).
      if (next === store.state.query) return;
      store.state.query = next;
      syncSearchClear(next.length > 0);
      store.emit('filters');
    },

    'clear-search': function () {
      var input = document.getElementById('search-input');
      if (input) {
        input.value = '';
        input.focus();
      }
      syncSearchClear(false);
      if (store.state.query === '') return;
      store.state.query = '';
      store.emit('filters');
    },

    'sort': function (el) {
      var next = el.value;
      if (next === store.state.sort) return;
      store.state.sort = next;
      store.emit('filters');
    },

    'filter': function (el) {
      var next = el.getAttribute('data-tag') || 'all';
      // Re-clicking the already-active chip is a no-op; emitting would repaint the
      // grid for nothing and could destroy a control mid-click.
      if (next === store.state.filterTag) return;
      var bar = document.getElementById('filter-tags-bar');
      if (bar) {
        bar.querySelectorAll('.filter-chip').forEach(function (chip) {
          var isActive = chip === el;
          chip.classList.toggle('active', isActive);
          chip.setAttribute('aria-pressed', isActive ? 'true' : 'false');
        });
      }
      store.state.filterTag = next;
      store.emit('filters');
    },

    'close-modal': function () {
      modal.close();
    },

    'modal-tab': function (el) {
      modal.switchTab(el.getAttribute('data-tab'));
    },

    'modal-favorite': function () {
      modal.toggleFavourite();
    },

    'modal-download': function () {
      modal.onDirectDownload();
    },

    'version-change': function (el) {
      modal.onVersionChange(el.value);
    },

    'gen-update': function () {
      generator.update();
    },

    'gen-upload': function (el, event) {
      generator.onTarUpload(event);
    }
  };

  /* ---------------------------------------------------------------- *
   * Delegation
   * ---------------------------------------------------------------- */

  function dispatch(event) {
    var target = event.target;
    if (!target || typeof target.closest !== 'function') return;

    var trigger = target.closest('[data-action]');
    if (!trigger) return;

    var action = trigger.getAttribute('data-action');
    var handler = handlers[action];
    if (!handler) {
      console.warn('Sparks: no handler registered for data-action="' + action + '"');
      return;
    }
    handler(trigger, event);
  }

  function onDocumentClick(event) {
    var modalEl = document.getElementById('package-modal');
    if (modalEl && event.target === modalEl) {
      modal.close();
      return;
    }
    dispatch(event);
  }

  // '/' focuses the search field, 'Esc' closes the modal or clears the filters.
  function onKeydown(event) {
    var active = document.activeElement;
    var tag = active && active.tagName ? active.tagName : '';
    var typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';

    if (event.key === '/' && !typing) {
      event.preventDefault();
      var search = document.getElementById('search-input');
      if (search) {
        search.focus();
        if (typeof search.select === 'function') search.select();
      }
    } else if (event.key === 'Escape') {
      if (modal.isOpen()) {
        modal.close();
      } else if (typing) {
        resetFilters();
        if (active && typeof active.blur === 'function') active.blur();
      }
    }
  }

  function init() {
    document.addEventListener('click', onDocumentClick);
    document.addEventListener('input', dispatch);
    document.addEventListener('change', dispatch);
    document.addEventListener('keydown', onKeydown);
  }

  Sparks.actions = {
    init: init,
    handlers: handlers,
    dispatch: dispatch,
    resetFilters: resetFilters,
    toggleFavourite: toggleFavourite,
    openDetails: openDetails
  };
})(window.Sparks);
