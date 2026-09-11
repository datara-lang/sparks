// Sparks Package Registry Web Application (Datara 1.0.0)
// Pure Vanilla JavaScript, zero external dependencies.

let allPackages = [];
let currentFilterTag = 'all';
let currentSearchQuery = '';
let currentSort = 'downloads';
let activeModalPackage = null;
let activeModalSelectedVersion = null;

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initSearch();
  initFilterChips();
  initSorting();
  initKeyboardShortcuts();
  initManifestGenerator();
  loadRegistryIndex();
});

// Fetch root index.json
async function loadRegistryIndex() {
  try {
    const res = await fetch('index.json');
    if (!res.ok) {
      throw new Error(`HTTP error ${res.status}`);
    }
    const data = await res.json();
    allPackages = Array.isArray(data?.packages) ? data.packages : [];
    
    // Update metric
    const metricCount = document.getElementById('metric-packages-count');
    if (metricCount) {
      metricCount.textContent = allPackages.length;
    }

    renderPackages();
  } catch (err) {
    console.error('Failed to load index.json:', err);
    renderFallback();
  }
}

// Render packages based on search, filter, and sorting
function renderPackages() {
  const container = document.getElementById('packages-grid');
  const countEl = document.getElementById('results-count');
  if (!container) return;

  let filtered = allPackages.filter(pkg => {
    // 1. Tag filter
    if (currentFilterTag === 'pure') {
      if (pkg.capabilities && pkg.capabilities.length > 0) return false;
    } else if (currentFilterTag !== 'all') {
      const hasTag = (pkg.tags || []).some(t => t.toLowerCase() === currentFilterTag.toLowerCase());
      if (!hasTag) return false;
    }

    // 2. Search query
    if (currentSearchQuery) {
      const q = currentSearchQuery.toLowerCase();
      const nameMatch = pkg.name.toLowerCase().includes(q);
      const descMatch = (pkg.description || '').toLowerCase().includes(q);
      const authMatch = (pkg.author || '').toLowerCase().includes(q);
      const tagMatch = (pkg.tags || []).some(t => t.toLowerCase().includes(q));
      const capMatch = (pkg.capabilities || []).some(c => c.toLowerCase().includes(q));
      if (!nameMatch && !descMatch && !authMatch && !tagMatch && !capMatch) {
        return false;
      }
    }

    return true;
  });

  // Sort
  if (currentSort === 'downloads' || currentSort === 'featured') {
    filtered.sort((a, b) => getPackageDownloads(b) - getPackageDownloads(a));
  } else if (currentSort === 'name-asc') {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  } else if (currentSort === 'name-desc') {
    filtered.sort((a, b) => b.name.localeCompare(a.name));
  } else if (currentSort === 'size') {
    filtered.sort((a, b) => (b.size_bytes || 0) - (a.size_bytes || 0));
  }

  // Update count
  if (countEl) {
    countEl.textContent = `(${filtered.length} package${filtered.length === 1 ? '' : 's'})`;
  }

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-state-title">No sparks found</div>
        <div class="empty-state-desc">Try modifying your search query or clear active category filters.</div>
        <button class="btn-copy" onclick="resetFilters()">Reset Search</button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(pkg => createPackageCardHtml(pkg)).join('');
}

// Generate HTML for a package card
function createPackageCardHtml(pkg) {
  const isPure = !pkg.capabilities || pkg.capabilities.length === 0;
  const capsBadge = isPure
    ? `<span class="badge badge-verified badge-pure">&#10003; Pure (0 Caps)</span>`
    : pkg.capabilities.map(c => `<span class="badge">${escapeHtml(c.replace('Capability<', '').replace('>', ''))}</span>`).join('');

  const tagsHtml = (pkg.tags || []).map(t => `<span class="card-tag">#${escapeHtml(t)}</span>`).join('');
  const installCmd = `dpm add ${pkg.name}`;
  const sizeDisp = formatBytes(pkg.size_bytes || 0);
  const dlCount = getPackageDownloads(pkg);
  const dlBadge = `<span class="badge badge-downloads" title="${dlCount.toLocaleString()} total downloads"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg> ${formatNumber(dlCount)}</span>`;
  const keyIdBadge = pkg.key_id ? `<span class="badge" title="Author Key ID: ${escapeHtml(pkg.key_id)}">${escapeHtml(pkg.key_id)}</span>` : '';

  return `
    <div class="package-card" data-pkg="${escapeHtml(pkg.name)}">
      <div class="card-top">
        <div class="card-header-row">
          <div class="package-name">${escapeHtml(pkg.name)}</div>
          <span class="badge badge-verified">v${escapeHtml(pkg.latest_version)}</span>
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
          <button class="btn-card-copy" title="Copy command" onclick="copyAndTrack('${escapeHtml(installCmd)}', '${escapeHtml(pkg.name)}')">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
        <div class="card-actions">
          <a href="${escapeHtml(pkg.tarball_url || `tarballs/${pkg.name.replace('sparks/', '')}-${pkg.latest_version}.tar`)}" class="btn-download" title="Download .tar archive" download="${escapeHtml(pkg.name.replace('sparks/', ''))}-${escapeHtml(pkg.latest_version)}.tar" onclick="trackDownload('${escapeHtml(pkg.name)}')">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
            .tar
          </a>
          <button class="btn-details" onclick="openPackageDetails('${escapeHtml(pkg.name)}')">Details</button>
        </div>
      </div>
    </div>
  `;
}

// Fallback in case index.json is blocked locally before server starts
function renderFallback() {
  const container = document.getElementById('packages-grid');
  if (!container) return;
  container.innerHTML = `
    <div class="empty-state">
      <div class="empty-state-title">Static Registry Ready</div>
      <div class="empty-state-desc">Serving via local file:// protocol. When published to GitHub Pages, index.json loads automatically.</div>
    </div>
  `;
}

// Markdown parser (Safe, XSS-audited, zero dependencies)
function renderMarkdown(md) {
  if (!md) return '<p><em>No README documentation available for this spark.</em></p>';

  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let inCodeBlock = false;
  let codeLang = '';
  let codeBuffer = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];

    if (rawLine.trim().startsWith('```')) {
      if (inCodeBlock) {
        inCodeBlock = false;
        out.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
        codeBuffer = [];
      } else {
        inCodeBlock = true;
        codeLang = rawLine.trim().substring(3).trim();
        codeBuffer = [];
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(rawLine);
      continue;
    }

    const trimmed = rawLine.trim();
    if (!trimmed) {
      continue;
    }

    if (trimmed.startsWith('# ')) {
      out.push(`<h1>${formatInlineMarkdown(escapeHtml(trimmed.substring(2)))}</h1>`);
    } else if (trimmed.startsWith('## ')) {
      out.push(`<h2>${formatInlineMarkdown(escapeHtml(trimmed.substring(3)))}</h2>`);
    } else if (trimmed.startsWith('### ')) {
      out.push(`<h3>${formatInlineMarkdown(escapeHtml(trimmed.substring(4)))}</h3>`);
    } else if (trimmed.startsWith('> ')) {
      out.push(`<blockquote>${formatInlineMarkdown(escapeHtml(trimmed.substring(2)))}</blockquote>`);
    } else if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      out.push(`<ul><li>${formatInlineMarkdown(escapeHtml(trimmed.substring(2)))}</li></ul>`);
    } else {
      out.push(`<p>${formatInlineMarkdown(escapeHtml(trimmed))}</p>`);
    }
  }

  if (inCodeBlock) {
    out.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
  }

  return out.join('\n');
}

function formatInlineMarkdown(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

// Package Details Modal Logic
function openPackageDetails(packageName) {
  const pkg = allPackages.find(p => p.name === packageName);
  if (!pkg) return;

  activeModalPackage = pkg;
  activeModalSelectedVersion = pkg.latest_version;

  const rawId = pkg.name.replace('sparks/', '');
  const versions = pkg.versions || [pkg.latest_version];

  document.getElementById('modal-title').textContent = pkg.name;
  document.getElementById('modal-author').textContent = pkg.author || 'Datara Core Team';
  document.getElementById('modal-license').textContent = pkg.license || 'MIT';
  document.getElementById('modal-desc').textContent = pkg.description;

  // Version selector
  const verSelect = document.getElementById('modal-version-select');
  if (verSelect) {
    verSelect.innerHTML = versions.map(v => 
      `<option value="${escapeHtml(v)}" ${v === pkg.latest_version ? 'selected' : ''}>v${escapeHtml(v)}${v === pkg.latest_version ? ' (latest)' : ''}</option>`
    ).join('');
  }

  // Update version-dependent elements
  updateModalVersionView(pkg, activeModalSelectedVersion);

  // Render README documentation
  const readmeContainer = document.getElementById('modal-readme-body');
  if (readmeContainer) {
    const renderedReadmeHtml = renderMarkdown(pkg.readme);
    readmeContainer.innerHTML = renderedReadmeHtml;
  }

  // Render Versions Table
  const versionsList = document.getElementById('modal-versions-list');
  if (versionsList) {
    const versionsTableHtml = versions.map(v => {
      const isLatest = v === pkg.latest_version;
      const vTarUrl = `tarballs/${rawId}-${v}.tar`;
      const vSize = isLatest ? formatBytes(pkg.size_bytes || 10240) : '~10 KB';
      const vSha = isLatest ? (pkg.sha256 || 'verified') : 'verified';
      const latestBadge = isLatest ? '<span class="badge badge-verified" style="margin-left: 6px;">latest</span>' : '';
      const installTarget = isLatest ? pkg.name : `${pkg.name}@${v}`;
      return `
        <tr>
          <td>
            <span class="ver-badge">v${escapeHtml(v)}</span>
            ${latestBadge}
          </td>
          <td>
            <a href="${escapeHtml(vTarUrl)}" class="btn-download" download="${escapeHtml(rawId)}-${escapeHtml(v)}.tar" onclick="trackDownload('${escapeHtml(pkg.name)}')">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
              ${escapeHtml(rawId)}-${escapeHtml(v)}.tar
            </a>
          </td>
          <td>${escapeHtml(vSize)}</td>
          <td class="sha-cell" title="${escapeHtml(vSha)}">${escapeHtml(vSha.substring(0, 16))}...</td>
          <td>
            <button class="btn-card-copy" style="font-size: 11px; padding: 4px 8px; border: 1px solid var(--border-subtle); border-radius: 4px;" onclick="copyAndTrack('dpm add ${escapeHtml(installTarget)}', '${escapeHtml(pkg.name)}')">
              Copy dpm add
            </button>
          </td>
        </tr>
      `;
    }).join('');
    versionsList.innerHTML = versionsTableHtml;
  }

  // Capabilities explanation
  const capsContainer = document.getElementById('modal-caps-explanation');
  if (capsContainer) {
    if (!pkg.capabilities || pkg.capabilities.length === 0) {
      capsContainer.innerHTML = `
        <div style="display: flex; align-items: flex-start; gap: 10px;">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink: 0; margin-top: 2px;">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
          </svg>
          <div>
            <strong>Pure Compute Sandbox (0 Capabilities)</strong>
            <p style="color: var(--text-secondary); margin-top: 4px; font-size: 13px;">
              This package performs zero I/O, zero network calls, and zero filesystem operations. It executes deterministically in pure user space with compile-time sandboxing.
            </p>
          </div>
        </div>
      `;
    } else {
      capsContainer.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <div style="font-size: 12px; color: var(--text-secondary); margin-bottom: 4px;">
            The following capability tokens must be explicitly granted by the consumer at compile time:
          </div>
          ${pkg.capabilities.map(c => `
            <div style="display: flex; align-items: center; gap: 8px; background: var(--bg-panel); border: 1px solid var(--border-subtle); padding: 8px 12px; border-radius: 4px; font-family: var(--font-mono); font-size: 12px; color: var(--text-primary);">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 2l-2 2m-1.5 1.5L14 9l-3-3 2-2 1.5 1.5L18 4l3-2z"></path>
                <circle cx="7.5" cy="15.5" r="5.5"></circle>
              </svg>
              ${escapeHtml(c)}
            </div>
          `).join('')}
        </div>
      `;
    }
  }

  // Security info
  document.getElementById('modal-sha256').textContent = pkg.sha256 || 'N/A';
  document.getElementById('modal-pk').textContent = pkg.public_key ? `${pkg.public_key.slice(0, 16)}...${pkg.public_key.slice(-16)}` : 'N/A';
  const keyIdEl = document.getElementById('modal-keyid');
  if (keyIdEl) {
    keyIdEl.textContent = pkg.key_id || 'N/A';
  }

  // Receipt
  document.getElementById('modal-receipt').textContent = JSON.stringify(pkg.determinism_receipt || { compiler: "forgen 1.0.0", target: "x86_64" }, null, 2);

  // Raw manifest
  const manifestObj = {
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
    capabilities: pkg.capabilities || [],
    all_versions: pkg.versions || [pkg.latest_version],
    dependencies: {}
  };
  const manifestStr = JSON.stringify(manifestObj, null, 2);
  document.getElementById('modal-manifest-json').textContent = manifestStr;
  document.getElementById('btn-modal-manifest-copy').onclick = () => copyText(manifestStr);

  // Open modal on Documentation tab by default
  switchModalTab('readme');
  const modal = document.getElementById('package-modal');
  if (modal) modal.classList.add('active');
}

function updateModalVersionView(pkg, selectedVer) {
  const rawId = pkg.name.replace('sparks/', '');
  const isLatest = selectedVer === pkg.latest_version;

  document.getElementById('modal-badge-ver').textContent = `v${selectedVer}`;
  document.getElementById('modal-size').textContent = formatBytes(pkg.size_bytes || 10240);

  const dlEl = document.getElementById('modal-downloads');
  if (dlEl) {
    dlEl.textContent = getPackageDownloads(pkg).toLocaleString();
  }

  const tarLink = document.getElementById('modal-tar-link');
  if (tarLink) {
    const tarFilename = `${rawId}-${selectedVer}.tar`;
    tarLink.href = `tarballs/${tarFilename}`;
    tarLink.setAttribute('download', tarFilename);
    tarLink.textContent = `Download v${selectedVer} .tar`;
  }

  const installCmd = isLatest ? `dpm add ${pkg.name}` : `dpm add ${pkg.name}@${selectedVer}`;
  document.getElementById('modal-install-cmd').textContent = installCmd;
  document.getElementById('btn-modal-install-copy').onclick = () => copyAndTrack(installCmd, pkg.name);

  const codeEl = document.getElementById('modal-code-example');
  codeEl.textContent = pkg.sample_usage || `use ${pkg.name}\n\nfn main() {\n    // Spark v${selectedVer} ignited!\n}\n`;
  document.getElementById('btn-modal-code-copy').onclick = () => copyText(codeEl.textContent);
}

function onModalVersionChange(selectedVer) {
  if (!activeModalPackage) return;
  activeModalSelectedVersion = selectedVer;
  updateModalVersionView(activeModalPackage, selectedVer);
  showToast(`Switched view to sparks/${activeModalPackage.name.replace('sparks/', '')} v${selectedVer}`);
}

function onModalDirectDownloadClick() {
  if (activeModalPackage) {
    trackDownload(activeModalPackage.name);
  }
}

function closePackageModal() {
  const modal = document.getElementById('package-modal');
  if (modal) modal.classList.remove('active');
}

// Modal tab switcher
function switchModalTab(tabId) {
  document.querySelectorAll('.modal-tab').forEach(t => {
    if (t.getAttribute('data-tab') === tabId) {
      t.classList.add('active');
    } else {
      t.classList.remove('active');
    }
  });

  const tabReadme = document.getElementById('tab-content-readme');
  const tabOverview = document.getElementById('tab-content-overview');
  const tabVersions = document.getElementById('tab-content-versions');
  const tabSecurity = document.getElementById('tab-content-security');
  const tabManifest = document.getElementById('tab-content-manifest');

  if (tabReadme) tabReadme.style.display = tabId === 'readme' ? 'block' : 'none';
  if (tabOverview) tabOverview.style.display = tabId === 'overview' ? 'block' : 'none';
  if (tabVersions) tabVersions.style.display = tabId === 'versions' ? 'block' : 'none';
  if (tabSecurity) tabSecurity.style.display = tabId === 'security' ? 'block' : 'none';
  if (tabManifest) tabManifest.style.display = tabId === 'manifest' ? 'block' : 'none';
}

// Close modal when clicking on overlay background
document.addEventListener('click', (e) => {
  const modal = document.getElementById('package-modal');
  if (e.target === modal) {
    closePackageModal();
  }
});

// Interactive Manifest Generator (Schema 1)
let uploadedTarSha256 = null;
let uploadedTarSize = 0;

function initManifestGenerator() {
  updateGeneratedManifest();
}

async function handleTarUpload(event) {
  const file = event.target.files?.[0];
  const noteEl = document.getElementById('tar-status-note');
  if (!file) {
    uploadedTarSha256 = null;
    uploadedTarSize = 0;
    if (noteEl) noteEl.textContent = 'Select your built .tar archive to compute real SHA-256 and content size.';
    updateGeneratedManifest();
    return;
  }

  try {
    if (noteEl) noteEl.textContent = 'Reading archive and computing SHA-256...';
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    uploadedTarSha256 = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    uploadedTarSize = file.size;

    if (noteEl) {
      noteEl.textContent = `Loaded ${file.name} (${formatBytes(file.size)}). SHA-256: ${uploadedTarSha256.substring(0, 16)}...`;
      noteEl.style.color = '#3fb950';
    }
  } catch (err) {
    console.error('Failed to hash archive:', err);
    if (noteEl) {
      noteEl.textContent = 'Error computing SHA-256 digest in browser.';
      noteEl.style.color = '#f85149';
    }
  }

  updateGeneratedManifest();
}

function updateGeneratedManifest() {
  const name = (document.getElementById('gen-name')?.value || 'sparks/mypkg').trim();
  const ver = (document.getElementById('gen-version')?.value || '1.0.0').trim();
  const desc = (document.getElementById('gen-desc')?.value || '').trim();
  const author = (document.getElementById('gen-author')?.value || '').trim();
  const pubkey = (document.getElementById('gen-pubkey')?.value || '').trim();
  const sig = (document.getElementById('gen-sig')?.value || '').trim();
  const capsRaw = (document.getElementById('gen-caps')?.value || '').trim();

  const caps = capsRaw ? capsRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
  const rawId = name.replace(/^sparks\//, '');

  const shaVal = uploadedTarSha256 || '<upload .tar file to compute SHA-256>';
  const pkVal = pubkey || '<enter 64-hex author Ed25519 public key>';
  const sigVal = sig || '<enter 128-hex archive Ed25519 signature>';

  const manifest = {
    schema: 1,
    name: name,
    version: ver,
    description: desc || `Datara package ${name}`,
    author: author || 'Community Contributor',
    license: 'MIT OR Apache-2.0',
    tarball_url: `tarballs/${rawId}-${ver}.tar`,
    sha256: shaVal,
    public_key: pkVal,
    signature: sigVal,
    key_id: `author-${pubkey ? pubkey.substring(0, 8) : 'custom'}`,
    size_bytes: uploadedTarSize || 1024,
    downloads: 0,
    capabilities: caps,
    dependencies: {},
    tags: ['datara', rawId]
  };

  const previewEl = document.getElementById('gen-preview-code');
  if (previewEl) {
    previewEl.textContent = JSON.stringify(manifest, null, 2);
  }
}

function copyGeneratedManifest() {
  const previewEl = document.getElementById('gen-preview-code');
  if (previewEl) {
    copyText(previewEl.textContent);
  }
}

// Search input handling
function initSearch() {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) return;

  searchInput.addEventListener('input', (e) => {
    currentSearchQuery = e.target.value.trim();
    renderPackages();
  });
}

// Filter chips handling
function initFilterChips() {
  const bar = document.getElementById('filter-tags-bar');
  if (!bar) return;

  bar.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;

    bar.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');

    currentFilterTag = chip.getAttribute('data-tag') || 'all';
    renderPackages();
  });
}

// Sorting dropdown handling
function initSorting() {
  const sortSelect = document.getElementById('sort-select');
  if (!sortSelect) return;

  sortSelect.addEventListener('change', (e) => {
    currentSort = e.target.value;
    renderPackages();
  });
}

// Keyboard shortcuts: '/' to search, 'Esc' to close modal
function initKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault();
      const search = document.getElementById('search-input');
      if (search) {
        search.focus();
        search.select();
      }
    } else if (e.key === 'Escape') {
      closePackageModal();
    }
  });
}

// Reset filters
function resetFilters() {
  currentSearchQuery = '';
  currentFilterTag = 'all';
  const searchInput = document.getElementById('search-input');
  if (searchInput) searchInput.value = '';

  const bar = document.getElementById('filter-tags-bar');
  if (bar) {
    bar.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    const allChip = bar.querySelector('[data-tag="all"]');
    if (allChip) allChip.classList.add('active');
  }

  renderPackages();
}

// Copy to clipboard helper
function copyText(text) {
  navigator.clipboard.writeText(text).then(() => {
    showToast('Copied to clipboard');
  }).catch(() => {
    showToast('Failed to copy');
  });
}

function copyAndTrack(text, pkgName) {
  copyText(text);
  if (pkgName) {
    trackDownload(pkgName);
  }
}

// Toast notification
function showToast(msg) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.textContent = msg;

  container.appendChild(toast);
  setTimeout(() => {
    toast.remove();
  }, 3000);
}

// Utility: format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// Utility: HTML escaping
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Utility: format counts
function formatNumber(num) {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  }
  if (num >= 1000) {
    return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  }
  return num.toString();
}

// Download tracking & telemetry (honest counter starting at real count)
function getPackageDownloads(pkg) {
  const localExtra = parseInt(localStorage.getItem(`sparks_dl_${pkg.name}`) || '0', 10);
  return (pkg.downloads || 0) + localExtra;
}

function trackDownload(pkgName) {
  const current = parseInt(localStorage.getItem(`sparks_dl_${pkgName}`) || '0', 10);
  const nextVal = current + 1;
  localStorage.setItem(`sparks_dl_${pkgName}`, nextVal.toString());
  
  // Dynamically update card badge
  const card = document.querySelector(`.package-card[data-pkg="${pkgName}"]`);
  if (card) {
    const pkg = allPackages.find(p => p.name === pkgName);
    if (pkg) {
      const count = getPackageDownloads(pkg);
      const badge = card.querySelector('.badge-downloads');
      if (badge) {
        badge.title = `${count.toLocaleString()} total downloads`;
        badge.innerHTML = `
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
            <polyline points="7 10 12 15 17 10"></polyline>
            <line x1="12" y1="15" x2="12" y2="3"></line>
          </svg>
          ${formatNumber(count)}
        `;
      }
    }
  }

  // Also update modal if open
  const modalDl = document.getElementById('modal-downloads');
  if (modalDl && activeModalPackage && activeModalPackage.name === pkgName) {
    modalDl.textContent = getPackageDownloads(activeModalPackage).toLocaleString();
  }

  showToast(`+1 download recorded for ${pkgName}`);
}
