# Sparks Registry Storage Layout — Conformance Review

How Sparks stores packages, measured against how npm, crates.io, PyPI, the Go module
proxy, and Maven Central do it. Every claim about a third-party registry below was
verified by making a real HTTP request, not recalled from documentation.

---

## 1. The layout on disk

```
sparks/
├── index.json                        catalog: one entry per package, all versions listed
├── schema.json                       JSON-Schema for a package manifest (Schema 1)
├── packages/
│   ├── <id>.json                     root snapshot == the latest release's manifest
│   └── <id>/
│       ├── <version>.json            exact-release manifest (one per published version)
│       └── README.md                 human-only, never read by the client
└── tarballs/
    └── <id>-<version>.tar            POSIX ustar: source + capabilities.json + README.md
```

`<id>` is the canonical name with the mandatory `sparks/` prefix removed, so
`sparks/crypto_core` lives at `packages/crypto_core.json`.

## 2. The two paths the client actually walks

This is the part that matters, because it is the only thing `dpm` reads. Verified in
`datara + forgen/src/project/pm/registry.rs::fetch_and_install_sparks`:

| Request | Document fetched |
| --- | --- |
| `dpm add sparks/foo` | `packages/foo.json` |
| `dpm add sparks/foo@1.2.3` | `packages/foo/1.2.3.json` |

Then `tarball_url` is resolved against the registry root, the tarball is fetched, and
the manifest's `sha256` and ed25519 `signature` are verified before extraction.

`index.json` is **not** on this path. It exists purely to drive the web catalog. That is
the same split crates.io uses (its sparse index is separate from its API), and it means
the registry has no single hot document that every install must fetch.

## 3. Side-by-side against the five majors

| Registry | Version-list document | Single-version document | Artifact URL | Integrity |
| --- | --- | --- | --- | --- |
| **npm** | `registry.npmjs.org/<pkg>` → `versions` (**object**) + `dist-tags.latest` | `/<pkg>/<version>` | `/<pkg>/-/<pkg>-<version>.tgz` | `dist.integrity` (SRI), `dist.shasum` |
| **crates.io** | `index.crates.io/<shard>/<name>` → **NDJSON**, one line per version (`vers`) | `crates.io/api/v1/crates/<name>/<ver>` | `static.crates.io/crates/<name>/<name>-<ver>.crate` | `cksum` (SHA-256) |
| **PyPI** | `pypi.org/pypi/<name>/json` → `releases` (**object** keyed by version) | `pypi.org/pypi/<name>/<ver>/json` | `files.pythonhosted.org/packages/<hash-path>/<file>` | `digests.sha256` |
| **Go modules** | `proxy.golang.org/<mod>/@v/list` (plain text) + `@latest` | `@v/<ver>.info`, `@v/<ver>.mod` | `@v/<ver>.zip` | `sum.golang.org` transparency log |
| **Maven Central** | `maven-metadata.xml` → `<versions><version>` | `.../<ver>/<artifact>-<ver>.pom` | `.../<ver>/<artifact>-<ver>.jar` | `.sha1` / `.md5` sidecars |
| **Sparks** | `index.json` → `versions` (**array**); `schema.json` documents `all_versions` | `packages/<id>/<ver>.json` | `tarballs/<id>-<ver>.tar` | `sha256` **+ ed25519** in the manifest |

## 4. Where Sparks matches the field

- **Two-path resolution (latest + pinned).** npm's `/<pkg>` vs `/<pkg>/<version>` is the
  same shape as Sparks' `packages/<id>.json` vs `packages/<id>/<version>.json`. Sparks
  additionally makes the root document *be* the latest release's manifest rather than a
  separate aggregate, which removes a class of "index says X, artifact says Y" bugs for
  the latest version.
- **Sparse, service-free, CDN-served.** crates.io's sparse index is the closest analogue:
  plain immutable files, no registry daemon, mirrors trivially. Sparks matches this
  philosophy and adds offline `file://` operation.
- **Artifact naming `<name>-<version>.<ext>`.** Identical convention to crates
  (`<name>-<ver>.crate`), npm (`<name>-<ver>.tgz`), and PyPI wheels. Sparks matches.
- **Immutable published versions.** POLICY.md section 2 matches the norm; npm, crates.io,
  and Maven all refuse to overwrite a published version.
- **A mandatory sidecar of machine-readable metadata inside the artifact.** Go ships
  `.mod` next to `.zip`; Maven ships `.pom` next to `.jar`; Sparks ships
  `capabilities.json` inside the `.tar`. Same idea, stronger placement (inside the signed
  bytes, so it cannot be swapped independently).

## 5. Where Sparks deviates

### 5.1 Two names for one concept — real, cosmetic

`schema.json` documents the version list as `all_versions`. `index.json` uses `versions`.
Every one of the five majors has exactly **one** canonical name for this field. The client
never reads either (its `SparksPackageManifest` has no version-list field at all), and
`schema.json` leaves `additionalProperties` unset, so neither spelling is rejected today —
but two names for one field is how drift starts. `validate_registry.py` now asserts the two
agree wherever both appear.

### 5.2 No length-sharding on the name → path mapping

crates.io shards by name length (`1/a`, `2/ab`, `3/a/abc`, `ab/cd/abcd`) so no single
directory grows without bound. npm and Sparks use the name verbatim. At 5 packages this is
correct; past roughly 10k packages, a flat `packages/` directory becomes a filesystem and
Git performance problem. Not a defect now — a documented scaling ceiling.

### 5.3 No transparency log

npm has opt-in provenance, and Go has `sum.golang.org` as a public append-only log that
anyone can audit. Sparks has neither: it has the **strongest per-artifact authenticity of
the six** (a real ed25519 signature over the tarball bytes, verified client-side — npm,
crates.io, PyPI, and Maven all rely on TLS plus, at most, an optional overlay), but the
**weakest global auditability**. A compromised signing key can produce a valid signature
with no public record contradicting it. `index.json`'s `key_rotation` list is the current
mitigation; a Sigstore-style log would be the structural fix. This is a design tradeoff,
not a bug.

## 6. Verification commands

```bash
python scripts/validate_registry.py          # 7 registry invariants + index/manifest parity
python tests/test_registry_layout.py         # client-path conformance, 222 assertions
python tests/test_ci_validation_fixtures.py  # 11 negative fixtures, all must be caught
```

## 7. What is enforced now

`validate_registry.py` gained four checks. All four are proven live by negative fixtures
7–11 in `tests/test_ci_validation_fixtures.py`:

1. **A tarball must carry `capabilities.json`.** Missing sidecar is an error unless the
   exact `(name, version)` pair is on the grandfather list. Closes the one-sided check
   that only fired when the manifest declared capabilities. The grandfather list is
   currently **empty** — it exists as a safety valve for already-published, immutable
   artifacts, and no package is on it.
2. **`packages/<id>.json` and `packages/<id>/<latest>.json` must describe one artifact.**
   Byte-for-byte drift on any client-relevant field is an error; a field present in only
   one of the two is a warning.
3. **`index.json` must not contradict the manifest.** The catalog renders `index.json`,
   and nothing previously stopped it from displaying a digest the artifact does not have.
4. **The advertised version list must match the manifests on disk.** A version the catalog
   advertises but that has no manifest is not installable; a manifest with no index entry
   is undiscoverable.
