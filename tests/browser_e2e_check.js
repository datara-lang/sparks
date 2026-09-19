// Real-browser end-to-end verification of the Sparks catalog.
// Drives the delegated-action registry, the detail modal, and the counter pill.
const { chromium } = require('playwright');

const BASE = process.env.SPARKS_BASE || 'http://127.0.0.1:8099';

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  [' + detail + ']' : ''}`);
}

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const consoleErrors = [];
  const pageErrors = [];
  const failedRequests = [];
  let counterIntercepts = 0;

  /* Never touch the live public counter from a test.
   *
   * The counter endpoint is an absolute URL in Sparks.CONFIG, so a locally served
   * registry still talks to the real service. This suite clicks hearts and download
   * links, and the counter has no decrement endpoint, so every run would add
   * permanent, unattributable likes to a public number. Fulfilling the requests
   * locally keeps the whole counter path exercised - reads resolve, hits are
   * accepted, the status pill reports live - without writing anything.
   */
  await page.route('**://abacus.jasoncameron.dev/**', route => {
    counterIntercepts += 1;
    const url = route.request().url();
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ value: url.includes('/get/') ? 0 : 1 }),
    });
  });

  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('requestfailed', r => failedRequests.push(r.url()));
  page.on('response', r => { if (r.status() >= 400) failedRequests.push(`${r.status()} ${r.url()}`); });

  await page.goto(BASE, { waitUntil: 'networkidle' });

  // 1. Grid renders (cards or empty state)
  const cards = await page.locator('[data-action="details"]').count();
  if (cards > 0) {
    check('package cards render', cards > 0, `${cards} cards`);

    // 2. Download badges show a real, sourced number
    const badges = await page.locator('.badge-downloads').count();
    const sources = await page.$$eval('.badge-downloads', els =>
      els.map(e => e.getAttribute('data-source')));
    check('download badges render', badges === cards, `${badges} badges`);
    check('every badge declares a source',
      sources.every(s => ['public', 'manifest', 'none'].includes(s)),
      [...new Set(sources)].join(','));
  } else {
    // Empty registry verification
    await page.waitForSelector('.empty-state', { timeout: 10000 });
    const emptyCount = await page.locator('.empty-state').count();
    check('empty state renders when registry is clean', emptyCount > 0);
  }

  // 3. Counter status pill resolves (not stuck in "connecting")
  await page.waitForTimeout(2500);
  const counterState = await page.getAttribute('#counter-status', 'data-state');
  const counterText = (await page.textContent('#counter-status-text') || '').trim();
  check('counter pill resolves', ['live', 'degraded', 'offline', 'disabled'].includes(counterState),
    `${counterState}: ${counterText}`);

  if (cards > 0) {
    // 4. Delegated filter works, and the "All Sparks" chip restores the grid
    await page.click('[data-action="filter"][data-tag="crypto"]');
    await page.waitForTimeout(300);
    const filtered = await page.locator('[data-action="details"]').count();
    check('delegated filter narrows the grid', filtered < cards, `${filtered} after tag=crypto`);
    await page.click('[data-action="filter"][data-tag="all"]');
    await page.waitForTimeout(300);
    const restored = await page.locator('[data-action="details"]').count();
    check('All Sparks chip restores the grid', restored === cards, `${restored} cards`);

    // 4b. reset-filters lives in the empty state, so it only appears on no results
    await page.fill('#search-input', 'zzz_no_such_package');
    await page.waitForTimeout(400);
    const resetVisible = await page.locator('[data-action="reset-filters"]').isVisible();
    check('empty state offers reset-filters', resetVisible);
    await page.click('[data-action="reset-filters"]');
    await page.waitForTimeout(400);
    const afterReset = await page.locator('[data-action="details"]').count();
    check('reset-filters restores the grid', afterReset === cards, `${afterReset} cards`);

    // 5. Search works
    await page.fill('#search-input', 'toy_kv');
    await page.waitForTimeout(400);
    const searched = await page.locator('[data-action="details"]').count();
    check('search narrows the grid', searched === 1, `${searched} for "toy_kv"`);
    await page.click('[data-action="clear-search"]');
    await page.waitForTimeout(400);
    const afterClear = await page.locator('[data-action="details"]').count();
    check('clear-search restores the grid', afterClear === cards, `${afterClear} cards`);

    // 5b. REGRESSION: typing in search must not swallow the next in-grid click.
    await page.fill('#search-input', 'core');
    await page.waitForTimeout(400);
    const regCards = await page.locator('[data-action="details"]').count();
    check('partial search keeps results', regCards > 0, `${regCards} cards`);
    const regFav = page.locator('[data-action="favorite"]').first();
    const regBefore = await regFav.getAttribute('aria-pressed');
    await regFav.click();
    await page.waitForTimeout(350);
    const regAfter = await regFav.getAttribute('aria-pressed');
    check('first in-grid click after typing is not swallowed', regBefore !== regAfter,
      `${regBefore} -> ${regAfter}`);
    await regFav.click();
    await page.waitForTimeout(300);
    await page.click('[data-action="clear-search"]');
    await page.waitForTimeout(400);

    // 6. Favourite toggle round-trips
    const firstFav = page.locator('[data-action="favorite"]').first();
    const before = await firstFav.getAttribute('aria-pressed');
    await firstFav.click();
    await page.waitForTimeout(250);
    const after = await firstFav.getAttribute('aria-pressed');
    check('favourite toggles aria-pressed', before !== after, `${before} -> ${after}`);
    await firstFav.click();
    await page.waitForTimeout(250);
    const back = await firstFav.getAttribute('aria-pressed');
    check('favourite toggles back', back === before, `${after} -> ${back}`);

    // 7. Modal opens and shows a real digest, not a placeholder
    await page.locator('[data-action="details"]').first().click();
    await page.waitForSelector('#package-modal.active', { timeout: 5000 });
    await page.waitForTimeout(1500);
    const modalName = (await page.textContent('#modal-title') || '').trim();
    check('modal opens with a package name', /^sparks\//.test(modalName), modalName);
    const shaCells = await page.$$eval('[data-role="sha"]', els =>
      els.map(e => e.textContent.trim()).filter(Boolean));
    const realDigests = shaCells.filter(s => /^[0-9a-f]{12,}/.test(s));
    check('modal shows real SHA digests', realDigests.length > 0,
      realDigests[0] ? realDigests[0].slice(0, 18) + '...' : 'none');
    check('no unresolved placeholders in digest cells',
      !shaCells.some(s => s.includes('<') || s.includes('...') && !/^[0-9a-f]/.test(s)),
      `${shaCells.length} cells`);

    // 8. Modal tab + close
    await page.click('[data-action="modal-tab"][data-tab="versions"]');
    await page.waitForTimeout(400);
    const versionRows = await page.locator('#modal-versions-list tr[data-version-row]').count();
    check('versions tab lists releases', versionRows > 0, `${versionRows} rows`);
    await page.click('[data-action="close-modal"]');
    await page.waitForTimeout(500);
    const modalClosed = !(await page.locator('#package-modal').evaluate(el => el.classList.contains('active')));
    check('modal closes', modalClosed);
  } else {
    // Empty registry: verify search input works without throwing
    await page.fill('#search-input', 'test');
    await page.waitForTimeout(200);
    await page.click('[data-action="clear-search"]');
    await page.waitForTimeout(200);
    check('empty registry search does not throw', true);
  }

  // 9. No errors at all
  check('counter service requests were intercepted, not sent live',
    counterIntercepts > 0, `${counterIntercepts} intercepted`);
  check('zero page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  check('zero console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
  check('zero failed requests', failedRequests.length === 0, failedRequests.slice(0, 3).join(' | '));

  await browser.close();

  const failed = results.filter(r => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} browser checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error('HARNESS ERROR', e); process.exit(2); });
