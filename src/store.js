/* Sparks catalog - observable application state.
 *
 * This is the only mutable state in the catalog. It imports nothing, which is
 * what keeps the dependency graph acyclic: registry, counters and catalog all
 * depend on the store, and the store depends on nobody.
 *
 * Change notification is coalesced. Loading the registry triggers one store
 * change, but six community-counter responses arriving in the same tick trigger
 * a single re-render instead of six.
 */

(function (Sparks) {
  'use strict';

  var state = {
    packages: [],
    indexLoaded: false,
    indexError: null,

    filterTag: 'all',
    query: '',
    sort: 'downloads',

    modalPackage: null,
    modalVersion: null,
    lastFocused: null
  };

  var listeners = [];
  var scheduled = null;

  function subscribe(handler) {
    listeners.push(handler);
    return function unsubscribe() {
      var idx = listeners.indexOf(handler);
      if (idx >= 0) listeners.splice(idx, 1);
    };
  }

  function emit(reason) {
    listeners.slice().forEach(function (handler) {
      try {
        handler(reason);
      } catch (err) {
        // One broken subscriber must not stop the others from updating.
        console.error('Sparks store subscriber failed for "' + reason + '":', err);
      }
    });
  }

  // Coalesces every change requested within the same tick into one emit.
  function emitSoon(reason) {
    if (scheduled) {
      scheduled.reasons.push(reason);
      return;
    }
    var job = { reasons: [reason] };
    scheduled = job;
    setTimeout(function () {
      scheduled = null;
      emit(job.reasons.join(','));
    }, 0);
  }

  function findPackage(name) {
    for (var i = 0; i < state.packages.length; i++) {
      if (state.packages[i].name === name) return state.packages[i];
    }
    return null;
  }

  Sparks.store = {
    state: state,
    subscribe: subscribe,
    emit: emit,
    emitSoon: emitSoon,
    findPackage: findPackage
  };
})(window.Sparks);
