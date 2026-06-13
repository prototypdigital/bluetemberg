# Security Policy

## Supported versions

| Version   | Supported |
| --------- | --------- |
| `0.3.x`   | Current   |
| `< 0.3.0` | No        |

## Reporting a vulnerability

**Please do not open a public issue for security vulnerabilities.**

Report vulnerabilities privately via GitHub Security Advisories:

[Report a vulnerability](https://github.com/prototypdigital/bluetemberg/security/advisories/new)

We aim to respond within 48 hours and to publish a patch within 30 days for confirmed vulnerabilities.

## Threat model

bluetemberg generates AI tool configuration and writes auto-executing hooks into user projects (`.claude/settings.json`, `.cursor/rules/`, `.github/instructions/`). The primary attack surface is:

- **Pack supply chain** — malicious content in third-party packs installed via `bluetemberg install`
- **Guardrail hooks** — commands written into `.claude/settings.json` that execute automatically when Claude Code calls a tool
- **Path traversal** — pack names/versions used as filesystem paths during extraction

## Implemented supply-chain controls

When `bluetemberg install` downloads a pack from the npm registry:

| Control                             | Where                                                                                                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **SHA-512 integrity**               | Tarball hashed on download and compared against `dist.integrity` from registry metadata. Mismatches abort and clean up the partial extraction.                                       |
| **Registry host pinning**           | `dist.tarball` must resolve to the same hostname as the configured registry. A compromised metadata response cannot redirect downloads to an attacker-controlled host.               |
| **Size cap**                        | Downloads are aborted when they exceed 50 MiB (streamed to temp file; partial temp file is removed by the installer on abort).                                                       |
| **Path traversal protection**       | Pack names/versions that would resolve outside `.bluetemberg/packs/` are rejected before any extraction.                                                                             |
| **Symlink rejection**               | The tarball extractor rejects symlinks unconditionally.                                                                                                                              |
| **Integrity cache marker**          | `.bluetemberg-integrity` written per cached version; re-validated on cache hits.                                                                                                     |
| **Guardrail shell-injection guard** | Guardrail `check.field` and `check.regex` values are validated to a safe character set and passed as positional arguments to a fixed script, never interpolated onto a command line. |

### Known limitation

Registry metadata is fetched over HTTPS but is not signed at the application layer (no Subresource Integrity on the metadata fetch itself). This is mitigated by using the official npm registry (`registry.npmjs.org`) by default, and by the host-pinning check which prevents redirects even if metadata is compromised. OIDC provenance attestation (`npm publish --provenance`), planned for 0.4.0, will provide attestations for published package versions to improve provenance verification, but does not sign install-time registry metadata — the application-layer integrity risk for metadata fetches remains.
