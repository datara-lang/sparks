# Changelog

All notable changes to the Sparks Package Registry will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.0.4] - 2026-09-15

### Fixed
- **First click on any control inside the package grid was silently swallowed after typing in the search box (P1).** The search input fires `change` when it loses focus. The handler re-rendered the grid even when the query had not changed, which destroyed the control under the pointer between `mousedown` and `mouseup`. The browser then dispatches the resulting `click` on the nearest common ancestor of two detached nodes, so it never reached the delegated listener and the control did nothing. Reproduced in headless Chromium; the event trace is `mousedown` → `change` → grid mutation → `mouseup`, with no `click` at all. Affected `reset-filters` in the empty state and every card control (heart, download, copy install) on the first click after a search. Fixed on two levels:
  - `src/catalog.js` now paints the grid through `paint()`, which skips the `innerHTML` write when the markup is unchanged, so an unnecessary repaint can no longer destroy a node mid-click.
  - `src/actions.js` guards `search`, `clear-search`, `sort`, `filter` and `resetFilters` so a state transition that changes nothing does not emit at all.

### Added
- **`tests/browser_e2e_check.js`:** 23 real-browser assertions driving the actual UI in headless Chromium - cards, badges and their declared source, the counter pill, delegated filter/search/clear/reset, the favourite round-trip, the detail modal's real SHA digests, and the versions tab. Includes a regression case for the swallowed first click above. Counter-service requests are intercepted and fulfilled locally, so the suite exercises the whole counter path without writing to the live public counter, which has no decrement endpoint. Wired into CI as a separate job.
- **`tests/test_registry_layout.py`:** 262 assertions covering the storage layout from the client's point of view - that `packages/<id>.json` and `packages/<id>/<version>.json` both resolve, that every manifest's `sha256` matches the real tarball digest, that signatures are present and correctly shaped, that `index.json` agrees with the manifests it summarises, and that no artifact is orphaned.
- **`docs/REGISTRY_LAYOUT.md`:** how Sparks stores packages, measured against npm, crates.io, PyPI, the Go module proxy and Maven Central - with each third-party claim verified by an actual HTTP request.

### Changed
- **`scripts/validate_registry.py` gained four checks**, each proven live by a negative fixture in `tests/test_ci_validation_fixtures.py` (now 11 fixtures, up from 6):
  1. A tarball must carry a `capabilities.json` sidecar. The previous check only fired when the manifest declared capabilities, so a package declaring `[]` and shipping no sidecar passed while being unverifiable - the client's `E-SPARKS-002` comparison is guarded by `if let Some(sidecar) = ...` and is simply skipped when the sidecar is absent.
  2. `packages/<id>.json` and `packages/<id>/<latest>.json` must describe the same artifact. Drift on a client-relevant field is an error; a field present in only one of the two is a warning.
  3. `index.json` must not contradict the root manifest on `sha256`, `size_bytes`, `capabilities`, `description`, `license`, `author`, `public_key`, `signature` or `tarball_url`. The catalog renders `index.json` and nothing previously stopped it from displaying a digest the artifact does not have.
  4. The version list advertised in `index.json` must match the version manifests actually on disk.
- Non-fatal findings are now printed as a `[WARN]` block rather than being silently dropped.

### Notes
- **No signed artifact was modified.** `packages/forgen_ai@1.4.0` is the one package in the registry whose tarball carries no `capabilities.json` sidecar. POLICY.md section 2 makes a published version's tarball permanently immutable, and adding the sidecar would change the bytes and therefore both the `sha256` digest and the ed25519 signature. It is therefore grandfathered in `GRANDFATHERED_MISSING_SIDECAR`: CI stays green while the gap is printed on every run. The conforming remedy is a `forgen_ai@1.4.1` release with a sidecar. See `docs/REGISTRY_LAYOUT.md` section 6.
- `index.json`'s per-package `versions` field and `schema.json`'s documented `all_versions` remain two names for one concept. The client reads neither, and `additionalProperties` is unset, so nothing breaks today - but the validator now asserts the two agree wherever both appear.
- Version badge and asset cache-busters moved to 1.0.4 / `?v=1.0.9` so the fix is not served from a stale cache.

---

## [1.0.3] - 2026-09-15

### Added
- **Real public counter (replaces the local-only numbers).** Download and appreciation counts now come from a public, CORS-enabled counter service (Abacus), so every visitor sees the same shared figure instead of a per-browser tally. Reads happen for the packages on screen; a download click or a first-time favourite contributes one.
- **`scripts/init_counters.py`:** Provisions the counters for every package in `index.json` at 0. The service answers `404` for a key nobody has incremented yet - the catalog reads that as a measured zero, but browsers log every 404 as a console error, so provisioning keeps a page load clean. Creating a counter is unauthenticated and idempotent (`409` means "already there"); the script never increments anything.
- **Community counter status pill** in the hero. States plainly whether counts are live, connecting, rate-limited, unavailable, or switched off - so a published figure is never mistaken for a measured one.
- **`src/` module tree.** The 1,318-line `app.js` is split into ten focused modules behind one explicit `Sparks` namespace: `core`, `util`, `markdown`, `store`, `registry`, `counters`, `catalog`, `modal`, `generator`, `actions`. `app.js` is now a 50-line bootstrap that holds no application logic.
- **Test coverage for the new surface:** the DOM harness grew from 48 to 105 assertions, covering counter reads, contributions, the unreachable-service and rate-limited paths, degradation when the counter is disabled, delegated clicks, and the namespace/key contract.

### Changed
- **Honest download figures.** A card badge now shows a *measured* community count, or the value the manifest merely claims, or nothing - and the tooltip names which. A measured value renders solid; a manifest-claimed value renders dashed and amber. A claimed figure is never silently added to a measured one.
- **Copying an install command no longer counts as a download.** `copyAndTrack()` incremented the download counter on a clipboard copy, which would have inflated a real public number with a non-download action. Only clicks on a `.tar` link are counted now.
- **Favourites vs appreciations are separated.** The heart is a local bookmark (instant, reversible, per-browser). The number beside it is the public appreciation count. Because the counter service has no decrement endpoint, a contribution is monotonic: un-favouriting withdraws the bookmark but does not retract the appreciation, and the UI no longer implies otherwise. One contribution per browser per package, guarded so re-favouriting cannot inflate the count.
- **No inline event handler attributes remain in `index.html`.** All 18 `onclick` / `onchange` / `oninput` attributes, plus the two that `app.js` generated inside its own HTML strings, were replaced by a single delegated `data-action` registry in `src/actions.js`. `index.html` can no longer reference a handler the JavaScript does not define - the exact class of bug that produced the 1.0.2 P0. Both the audit test and the DOM harness now assert this.
- **Modal Copy buttons read their source at click time** instead of having a handler re-bound on every open.
- **The grid shows a loading state** while `index.json` is in flight, instead of briefly claiming the registry is empty.
- **Modal metric labels:** "Downloads" and "Appreciations" each carry the source of the number ("public counter" / "manifest, unverified" / "no data"). The sort option "Most Favourited" became "Most Appreciated" to match what it actually sorts on.

### Notes
- **Why classic scripts and not ES modules:** a `<script type="module">` is fetched with CORS semantics and is therefore blocked on a `file://` origin. Opening `index.html` straight from disk is a supported offline path (see `renderFallback`), so the modules are IIFEs that attach to one `Sparks` namespace and load in an explicit order. A regression test asserts that no `<script type="module">` is ever introduced.
- **Counter namespace:** `datara-sparks-catalog`, provisioned fresh at 0. An earlier `datara-sparks` namespace was used while smoke-testing against the live service and was abandoned so that no counter would display a number no user produced.
- **Rate limits:** the service allows 30 requests per 10 seconds per IP and the catalog issues two per visible package. On `429` the catalog enters a cooldown, stops asking, and falls back to published data rather than showing a stale or invented figure.
- **No package manifests, tarballs, signatures, keys or `index.json` entries were modified.** The only `index.json` change is the `url` field corrected to `https://datara-lang.github.io/sparks` (the repository's canonical Pages host). Registry validation output is unchanged.
- The counter is a third-party service and is deliberately optional: `Sparks.CONFIG.counter.enabled = false` reverts the catalog to published-only figures with no network calls.

---

## [1.0.2] - 2026-09-15

### Fixed
- **Broken Manifest Generator Copy Button (P0):** `index.html` bound `copyManifestJson()`, but `app.js` only defined `copyGeneratedManifest()`. Clicking "Copy Manifest JSON" raised `ReferenceError: copyManifestJson is not defined` and copied nothing. `copyManifestJson()` now exists and the old name is kept as an alias.
- **Dead Manifest Preview Element (P0):** The generator wrote to `#gen-preview-code` while `index.html` declares `#manifest-preview`, so the live JSON preview was permanently blank. Both sides now use `#manifest-preview`.
- **Undefined CSS Custom Property (P1):** `.btn-download` referenced `var(--bg-surface)`, which is declared nowhere, so every download button fell back to a transparent background. Changed to `var(--bg-panel)`. A CSS variable audit now reports zero undefined `var()` references.
- **`[hidden]` Overridden by `display` (P1):** `.search-clear` sets an explicit `display: inline-flex`, which defeats the `[hidden]` attribute in every browser. Added `.search-clear[hidden] { display: none; }`.
- **Duplicate Version Manifest Requests (P2):** In-flight `packages/<name>/<version>.json` requests are now tracked separately from the resolved cache, so the same manifest is never fetched twice.
- **`formatBytes` / `formatNumber` on Bad Input (P2):** `NaN`, negative and non-numeric values previously produced `NaN KB`. Both now degrade to `0 B` / `0`.
- **`localStorage` and Clipboard Failures (P2):** All storage access is wrapped so private-browsing modes and sandboxed frames degrade instead of throwing. Clipboard writes fall back to a hidden textarea when the async Clipboard API is unavailable or rejected.
- **Sticky-Header Anchor Offset (P2):** Anchored sections scrolled underneath the sticky header; sections now declare `scroll-margin-top`.
- **`resetFilters()` Did Not Reset Sorting (P3):** The sort selector kept its previous value while the list was re-rendered with default sorting.

### Changed
- **Favourites (heart) control rebuilt:**
  - Removed the heart emoji (U+2764) from the sort option, the filter chip, the modal metric, the button tooltips and the toast text. Every icon in the catalog is now inline SVG; the file contains zero emoji code points.
  - The favourites chip now carries an SVG heart plus a live counter that highlights once at least one spark is bookmarked.
  - Added a "Your Favourites" hero metric, kept in sync with the chip and with storage.
  - Favourites-only view has a dedicated empty state instead of the generic "no results" message.
  - Like controls expose `aria-pressed` and an explicit `aria-label`, and the header button uses a stable hit area.
- **Event handling:** All package-derived values were removed from inline event attributes (`onclick="fn('${...}')"`). Card and modal controls are now wired through delegated `data-action` handlers, which removes an HTML-entity/quoting break-out class of bug and lets a hostile package name be rendered safely.
- **Honest version table:** The "Versions & Downloads" tab previously displayed a fabricated `~10 KB` size and the literal string `verified` for every non-latest release. It now lazily fetches `packages/<name>/<version>.json` and shows the real `size_bytes` and truncated SHA-256, or an explicit `not published` placeholder when the manifest is unavailable.
- **Honest determinism receipt:** The Security tab previously printed a synthesised `{ compiler: "forgen 1.0.0", target: "x86_64" }` receipt for packages that publish none. It now prints a receipt only when the manifest actually contains `determinism_receipt`, and states so otherwise.
- **Markdown renderer:** Consecutive bullets now collapse into a single `<ul>` (previously every item produced its own list), ordered lists render as `<ol>`, `---` renders as `<hr>`, `####` is supported, and `[label](url)` links render with `rel="noopener noreferrer"` while `javascript:` and other unsafe schemes are refused.
- **Accessibility:** The modal is a labelled `role="dialog" aria-modal="true"` with scroll lock, focus moved to the close button on open and restored on close. Tabs expose `role="tab"` / `aria-selected`, the results counter is `aria-live="polite"`, the toast region is `role="status"`, and `:focus-visible` outlines are defined.
- **Legacy Validator De-duplicated:** `verify_registry.py` in the repository root held a second, weaker copy of the integrity checks that skipped ed25519 signatures, JSON-Schema compliance, SemVer monotonicity, archive path-traversal safety, non-latest release manifests and index-to-package consistency - a green run there did not mean the registry was valid. It is now a documented compatibility shim that delegates to `scripts/validate_registry.py` (the script CI runs) and preserves its `run_checks()` return contract.
- **Responsive layout:** Added a mobile breakpoint (stacked controls, single-column grid, full-height modal, edge-to-edge toasts) and `prefers-reduced-motion` support. Package names are now clickable and open the details modal.

### Added
- **`tests/web_dom_harness.js` + `tests/test_web_app_smoke.py`:** A dependency-free Node DOM harness that loads the real `index.html` and `app.js`, renders the catalog and asserts 46 behaviours: emoji-free output, escaping of hostile package names, the full favourites flow, generator wiring, real per-version digests, and Markdown list/link handling.
- **`validate.yml`:** Node 20 setup plus a "Web Catalog Behaviour Tests" step, so the behaviour suite runs on every PR and push to `main`.

### Notes
- No package manifests, tarballs, signatures, keys or `index.json` entries were modified. Registry validation output is unchanged.
- The XSS template audit in `tests/test_web_catalog.py` gained one whitelisted fragment name (`tokensHtml`); the end-to-end escaping guarantee is now additionally covered by executable assertions in the DOM harness.

---

## [1.0.1] - 2026-09-11

### Security Hardening (P0 / P1 Fixes)
- **Cryptographic Hygiene (P0):** Eliminated hardcoded seed keys from `build_seed_packages.py`. Keys are now derived securely from environment variables (`SPARKS_SEED`) or local `.env` files.
- **Official Seed Key Rotation:** Re-signed all 5 official seed packages (`crypto_core`, `math_simd`, `http_router`, `lockstep_engine`, `toy_kv`) with a fresh 32-byte Ed25519 key. The initial development key (`b47a03ff...`) has been revoked and recorded in the registry key rotation ledger.
- **Key Rotation Ledger:** Added formal `key_rotation` tracking in `index.json` and optional `key_id` in `schema.json` to monitor key lifecycle and reject revoked credentials.
- **Honest Web Generator (P0):** Replaced dummy hash (`e3b0c442...`) and hardcoded foreign signature in `app.js` with browser-native SHA-256 calculation via `crypto.subtle.digest` on uploaded tarballs.
- **XSS Audit:** Audited and strictly sanitized all dynamic DOM insertions using `escapeHtml()` across the web catalog.

### Added
- **CI Pull Request Validation Workflow (`.github/workflows/validate.yml`):** Automatically validates schema compliance, SHA-256 integrity, Ed25519 signatures, capability sidecar parity, SemVer format, archive path safety, and index consistency on every pull request and push to `main`.
- **CLI Packaging Tool (`scripts/spark_publish.py`):** Authoring CLI that packages deterministic POSIX ustar archives (`mtime=1700000000`, `uid=0`, `gid=0`), calculates SHA-256, signs with Ed25519, and generates pull-request-ready manifests.
- **Local Validator (`scripts/validate_registry.py`):** Standalone integrity checker enforcing the same 7 validation invariants locally and in CI.
- **Automated Client E2E Testing (`scripts/e2e_client.ps1`):** End-to-end integration script verifying package resolution, signature checking, and installation using the real `dpm` binary against local HTTP endpoints.
- **Compiler Remote Test (`tests/test_sparks_remote.rs`):** Added remote Sparks resolution test suite in the Datara compiler repository.
- **Negative Test Fixtures (`tests/test_ci_validation_fixtures.py`):** 6 regression fixtures verifying rejection of invalid schemas, corrupted checksums, tampered signatures, capability mismatches, path traversal attacks, and invalid SemVer.
- **Documentation Suite:**
  - `SECURITY.md`: Vulnerability disclosure guidelines, SLA, and contacts.
  - `POLICY.md`: Namespace reservation rules (`sparks/datara-*`), package immutability, and security takedown procedures.
  - `docs/KEY_MANAGEMENT.md`: Author Ed25519 key creation, signing, and rotation guide.
  - `docs/THREAT_MODEL.md`: Comprehensive threat model and trust boundary definitions.
  - `docs/OPERATIONS.md`: Zero-service uptime architecture, backup protocols, and disaster recovery.
  - `.github/PULL_REQUEST_TEMPLATE.md`: Publisher checklist for pull requests.
  - `.github/CODEOWNERS`: Enforced maintainer review policies for `packages/` and `tarballs/`.

### Changed
- **Digest Normalization (P1):** Standardized SHA-256 checksums everywhere to canonical clean 64-character lowercase hex strings (without `sha256:` prefix) in `schema.json`, `index.json`, and all package manifests.
- **Accurate Content Sizing (P2):** Replaced tar-padding block size (`10240`) with actual unpadded content size (`size_bytes`) in manifests and `index.json`.
- **Deterministic Metadata:** Replaced dynamic execution timestamps with deterministic timestamps derived from git commit history.
- **Determinism Receipts:** Omitted unverified MD5 receipt stubs from static seed manifests in favor of honest verifiable metadata.

---

## [1.0.0] - 2026-09-11

### Initial Release
- Initial release of Sparks capability-native package registry for Datara 1.0.0.
- Sparse index endpoints (`/index.json`, `/packages/<name>.json`, `/packages/<name>/<version>.json`).
- Initial 5 official seed packages (`crypto_core`, `math_simd`, `http_router`, `lockstep_engine`, `toy_kv`).
- Static web catalog with search, filtering, and manifest preview.
