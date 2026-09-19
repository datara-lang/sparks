#!/usr/bin/env node
/**
 * Sparks web catalog DOM smoke test (dependency-free).
 *
 * Loads the real index.html markup and the real module graph into a minimal DOM
 * implementation, renders the catalog, and asserts observable behaviour:
 *
 *   1. No emoji glyphs in any web asset, and none in the HTML produced at
 *      runtime - every icon is inline SVG.
 *   2. index.html contains no inline event handler attribute, every script it
 *      references exists, every `data-action` it declares has a handler, and
 *      every module attaches exactly one surface to the Sparks namespace.
 *   3. Package data is HTML-escaped, including hostile package names.
 *   4. The favourites flow updates the card, the filter chip, the hero metric
 *      and the favourites-only view, and renders a dedicated empty state.
 *   5. The public community counter reads measured values, contributes on
 *      download, and degrades to published-or-nothing instead of inventing a
 *      number when the service is unreachable or rate-limited.
 *   6. The manifest generator writes into the element index.html declares, and
 *      copyManifestJson() (the action index.html binds) exists.
 *   7. Per-version rows display real digests and sizes read from
 *      packages/<name>/<version>.json - never an invented placeholder.
 *   8. The Markdown renderer groups lists, renders safe links, and refuses
 *      javascript: targets.
 *
 * Exits non-zero on the first failing assertion group.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const COUNTER_ORIGIN = 'https://abacus.jasoncameron.dev/';

let checks = 0;
let failures = 0;

function check(name, condition, detail) {
  checks += 1;
  if (condition) {
    console.log(`[PASS] ${name}`);
  } else {
    failures += 1;
    console.log(`[FAIL] ${name}${detail ? ' -> ' + detail : ''}`);
  }
}

/* ------------------------------------------------------------------ *
 * Minimal DOM
 * ------------------------------------------------------------------ */

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

function parseAttrs(str) {
  const attrs = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g;
  let m;
  while ((m = re.exec(str))) {
    attrs[m[1].toLowerCase()] = m[2];
  }
  const bare = str.replace(re, ' ').trim().split(/\s+/).filter(Boolean);
  bare.forEach(token => {
    if (/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(token)) attrs[token.toLowerCase()] = '';
  });
  return attrs;
}

/* ClassList — ES5 constructor + prototype (no class keyword). */
function ClassList(el) {
  this.el = el;
}
ClassList.prototype._set = function () {
  return new Set(String(this.el.getAttribute('class') || '').split(/\s+/).filter(Boolean));
};
ClassList.prototype._write = function (set) {
  this.el.setAttribute('class', Array.from(set).join(' '));
};
ClassList.prototype.add = function () {
  var set = this._set();
  Array.prototype.forEach.call(arguments, function (n) { set.add(n); });
  this._write(set);
};
ClassList.prototype.remove = function () {
  var set = this._set();
  Array.prototype.forEach.call(arguments, function (n) { set.delete(n); });
  this._write(set);
};
ClassList.prototype.contains = function (name) {
  return this._set().has(name);
};
ClassList.prototype.toggle = function (name, force) {
  var has = this.contains(name);
  var shouldHave = force === undefined ? !has : Boolean(force);
  if (shouldHave) this.add(name); else this.remove(name);
  return shouldHave;
};

/* Element — ES5 constructor + prototype + Object.defineProperty for
 * getters/setters (no class keyword). */
function Element(tagName, attrs, doc) {
  this.tagName = String(tagName).toUpperCase();
  this.doc = doc;
  this._attrs = Object.assign({}, attrs || {});
  this.childNodes = [];
  this.parentNode = null;
  this.style = {};
  this._html = null;
  this._text = null;
  this._listeners = {};
  this.classList = new ClassList(this);
}

/* --- attributes --- */
Element.prototype.setAttribute = function (name, value) {
  this._attrs[String(name).toLowerCase()] = String(value);
};
Element.prototype.getAttribute = function (name) {
  var key = String(name).toLowerCase();
  return Object.prototype.hasOwnProperty.call(this._attrs, key) ? this._attrs[key] : null;
};
Element.prototype.hasAttribute = function (name) {
  return this.getAttribute(name) !== null;
};
Element.prototype._deleteAttr = function (name) {
  delete this._attrs[String(name).toLowerCase()];
};

Object.defineProperty(Element.prototype, 'id', {
  get: function () { return this.getAttribute('id') || ''; },
  enumerable: true, configurable: true
});

Object.defineProperty(Element.prototype, 'className', {
  get: function () { return this.getAttribute('class') || ''; },
  set: function (value) { this.setAttribute('class', value); },
  enumerable: true, configurable: true
});

Object.defineProperty(Element.prototype, 'hidden', {
  get: function () { return this.hasAttribute('hidden'); },
  set: function (value) {
    if (value) this.setAttribute('hidden', ''); else this._deleteAttr('hidden');
  },
  enumerable: true, configurable: true
});

Object.defineProperty(Element.prototype, 'value', {
  get: function () { return this.getAttribute('value') || ''; },
  set: function (v) { this.setAttribute('value', v); },
  enumerable: true, configurable: true
});

Object.defineProperty(Element.prototype, 'title', {
  get: function () { return this.getAttribute('title') || ''; },
  set: function (v) { this.setAttribute('title', v); },
  enumerable: true, configurable: true
});

Object.defineProperty(Element.prototype, 'href', {
  get: function () { return this.getAttribute('href') || ''; },
  set: function (v) { this.setAttribute('href', v); },
  enumerable: true, configurable: true
});

/* --- content --- */
Object.defineProperty(Element.prototype, 'innerHTML', {
  get: function () { return this._html === null ? '' : this._html; },
  set: function (html) {
    this._html = String(html);
    this._text = null;
    this.childNodes = [];
    this._repaints = (this._repaints || 0) + 1;
    var fragment = parseHtml(this._html, this.doc);
    // slice(): appendChild detaches each node from the fragment, which would
    // otherwise mutate the list being iterated.
    var self = this;
    fragment.childNodes.slice().forEach(function (child) { self.appendChild(child); });
  },
  enumerable: true, configurable: true
});

/* catalog.js paint() reads firstChild to decide whether a repaint is needed.
 * Without this getter the guard is invisible to the harness and the no-repaint
 * assertion below would pass vacuously. */
Object.defineProperty(Element.prototype, 'firstChild', {
  get: function () { return this.childNodes.length ? this.childNodes[0] : null; },
  enumerable: true, configurable: true
});

Object.defineProperty(Element.prototype, 'textContent', {
  get: function () {
    if (this.childNodes.length === 0) {
      return this._text === null ? (this._html === null ? '' : this._html) : this._text;
    }
    return this.childNodes.map(function (child) { return child.textContent; }).join('');
  },
  set: function (text) {
    this._text = String(text);
    this._html = null;
    this.childNodes = [];
  },
  enumerable: true, configurable: true
});

Element.prototype.appendChild = function (child) {
  if (child.parentNode) child.parentNode.removeChild(child);
  child.parentNode = this;
  this.childNodes.push(child);
  return child;
};
Element.prototype.removeChild = function (child) {
  var idx = this.childNodes.indexOf(child);
  if (idx >= 0) this.childNodes.splice(idx, 1);
  child.parentNode = null;
  return child;
};
Element.prototype.remove = function () {
  if (this.parentNode) this.parentNode.removeChild(this);
};

/* --- queries --- */
Element.prototype.querySelectorAll = function (selector) {
  var results = [];
  selector.split(',').forEach(function (part) {
    var chain = part.trim().split(/\s+/).filter(Boolean);
    collectMatches(this, chain, 0, results);
  }, this);
  return results;
};
Element.prototype.querySelector = function (selector) {
  var all = this.querySelectorAll(selector);
  return all.length ? all[0] : null;
};
Element.prototype.closest = function (selector) {
  var node = this;
  while (node) {
    if (matchesSimple(node, selector)) return node;
    node = node.parentNode;
  }
  return null;
};
Element.prototype.matches = function (selector) {
  return matchesSimple(this, selector);
};

/* --- events --- */
Element.prototype.addEventListener = function (type, handler) {
  (this._listeners[type] = this._listeners[type] || []).push(handler);
};
Element.prototype.dispatchEvent = function (event) {
  event.target = event.target || this;
  var handlers = this._listeners[event.type] || [];
  handlers.slice().forEach(function (handler) { handler(event); });
  return true;
};

/* --- focus --- */
Element.prototype.focus = function () {
  if (this.doc) this.doc.activeElement = this;
};
Element.prototype.blur = function () {
  if (this.doc && this.doc.activeElement === this) this.doc.activeElement = this.doc.body;
};
Element.prototype.select = function () {};

function matchesSimple(el, selector) {
  const sel = selector.trim();
  if (!sel) return false;
  const attrRe = /\[([a-zA-Z-]+)(?:="([^"]*)")?\]/g;
  let m;
  let rest = sel;
  const attrTests = [];
  while ((m = attrRe.exec(sel))) {
    attrTests.push({ name: m[1].toLowerCase(), value: m[2] });
    rest = rest.replace(m[0], '');
  }
  const classTests = [];
  rest = rest.replace(/\.([a-zA-Z0-9_-]+)/g, (full, cls) => {
    classTests.push(cls);
    return '';
  });
  const idMatch = rest.match(/#([a-zA-Z0-9_-]+)/);
  const tagPart = rest.replace(/#[a-zA-Z0-9_-]+/, '').trim();

  if (tagPart && tagPart !== '*' && el.tagName !== tagPart.toUpperCase()) return false;
  if (idMatch && el.id !== idMatch[1]) return false;
  for (const cls of classTests) {
    if (!el.classList.contains(cls)) return false;
  }
  for (const test of attrTests) {
    if (!el.hasAttribute(test.name)) return false;
    if (test.value !== undefined && el.getAttribute(test.name) !== test.value) return false;
  }
  return true;
}

function collectMatches(root, chain, depth, results) {
  if (depth >= chain.length) return;
  const selector = chain[depth];
  const isLast = depth === chain.length - 1;
  for (const child of root.childNodes) {
    if (matchesSimple(child, selector)) {
      if (isLast) results.push(child);
      else collectMatches(child, chain, depth + 1, results);
    }
    // Descendants can match even when the direct child does not.
    collectMatches(child, chain, depth, results);
  }
}

// A real DOM decodes character references when parsing text nodes. Mirroring
// that keeps textContent assertions meaningful.
function decodeEntities(text) {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&');
}

function parseHtml(html, doc) {
  const root = new Element('div', {}, doc);
  const stack = [root];
  const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|[^>"])*?)(\/?)>/g;
  let lastIndex = 0;
  let m;
  const appendText = (parent, text) => {
    if (!text) return;
    const node = new Element('#text', {}, doc);
    node._text = decodeEntities(text);
    node.tagName = '#TEXT';
    parent.appendChild(node);
  };

  while ((m = tagRe.exec(html))) {
    appendText(stack[stack.length - 1], html.slice(lastIndex, m.index));
    lastIndex = tagRe.lastIndex;

    const isClosing = m[0].startsWith('</');
    const tag = m[1].toLowerCase();

    if (isClosing) {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tagName === tag.toUpperCase()) {
          stack.length = i;
          break;
        }
      }
      continue;
    }

    const el = new Element(tag, parseAttrs(m[2] || ''), doc);
    stack[stack.length - 1].appendChild(el);
    if (!VOID_TAGS.has(tag) && m[3] !== '/') stack.push(el);
  }

  appendText(stack[stack.length - 1], html.slice(lastIndex));
  return root;
}

/* ------------------------------------------------------------------ *
 * Host environment
 * ------------------------------------------------------------------ */

const DISK_INDEX = JSON.parse(fs.readFileSync(path.join(ROOT, 'index.json'), 'utf8'));
const FIXTURE_PACKAGES = [
  {
    name: 'sparks/crypto_core',
    raw_id: 'crypto_core',
    latest_version: '1.0.0',
    description: 'High-performance cryptographic primitives in pure Datara',
    author: 'Datara Core Team <core@datara.dev>',
    license: 'MIT OR Apache-2.0',
    capabilities: [],
    tags: ['crypto', 'security', 'pure-compute'],
    tarball_url: 'tarballs/crypto_core-1.0.0.tar',
    sha256: '5d4160e1bce5dc15869dfa2868b6eb1fd25c54b8d3c9f86b5fc707915f7537cc',
    public_key: '1e5b98204a627f872e09e8fb32e511abdc714b0f1b720d809b5e43e1ea97925d',
    signature: '34b95fbc70f7fa54af478dab4e6b3673b5493b9c8d3a6c6ad9a3971c32d487ac6855c0f7587ced2ba3f01ff9b7888c7c7a556502f1ad76604156f6dc8ebfba01',
    versions: ['1.0.0', '0.9.0'],
    size_bytes: 2707,
    downloads: 0,
    likes: 0
  },
  {
    name: 'sparks/toy_kv',
    raw_id: 'toy_kv',
    latest_version: '1.0.0',
    description: 'Capability-governed key-value storage engine',
    author: 'Datara Core Team <core@datara.dev>',
    license: 'MIT OR Apache-2.0',
    capabilities: ['Capability<FileRead>', 'Capability<FileWrite>'],
    tags: ['storage', 'kv'],
    tarball_url: 'tarballs/toy_kv-1.0.0.tar',
    sha256: '6789012345abcdef6789012345abcdef6789012345abcdef6789012345abcdef',
    public_key: '1e5b98204a627f872e09e8fb32e511abdc714b0f1b720d809b5e43e1ea97925d',
    signature: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef',
    versions: ['1.0.0'],
    size_bytes: 1600,
    downloads: 0,
    likes: 0
  }
];

const INDEX_JSON = (DISK_INDEX.packages && DISK_INDEX.packages.length > 0)
  ? DISK_INDEX
  : Object.assign({}, DISK_INDEX, { packages: FIXTURE_PACKAGES, total_packages: FIXTURE_PACKAGES.length });

const storage = new Map();
const localStorage = {
  getItem: key => (storage.has(String(key)) ? storage.get(String(key)) : null),
  setItem: (key, value) => { storage.set(String(key), String(value)); },
  removeItem: key => { storage.delete(String(key)); }
};

const clipboardWrites = [];
const navigator = {
  clipboard: {
    writeText(text) {
      clipboardWrites.push(String(text));
      return Promise.resolve();
    }
  }
};

/* --- counter service stub ----------------------------------------- */

const counterRequests = [];
const counterValues = new Map([
  ['dl_crypto_core', 42],
  ['like_crypto_core', 7]
]);
const counterState = { mode: 'ok' }; // 'ok' | 'down' | 'throttle'

function counterJson(status, body) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) };
}

function counterResponse(action, key) {
  if (counterState.mode === 'down') return counterJson(503, { error: 'service unavailable' });
  if (counterState.mode === 'throttle') return counterJson(429, { error: 'Too many requests. Try again in 2s' });

  if (action === 'hit') {
    const next = (counterValues.get(key) || 0) + 1;
    counterValues.set(key, next);
    return counterJson(200, { value: next });
  }
  if (counterValues.has(key)) return counterJson(200, { value: counterValues.get(key) });
  return counterJson(404, { error: 'Key not found' });
}

function fetchStub(url) {
  const raw = String(url);

  if (raw.startsWith(COUNTER_ORIGIN)) {
    const parts = raw.slice(COUNTER_ORIGIN.length).split('/');
    const action = parts[0];
    const namespace = decodeURIComponent(parts[1] || '');
    const key = decodeURIComponent(parts[2] || '');
    counterRequests.push({ action, namespace, key });
    return Promise.resolve(counterResponse(action, key));
  }

  const clean = raw.split('?')[0];
  if (clean === 'index.json') {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve(INDEX_JSON)
    });
  }
  if (clean === 'packages/crypto_core/0.9.0.json') {
    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({
        schema: 1,
        name: 'sparks/crypto_core',
        version: '0.9.0',
        sha256: '5d4160e1bce5dc15869dfa2868b6eb1fd25c54b8d3c9f86b5fc707915f7537cc',
        size_bytes: 2500,
        capabilities: []
      })
    });
  }
  const filePath = path.join(ROOT, clean);
  if (!fs.existsSync(filePath)) {
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.reject(new Error('404')) });
  }
  const body = fs.readFileSync(filePath, 'utf8');
  return Promise.resolve({
    ok: true,
    status: 200,
    json: () => Promise.resolve(JSON.parse(body))
  });
}

const pendingTimers = [];
function setTimeoutStub(fn, delay) {
  pendingTimers.push({ fn, delay });
  return pendingTimers.length;
}
function clearTimeoutStub() {}

const cryptoStub = {
  subtle: {
    digest(algorithm, buffer) {
      return Promise.resolve(nodeCrypto.createHash('sha256').update(Buffer.from(buffer)).digest());
    }
  }
};

// index.html without <head>, <style> and <script> payloads: the DOM we test.
const rawIndexHtml = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const bodyMarkup = rawIndexHtml
  .replace(/<head[\s\S]*?<\/head>/i, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/<script[\s\S]*?<\/script>/gi, '');

const documentStub = {
  readyState: 'loading',
  listeners: {},
  createElement(tag) {
    return new Element(tag, {}, documentStub);
  },
  addEventListener(type, handler) {
    (this.listeners[type] = this.listeners[type] || []).push(handler);
  },
  dispatchEvent(event) {
    event.target = event.target || this;
    (this.listeners[event.type] || []).slice().forEach(handler => handler(event));
    return true;
  },
  execCommand() {
    return true;
  }
};

documentStub.body = new Element('body', {}, documentStub);
const parsedBody = parseHtml(bodyMarkup, documentStub);
// slice(): appendChild detaches from the source list.
parsedBody.childNodes.slice().forEach(node => documentStub.body.appendChild(node));

documentStub.getElementById = function (id) {
  return documentStub.body.querySelector(`#${id}`) || null;
};
documentStub.querySelector = function (selector) {
  return documentStub.body.querySelector(selector);
};
documentStub.querySelectorAll = function (selector) {
  return documentStub.body.querySelectorAll(selector);
};
documentStub.activeElement = documentStub.body;

const sandbox = {
  console,
  document: documentStub,
  navigator,
  localStorage,
  fetch: fetchStub,
  crypto: cryptoStub,
  setTimeout: setTimeoutStub,
  clearTimeout: clearTimeoutStub
};
sandbox.window = sandbox;

vm.createContext(sandbox);

const run = code => vm.runInContext(code, sandbox, { filename: 'harness-eval.js' });

async function flush(times) {
  for (let i = 0; i < (times || 6); i++) {
    await new Promise(resolve => setImmediate(resolve));
    runTimers();
  }
}

// setTimeout is captured rather than scheduled, so deferred work (store change
// coalescing, toast expiry) only runs when we explicitly drain it.
function runTimers(max) {
  let drained = 0;
  while (pendingTimers.length && drained < (max || 200)) {
    const timer = pendingTimers.shift();
    drained += 1;
    timer.fn();
  }
}

/* --- interaction helpers ------------------------------------------ */

function fireOnDocument(type, target, extra) {
  const event = Object.assign(
    { type, target, preventDefault() {}, stopPropagation() {} },
    extra || {}
  );
  documentStub.dispatchEvent(event);
  return event;
}

// A click that bubbles: the catalog binds one delegated listener on document.
function clickAction(selector) {
  const el = documentStub.querySelector(selector);
  if (!el) throw new Error('no element matches: ' + selector);
  fireOnDocument('click', el);
  return el;
}

/* ------------------------------------------------------------------ *
 * Assertions
 * ------------------------------------------------------------------ */

const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{2764}]/u;

function scanEmoji(label, text) {
  const match = text.match(EMOJI_RE);
  check(label, match === null, match ? `found ${JSON.stringify(match[0])}` : '');
}

async function main() {
  console.log('Sparks web catalog DOM smoke test');
  console.log('---------------------------------');

  /* --- 1. source hygiene and module wiring --- */
  const scriptSrcs = Array.from(rawIndexHtml.matchAll(/<script[^>]*\ssrc="([^"]+)"/g))
    .map(m => m[1].split('?')[0]);

  const sources = { 'index.html': rawIndexHtml, 'styles.css': fs.readFileSync(path.join(ROOT, 'styles.css'), 'utf8') };
  scriptSrcs.forEach(src => {
    const full = path.join(ROOT, src);
    check(`module referenced by index.html exists: ${src}`, fs.existsSync(full));
    if (fs.existsSync(full)) sources[src] = fs.readFileSync(full, 'utf8');
  });

  check('index.html loads the split module graph, not one monolith',
    scriptSrcs.length >= 10 && scriptSrcs.includes('app.js') && scriptSrcs.includes('src/core.js'),
    scriptSrcs.join(', '));

  check('src/core.js is the first script evaluated',
    scriptSrcs[0] === 'src/core.js', scriptSrcs[0]);

  check('app.js is the last script evaluated',
    scriptSrcs[scriptSrcs.length - 1] === 'app.js', scriptSrcs[scriptSrcs.length - 1]);

  // Anchored to a real <script> tag: the rationale comment in index.html
  // mentions "type=module" in prose, and that must not trip this check.
  check('index.html loads no <script type="module"> (file:// direct open must keep working)',
    !/<script[^>]*\stype\s*=\s*["']module["']/.test(rawIndexHtml));

  Object.keys(sources).forEach(name => {
    scanEmoji(`${name} contains no emoji glyphs`, sources[name]);
  });

  const inlineHandlerWithData = /onclick\s*=\s*"[^"]*\$\{/;
  Object.keys(sources).forEach(name => {
    if (!name.endsWith('.js')) return;
    check(`${name} never interpolates data into an inline event handler`,
      !inlineHandlerWithData.test(sources[name]));
  });

  // The whole point of the delegation refactor: no handler is looked up by name
  // at click time, so index.html cannot reference a function that no longer
  // exists.
  const inlineHandlers = rawIndexHtml.match(/\son[a-z]+\s*=\s*"/gi) || [];
  check('index.html declares no inline event handler attributes',
    inlineHandlers.length === 0, inlineHandlers.join(', '));

  /* --- 2. load the application --- */
  scriptSrcs.forEach(src => {
    const full = path.join(ROOT, src);
    if (!fs.existsSync(full)) return;
    vm.runInContext(fs.readFileSync(full, 'utf8'), sandbox, { filename: src });
  });

  check('the Sparks namespace is created with one surface per module',
    ['CONFIG', 'ICONS', 'util', 'markdown', 'store', 'registry', 'counters', 'catalog', 'modal', 'generator', 'actions']
      .every(key => run(`typeof Sparks.${key}`) === 'object'));

  check('the catalog exposes no bare global functions',
    run('typeof createPackageCardHtml') === 'undefined' && run('typeof renderPackages') === 'undefined');

  // Every data-action declared in index.html must have a registered handler.
  const declaredActions = Array.from(new Set(
    Array.from(rawIndexHtml.matchAll(/data-action="([^"]+)"/g)).map(m => m[1])
  ));
  const missingActions = declaredActions.filter(action => run(`typeof Sparks.actions.handlers[${JSON.stringify(action)}]`) !== 'function');
  check(`every data-action in index.html has a handler (${declaredActions.length} declared)`,
    missingActions.length === 0, missingActions.join(', '));

  documentStub.dispatchEvent({ type: 'DOMContentLoaded' });
  await flush(30);

  const gridHtml = run('document.getElementById("packages-grid").innerHTML');
  const expectedCount = INDEX_JSON.packages.length;

  check('catalog renders every indexed package', (gridHtml.match(/class="package-card"/g) || []).length === expectedCount,
    `rendered ${(gridHtml.match(/class="package-card"/g) || []).length} of ${expectedCount}`);

  scanEmoji('rendered card markup contains no emoji glyphs', gridHtml);

  check('cards use delegated favourite controls', gridHtml.includes('data-action="favorite"'));
  check('cards expose aria-pressed for favourites', gridHtml.includes('aria-pressed="false"'));
  check('cards carry no inline onclick attributes', !gridHtml.includes('onclick='));

  check('hero metric reflects the index size',
    run('document.getElementById("metric-packages-count").textContent') === String(expectedCount));
  check('results counter reflects the index size',
    String(run('document.getElementById("results-count").textContent')).includes(`${expectedCount} packages`));

  /* --- 3. escaping of hostile package data --- */
  const hostile = run(`Sparks.catalog.createPackageCardHtml({
    name: 'sparks/x"><img src=x onerror=alert(1)>',
    latest_version: '1.0.0',
    description: '</p><script>alert(2)</script>',
    capabilities: [],
    tags: ['"><b>bold</b>'],
    author: '"><svg onload=alert(3)>',
    license: '"><iframe>',
    size_bytes: 10,
    downloads: 0,
    likes: 0
  })`);

  const hostileTree = parseHtml(hostile, documentStub);
  let injectedNodes = 0;
  const walk = node => {
    node.childNodes.forEach(child => {
      if (child.tagName === '#TEXT') return;
      if (['IMG', 'SCRIPT', 'IFRAME', 'B'].includes(child.tagName)) injectedNodes += 1;
      if (child.hasAttribute('onerror') || child.hasAttribute('onload') || child.hasAttribute('onclick')) {
        injectedNodes += 1;
      }
      walk(child);
    });
  };
  walk(hostileTree);

  check('hostile package data injects no elements or handlers', injectedNodes === 0,
    `injected ${injectedNodes}`);
  check('the hostile card still renders as a package card',
    hostileTree.querySelector('.package-card') !== null);
  check('hostile description cannot inject a script element', !/<script>alert\(2\)/.test(hostile));
  check('hostile tags are escaped', !hostile.includes('<b>bold</b>'));
  check('hostile license is escaped', !/<iframe>/.test(hostile));
  check('escaped output still contains the safe literal', hostile.includes('&lt;script&gt;'));

  /* --- 4. public community counter --- */
  // The namespace is read from the live config rather than hardcoded, so the
  // harness cannot silently drift from what the catalog actually requests.
  const counterNamespace = run('Sparks.CONFIG.counter.namespace');
  check('the counter namespace is a valid service namespace',
    typeof counterNamespace === 'string' && /^[A-Za-z0-9_.-]{3,64}$/.test(counterNamespace),
    String(counterNamespace));

  check('the counter reads from the public endpoint',
    counterRequests.some(r => r.action === 'get' && r.namespace === counterNamespace && r.key === 'dl_crypto_core'),
    JSON.stringify(counterRequests.slice(0, 3)));
  check('counter keys are derived from the raw package id',
    counterRequests.every(r => /^[A-Za-z0-9_.-]{3,64}$/.test(r.key) && /^[A-Za-z0-9_.-]{3,64}$/.test(r.namespace)),
    JSON.stringify(counterRequests.slice(0, 4)));

  const measuredCard = documentStub.querySelector('.package-card[data-pkg="sparks/crypto_core"]');
  const measuredBadge = measuredCard ? measuredCard.querySelector('[data-role="downloads"]') : null;
  check('a measured count is rendered from the public counter',
    Boolean(measuredBadge) && measuredBadge.getAttribute('data-source') === 'public'
      && measuredBadge.textContent.trim() === '42',
    measuredBadge ? `${measuredBadge.getAttribute('data-source')} / ${measuredBadge.textContent.trim()}` : 'no badge');
  check('the tooltip names the source instead of implying a global total',
    Boolean(measuredBadge) && /public community counter/.test(measuredBadge.getAttribute('title')));

  check('counter status reports a live service',
    run('Sparks.counters.counterStatus().state') === 'live' &&
    run('document.getElementById("counter-status").getAttribute("data-state")') === 'live',
    run('document.getElementById("counter-status-text").textContent'));

  // A click on the real download link must reach the delegated handler.
  const hitsBefore = counterRequests.filter(r => r.action === 'hit' && r.key === 'dl_crypto_core').length;
  clickAction('.package-card[data-pkg="sparks/toy_kv"] a[data-action="download"]');
  await flush(6);
  const hitsAfter = counterRequests.filter(r => r.action === 'hit' && r.key === 'dl_toy_kv').length;
  check('clicking a download link contributes to the public counter',
    hitsAfter === 1, `${hitsBefore} -> ${hitsAfter}`);

  // Honesty: an unreachable service yields "unknown", never a fabricated zero.
  counterState.mode = 'down';
  const failedRead = await run('Sparks.counters.readPublicCount("dl", "sparks/never_seen")');
  check('an unreachable counter resolves to null, not to a number', failedRead === null, String(failedRead));
  check('a failed counter read is not cached as a measured zero',
    run('Sparks.counters.cachedPublicCount("dl", "sparks/never_seen")') === null);
  counterState.mode = 'throttle';
  await run('Sparks.counters.readPublicCount("dl", "sparks/never_seen_either")');
  check('an HTTP 429 puts the counter into a throttled state',
    run('Sparks.counters.counterStatus().state') === 'throttled',
    run('Sparks.counters.counterStatus().label'));
  counterState.mode = 'ok';

  // Degradation: with the counter switched off the catalog falls back to the
  // manifest value and says so, rather than showing a stale measured number.
  run('Sparks.CONFIG.counter.enabled = false; Sparks.catalog.render();');
  const degradedCard = documentStub.querySelector('.package-card[data-pkg="sparks/crypto_core"]');
  const degradedBadge = degradedCard ? degradedCard.querySelector('[data-role="downloads"]') : null;
  check('with the counter disabled the badge falls back to published data',
    Boolean(degradedBadge) && degradedBadge.getAttribute('data-source') === 'none'
      && degradedBadge.textContent.trim() === '0',
    degradedBadge ? `${degradedBadge.getAttribute('data-source')} / ${degradedBadge.textContent.trim()}` : 'no badge');
  check('with the counter disabled the status pill says so',
    run('Sparks.counters.counterStatus().state') === 'disabled');
  run('Sparks.CONFIG.counter.enabled = true; Sparks.catalog.render();');

  /* --- 5. favourites flow (through the delegated click path) --- */
  check('nothing is favourited at start', run('Sparks.counters.favouriteNames().length') === 0);

  clickAction('.package-card[data-pkg="sparks/toy_kv"] [data-action="favorite"]');
  await flush(4);

  check('clicking the heart records a favourite', run('Sparks.counters.isFavourite("sparks/toy_kv")') === true);
  check('favourites chip counter updates',
    run('document.getElementById("fav-chip-count").textContent') === '1');
  check('favourites hero metric updates',
    run('document.getElementById("metric-favorites-count").textContent') === '1');
  check('the first favourite contributes exactly one appreciation',
    counterRequests.filter(r => r.action === 'hit' && r.key === 'like_toy_kv').length === 1);

  clickAction('.package-card[data-pkg="sparks/toy_kv"] [data-action="favorite"]');
  await flush(4);
  clickAction('.package-card[data-pkg="sparks/toy_kv"] [data-action="favorite"]');
  await flush(4);
  check('re-favouriting does not inflate the public counter',
    counterRequests.filter(r => r.action === 'hit' && r.key === 'like_toy_kv').length === 1,
    String(counterRequests.filter(r => r.action === 'hit' && r.key === 'like_toy_kv').length));

  run('Sparks.store.state.filterTag = "favourites"; Sparks.catalog.render();');
  const favGrid = run('document.getElementById("packages-grid").innerHTML');
  check('favourites view shows only the bookmarked package',
    favGrid.includes('sparks/toy_kv') && !favGrid.includes('sparks/crypto_core'));

  run('Sparks.counters.toggleFavourite("sparks/toy_kv");');
  await flush(2);
  const emptyGrid = run('document.getElementById("packages-grid").innerHTML');
  check('empty favourites view renders the dedicated empty state',
    emptyGrid.includes('No favourites yet'));
  check('the empty state exposes a delegated reset control',
    emptyGrid.includes('data-action="reset-filters"') && !emptyGrid.includes('onclick='));

  clickAction('#packages-grid [data-action="reset-filters"]');
  await flush(4);
  check('resetFilters restores the full catalog',
    (run('document.getElementById("packages-grid").innerHTML').match(/class="package-card"/g) || []).length === expectedCount);

  /* --- 5b. the grid repaints only when the markup actually changes ---
   * A repaint destroys every node in the grid. If one lands between mousedown and
   * mouseup, the browser dispatches `click` on the nearest common ancestor of two
   * detached nodes, so the delegated listener never fires and the control silently
   * does nothing. Synthetic clicks cannot reproduce that race - which is exactly
   * why this harness missed the bug the first time - so the guard is asserted
   * directly. tests/browser_e2e_check.js covers the user-visible consequence with a
   * real mouse, and the DOM shim's innerHTML setter counts repaints.
   */
  const gridEl = documentStub.getElementById('packages-grid');
  const repaintsBefore = gridEl._repaints || 0;
  run('Sparks.store.emit("filters");');
  check('a no-op state emit does not repaint the grid',
    (gridEl._repaints || 0) === repaintsBefore,
    `${repaintsBefore} -> ${gridEl._repaints || 0}`);

  const repaintsBefore2 = gridEl._repaints || 0;
  clickAction('.filter-chip[data-tag="all"]');
  await flush(4);
  check('re-clicking the active filter chip does not repaint the grid',
    (gridEl._repaints || 0) === repaintsBefore2,
    `${repaintsBefore2} -> ${gridEl._repaints || 0}`);

  const repaintsBefore3 = gridEl._repaints || 0;
  clickAction('.filter-chip[data-tag="crypto"]');
  await flush(4);
  check('clicking a different filter chip does repaint the grid',
    (gridEl._repaints || 0) > repaintsBefore3,
    `${repaintsBefore3} -> ${gridEl._repaints || 0}`);
  clickAction('.filter-chip[data-tag="all"]');
  await flush(4);

  /* --- 6. manifest generator wiring --- */
  check('the generator module exposes copyManifestJson (the action index.html binds)',
    run('typeof Sparks.generator.copyManifestJson') === 'function');
  check('generator preview element is the one index.html declares',
    documentStub.getElementById('manifest-preview') !== null &&
    documentStub.getElementById('gen-preview-code') === null);

  const previewText = run('document.getElementById("manifest-preview").textContent');
  let previewValid = false;
  try {
    const parsed = JSON.parse(previewText);
    previewValid = parsed.schema === 1 && typeof parsed.name === 'string';
  } catch (err) {
    previewValid = false;
  }
  check('generator preview renders Schema 1 JSON on load', previewValid);

  const statusText = String(run('document.getElementById("schema-status").textContent'));
  check('generator status reports missing placeholders honestly',
    /Placeholders/.test(statusText) && !/Valid/.test(statusText), statusText);

  // Editing a field must go through the delegated input handler.
  const nameInput = documentStub.getElementById('gen-name');
  nameInput.value = 'sparks/renamed_probe';
  fireOnDocument('input', nameInput);
  await flush(2);
  const renamed = JSON.parse(run('document.getElementById("manifest-preview").textContent'));
  check('editing a generator field flows through the delegated input handler',
    renamed.name === 'sparks/renamed_probe' && renamed.tarball_url === 'tarballs/renamed_probe-1.0.0.tar',
    renamed.name);

  clipboardWrites.length = 0;
  clickAction('[data-action="copy-manifest"]');
  await flush(2);
  check('the copy-manifest action writes the manifest to the clipboard',
    clipboardWrites.length === 1 && clipboardWrites[0].includes('"schema": 1'));

  /* --- 7. version table uses real manifests --- */
  run('Sparks.modal.open("sparks/crypto_core")');
  await flush(20);

  const versionRows = documentStub.querySelectorAll('#modal-versions-list tr[data-version-row]');
  check('versions tab lists every published version', versionRows.length === 2,
    `found ${versionRows.length}`);

  const manifestFile = path.join(ROOT, 'packages', 'crypto_core', '0.9.0.json');
  const realManifest = fs.existsSync(manifestFile)
    ? JSON.parse(fs.readFileSync(manifestFile, 'utf8'))
    : { sha256: '5d4160e1bce5dc15869dfa2868b6eb1fd25c54b8d3c9f86b5fc707915f7537cc', size_bytes: 2500 };
  const realSha = String(realManifest.sha256).substring(0, 16);
  const olderRow = versionRows.find(row => row.getAttribute('data-version-row') === '0.9.0');

  check('older version row exists', Boolean(olderRow));
  check('older version row shows the real SHA-256 digest',
    Boolean(olderRow) && olderRow.querySelector('[data-role="sha"]').textContent.includes(realSha),
    olderRow ? olderRow.querySelector('[data-role="sha"]').textContent : 'no row');
  check('older version row shows the real size',
    Boolean(olderRow) &&
    olderRow.querySelector('[data-role="size"]').textContent === run(`Sparks.util.formatBytes(${realManifest.size_bytes})`),
    olderRow ? olderRow.querySelector('[data-role="size"]').textContent : 'no row');

  const tableText = documentStub.getElementById('modal-versions-list').textContent;
  check('no invented placeholder digests remain', !tableText.includes('verified'));
  check('no invented placeholder sizes remain', !tableText.includes('~10 KB'));

  const versionCells = versionRows
    .flatMap(row => Array.from(row.querySelectorAll('[data-role="size"],[data-role="sha"]')))
    .map(cell => cell.textContent.trim());
  check('no unresolved loading placeholders remain',
    versionCells.length === 4 && !versionCells.includes('...'),
    versionCells.join(' | '));

  check('the modal states where the download figure comes from',
    /public counter/.test(String(run('document.getElementById("modal-downloads").textContent'))),
    run('document.getElementById("modal-downloads").textContent'));
  check('the modal states where the appreciation figure comes from',
    /public counter/.test(String(run('document.getElementById("modal-likes-source").textContent'))),
    run('document.getElementById("modal-likes-source").textContent'));

  check('modal opens as a dialog and locks scroll',
    run('document.getElementById("package-modal").classList.contains("active")') === true &&
    run('document.body.classList.contains("modal-open")') === true);

  // Tabs and close are delegated too.
  clickAction('.modal-tab[data-tab="versions"]');
  check('a delegated modal tab switches the visible panel',
    run('document.getElementById("tab-content-versions").style.display') === 'block' &&
    run('document.getElementById("tab-content-readme").style.display') === 'none');

  clickAction('.btn-close-modal');
  check('closing the modal releases the scroll lock',
    run('document.body.classList.contains("modal-open")') === false);

  /* --- 8. capability audit renders declared tokens --- */
  run('Sparks.modal.open("sparks/toy_kv")');
  await flush(6);

  const capText = documentStub.getElementById('modal-caps-explanation').textContent;
  check('capability tokens are listed for a non-pure package',
    capText.includes('Capability<FileRead>') && capText.includes('Capability<FileWrite>'),
    capText.replace(/\s+/g, ' ').slice(0, 120));

  const receiptText = documentStub.getElementById('modal-receipt').textContent;
  check('no synthesised determinism receipt is shown',
    receiptText.includes('No determinism receipt is published'), receiptText.slice(0, 80));

  run('Sparks.modal.close()');

  /* --- 9. markdown renderer --- */
  const listHtml = run('Sparks.markdown.renderMarkdown("- one\\n- two\\n- three")');
  check('consecutive bullets collapse into a single list',
    (listHtml.match(/<ul>/g) || []).length === 1 &&
    (listHtml.match(/<li>/g) || []).length === 3, listHtml);

  const orderedHtml = run('Sparks.markdown.renderMarkdown("1. first\\n2. second")');
  check('ordered lists render as <ol>',
    orderedHtml.includes('<ol>') && (orderedHtml.match(/<li>/g) || []).length === 2);

  const linkHtml = run('Sparks.markdown.renderMarkdown("[docs](https://example.com/x)")');
  check('safe links are rendered with rel=noopener',
    linkHtml.includes('href="https://example.com/x"') && linkHtml.includes('rel="noopener noreferrer"'));

  const badLinkHtml = run('Sparks.markdown.renderMarkdown("[x](javascript:alert(1))")');
  check('javascript: links are refused', !badLinkHtml.includes('<a '), badLinkHtml);

  const escapeHtmlCheck = run('Sparks.util.escapeHtml("<img src=x onerror=alert(1)>")');
  check('escapeHtml neutralises angle brackets',
    escapeHtmlCheck.includes('&lt;img') && !escapeHtmlCheck.includes('<img'));

  check('formatBytes handles zero and garbage',
    run('Sparks.util.formatBytes(0)') === '0 B' && run('Sparks.util.formatBytes("nope")') === '0 B');

  check('formatNumber handles garbage',
    run('Sparks.util.formatNumber(undefined)') === '0');

  /* --- summary --- */
  console.log('---------------------------------');
  console.log(`${checks - failures}/${checks} assertions passed`);

  if (failures > 0) {
    console.log(`WEB DOM SMOKE TEST FAILED (${failures} failing assertions)`);
    process.exit(1);
  }
  console.log('WEB DOM SMOKE TEST PASSED');
}

main().catch(err => {
  console.error('Harness crashed:', err);
  process.exit(1);
});
