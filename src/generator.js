/* Sparks catalog - interactive Schema 1 manifest generator.
 *
 * The preview is a starting point for a pull request, not a finished manifest.
 * Values the browser cannot know are left as explicit angle-bracket
 * placeholders and the status line lists them by name, so a contributor cannot
 * mistake an unfinished manifest for a valid one.
 */

(function (Sparks) {
  'use strict';

  var util = Sparks.util;
  var setText = util.setText;

  var PLACEHOLDER_SHA = '<upload .tar file to compute SHA-256>';
  var PLACEHOLDER_KEY = '<enter 64-hex author Ed25519 public key>';
  var PLACEHOLDER_SIG = '<enter 128-hex archive Ed25519 signature>';

  var uploadedTarSha256 = null;
  var uploadedTarSize = 0;

  function fieldValue(id, fallback) {
    var el = document.getElementById(id);
    var value = el && typeof el.value === 'string' ? el.value.trim() : '';
    return value || fallback;
  }

  function onTarUpload(event) {
    var file = event && event.target && event.target.files ? event.target.files[0] : null;
    var noteEl = document.getElementById('tar-status-note');

    if (!file) {
      uploadedTarSha256 = null;
      uploadedTarSize = 0;
      if (noteEl) {
        noteEl.textContent = 'Select your built .tar archive to compute the real SHA-256 and content size.';
        noteEl.style.color = '';
      }
      update();
      return;
    }

    if (noteEl) noteEl.textContent = 'Reading archive and computing SHA-256...';

    file.arrayBuffer().then(function (buffer) {
      return crypto.subtle.digest('SHA-256', buffer);
    }).then(function (hashBuffer) {
      var hashArray = Array.from(new Uint8Array(hashBuffer));
      uploadedTarSha256 = hashArray.map(function (b) { return b.toString(16).padStart(2, '0'); }).join('');
      uploadedTarSize = file.size;

      if (noteEl) {
        noteEl.textContent = 'Loaded ' + file.name + ' (' + util.formatBytes(file.size) + '). '
          + 'SHA-256: ' + uploadedTarSha256.substring(0, 16) + '...';
        noteEl.style.color = 'var(--accent-ok)';
      }
      update();
    }).catch(function (err) {
      console.error('Failed to hash archive:', err);
      uploadedTarSha256 = null;
      uploadedTarSize = 0;
      if (noteEl) {
        noteEl.textContent = 'Error computing SHA-256 digest in browser.';
        noteEl.style.color = 'var(--accent-danger)';
      }
      update();
    });
  }

  function buildManifest() {
    var name = fieldValue('gen-name', 'sparks/mypkg');
    var version = fieldValue('gen-version', '1.0.0');
    var rawId = util.rawPackageId(name);
    var publicKey = fieldValue('gen-pubkey', '');
    var capsRaw = fieldValue('gen-caps', '');

    var capabilities = capsRaw
      ? capsRaw.split(',').map(function (s) { return s.trim(); }).filter(Boolean)
      : [];

    return {
      schema: 1,
      name: name,
      version: version,
      description: fieldValue('gen-desc', 'Datara package ' + name),
      author: fieldValue('gen-author', 'Community Contributor'),
      license: 'MIT OR Apache-2.0',
      tarball_url: 'tarballs/' + rawId + '-' + version + '.tar',
      sha256: uploadedTarSha256 || PLACEHOLDER_SHA,
      public_key: publicKey || PLACEHOLDER_KEY,
      signature: fieldValue('gen-sig', '') || PLACEHOLDER_SIG,
      key_id: 'author-' + (publicKey ? publicKey.substring(0, 8) : 'custom'),
      size_bytes: uploadedTarSize || 0,
      downloads: 0,
      likes: 0,
      capabilities: capabilities,
      dependencies: {},
      tags: ['datara', rawId]
    };
  }

  function update() {
    var manifest = buildManifest();

    var previewEl = document.getElementById('manifest-preview');
    if (previewEl) previewEl.textContent = JSON.stringify(manifest, null, 2);

    updateStatus(manifest);
    return manifest;
  }

  function updateStatus(manifest) {
    var statusEl = document.getElementById('schema-status');
    if (!statusEl) return;

    var missing = [];
    if (manifest.sha256 === PLACEHOLDER_SHA) missing.push('archive SHA-256');
    if (!/^[a-f0-9]{64}$/i.test(manifest.public_key)) missing.push('author public key');
    if (!/^[a-f0-9]{128}$/i.test(manifest.signature)) missing.push('archive signature');

    if (missing.length === 0) {
      statusEl.textContent = 'Schema 1 ready';
      statusEl.className = 'preview-status ok';
    } else {
      statusEl.textContent = 'Placeholders: ' + missing.join(', ');
      statusEl.className = 'preview-status warn';
    }
  }

  function copyManifestJson() {
    var previewEl = document.getElementById('manifest-preview');
    if (previewEl) util.copyText(previewEl.textContent, 'Manifest JSON copied');
  }

  function init() {
    update();
  }

  Sparks.generator = {
    init: init,
    update: update,
    onTarUpload: onTarUpload,
    buildManifest: buildManifest,
    copyManifestJson: copyManifestJson
  };
})(window.Sparks);
