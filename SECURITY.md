# Security Policy

## Supported versions

| Version   | Supported |
| --------- | --------- |
| `0.4.x`   | Current   |
| `< 0.4.0` | No        |

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

| Control                               | Where                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **SHA-512 integrity**                 | Tarball hashed on download and compared against `dist.integrity` from registry metadata. Mismatches abort and clean up the partial extraction.                                                                                                                                                                         |
| **Registry host pinning**             | `dist.tarball` must resolve to the same hostname as the configured registry. A compromised metadata response cannot redirect downloads to an attacker-controlled host.                                                                                                                                                 |
| **Size cap**                          | Downloads are aborted when they exceed 50 MiB (streamed to temp file; partial temp file is removed by the installer on abort).                                                                                                                                                                                         |
| **Path traversal protection**         | Pack names/versions that would resolve outside `.bluetemberg/packs/` are rejected before any extraction.                                                                                                                                                                                                               |
| **Symlink rejection**                 | The tarball extractor rejects symlinks unconditionally.                                                                                                                                                                                                                                                                |
| **Integrity cache marker**            | `.bluetemberg-integrity` written per cached version; re-validated on cache hits.                                                                                                                                                                                                                                       |
| **Guardrail shell-injection guard**   | Guardrail `check.field` and `check.regex` values are validated to a safe character set and passed as positional arguments to a fixed script, never interpolated onto a command line.                                                                                                                                   |
| **Mandatory signatures on npmjs.org** | The ECDSA signature check cannot be disabled for `registry.npmjs.org`. `--skip-signature-verification` applies only to non-default registries, never relaxes integrity checking, and every install that skips the check announces it with a warning line.                                                              |
| **Host-scoped credentials**           | An `.npmrc` credential is bound to the host+path it is declared for and sent only there. A tarball on a different host (`--allow-external-tarball-host`), a different port, or plain `http:` is fetched unauthenticated, and `GITHUB_TOKEN` used for external sources is never sent to a registry.                     |
| **Untrusted registry URL**            | `llm/packages.json` is a committed file, so a bare `NPM_TOKEN`/`NODE_AUTH_TOKEN` — which names no host — is applied only to `registry.npmjs.org` or to `$NPM_CONFIG_REGISTRY`. Cloning a repository and running `install` cannot redirect the token to a host that repository chose.                                   |
| **Credentials over https only**       | A plain-`http:` registry receives no credential (loopback excepted, where the request never leaves the machine). The rule is re-checked against the tarball URL itself, so registry metadata cannot downgrade the transport. Override for an internal http registry with `BLUETEMBERG_ALLOW_INSECURE_REGISTRY_AUTH=1`. |
| **No credentials at rest**            | Tokens are read from `.npmrc` and the environment only. They are never written to the manifest, the lockfile, or log output, and inline `user:pass@host` userinfo is stripped from URLs before they appear in errors or lock entries.                                                                                  |
| **No unsigned-signature forgery**     | A pack installed with signature verification skipped records `version` and `integrity` but no `keyid`, so a later `bluetemberg verify` still reports it as unsigned.                                                                                                                                                   |

### Credential handling

Private pack distribution requires transmitting credentials, so the boundaries are explicit:

- Credentials resolve from `<project>/.npmrc`, then `~/.npmrc` (or `$NPM_CONFIG_USERCONFIG`), then
  `NPM_TOKEN` / `NODE_AUTH_TOKEN`. `.npmrc` entries are host-and-path scoped, most specific first;
  the env fallback is not host-scoped and is therefore limited to a registry the _user_ named
  (see **Untrusted registry URL** above).
- A credential that is configured but withheld reports why, and how to configure one that would
  be sent — silently behaving as if none existed turns a security decision into a mystery 401.
- A `${VAR}` reference that resolves to nothing yields **no** credential rather than a literal
  placeholder, so a misconfigured CI cannot send `${NPM_TOKEN}` as a bearer token.
- An unparseable registry URL yields no credential: without an identifiable host there is no way
  to know who would receive it.
- Downloads may be redirected to a signed CDN URL. The platform `fetch` drops `Authorization` on a
  cross-origin redirect; a test asserts this against real HTTP servers so replacing the HTTP client
  cannot regress it silently.

### Known limitation

Registry metadata is fetched over HTTPS but is not signed at the application layer (no Subresource Integrity on the metadata fetch itself). This is mitigated by using the official npm registry (`registry.npmjs.org`) by default, and by the host-pinning check which prevents redirects even if metadata is compromised. The publish workflow is configured to emit OIDC provenance attestations (`npm publish --provenance`); these attest the source commit and CI build for each published version and become verifiable via `npm audit signatures` once a release reaches the registry. Provenance does not sign install-time registry metadata — the application-layer integrity risk for metadata fetches remains, and verifying the npm signing key against `dist.integrity` at install time is tracked as future hardening.
