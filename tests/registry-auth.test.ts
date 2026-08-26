/**
 * Registry credential resolution.
 *
 * Covers the `.npmrc` scope-matching rules, the env fallback, and — most importantly —
 * the cases where *no* credential must be produced, since a false positive there means
 * sending a token somewhere it does not belong.
 */
import { describe, it, expect } from 'vitest';
import { registryAuthHeader, registryAuthHeaders, redactCredentials } from '../src/registry/auth.js';
import { isolateRegistryAuth } from './helpers/registry-auth.js';

const npmrc = isolateRegistryAuth();

describe('registryAuthHeader — .npmrc scopes', () => {
  it('matches a host-scoped _authToken', () => {
    npmrc.writeProjectNpmrc('//npm.pkg.github.com/:_authToken=ghp_secret\n');
    expect(registryAuthHeader('https://npm.pkg.github.com')).toBe('Bearer ghp_secret');
  });

  it('returns undefined for a host with no entry', () => {
    npmrc.writeProjectNpmrc('//npm.pkg.github.com/:_authToken=ghp_secret\n');
    expect(registryAuthHeader('https://registry.npmjs.org')).toBeUndefined();
  });

  it('prefers the most specific path scope', () => {
    npmrc.writeProjectNpmrc(
      [
        '//acme.jfrog.io/:_authToken=host-level',
        '//acme.jfrog.io/api/npm/npm-local/:_authToken=repo-level',
      ].join('\n'),
    );
    expect(registryAuthHeader('https://acme.jfrog.io/api/npm/npm-local')).toBe('Bearer repo-level');
  });

  it('falls back to a less specific path scope', () => {
    npmrc.writeProjectNpmrc('//acme.jfrog.io/:_authToken=host-level\n');
    expect(registryAuthHeader('https://acme.jfrog.io/api/npm/npm-local')).toBe('Bearer host-level');
  });

  it('does not match a different host that shares a path', () => {
    npmrc.writeProjectNpmrc('//acme.jfrog.io/api/npm/:_authToken=acme\n');
    expect(registryAuthHeader('https://evil.example.com/api/npm')).toBeUndefined();
  });

  it('distinguishes hosts on different ports', () => {
    npmrc.writeProjectNpmrc('//localhost:4873/:_authToken=verdaccio\n');
    expect(registryAuthHeader('http://localhost:4873')).toBe('Bearer verdaccio');
    expect(registryAuthHeader('http://localhost:8080')).toBeUndefined();
  });

  it('supports _auth basic credentials', () => {
    const encoded = Buffer.from('user:pass').toString('base64');
    npmrc.writeProjectNpmrc(`//acme.example.com/:_auth=${encoded}\n`);
    expect(registryAuthHeader('https://acme.example.com')).toBe(`Basic ${encoded}`);
  });

  it('supports username + base64 _password', () => {
    const password = Buffer.from('s3cret').toString('base64');
    npmrc.writeProjectNpmrc(
      [`//acme.example.com/:username=alice`, `//acme.example.com/:_password=${password}`].join('\n'),
    );
    const expected = Buffer.from('alice:s3cret').toString('base64');
    expect(registryAuthHeader('https://acme.example.com')).toBe(`Basic ${expected}`);
  });

  it('ignores comments, section headers, and blank lines', () => {
    npmrc.writeProjectNpmrc(
      ['# a comment', '; another comment', '[scope]', '', '//acme.example.com/:_authToken=kept'].join('\n'),
    );
    expect(registryAuthHeader('https://acme.example.com')).toBe('Bearer kept');
  });

  it('strips surrounding quotes from a value', () => {
    npmrc.writeProjectNpmrc('//acme.example.com/:_authToken="quoted-token"\n');
    expect(registryAuthHeader('https://acme.example.com')).toBe('Bearer quoted-token');
  });

  it('lets the project .npmrc override the user .npmrc', () => {
    npmrc.writeUserNpmrc('//acme.example.com/:_authToken=from-user\n');
    npmrc.writeProjectNpmrc('//acme.example.com/:_authToken=from-project\n');
    expect(registryAuthHeader('https://acme.example.com')).toBe('Bearer from-project');
  });

  it('reads the user .npmrc when the project has no entry', () => {
    npmrc.writeUserNpmrc('//acme.example.com/:_authToken=from-user\n');
    npmrc.writeProjectNpmrc('//other.example.com/:_authToken=irrelevant\n');
    expect(registryAuthHeader('https://acme.example.com')).toBe('Bearer from-user');
  });
});

describe('registryAuthHeader — ${VAR} expansion', () => {
  it('expands a set environment variable', () => {
    process.env.TEST_REGISTRY_TOKEN = 'expanded-secret';
    try {
      npmrc.writeProjectNpmrc('//acme.example.com/:_authToken=${TEST_REGISTRY_TOKEN}\n');
      expect(registryAuthHeader('https://acme.example.com')).toBe('Bearer expanded-secret');
    } finally {
      delete process.env.TEST_REGISTRY_TOKEN;
    }
  });

  it('yields no credential when the variable is unset, rather than a literal placeholder', () => {
    npmrc.writeProjectNpmrc('//acme.example.com/:_authToken=${DEFINITELY_UNSET_TOKEN}\n');
    expect(registryAuthHeader('https://acme.example.com')).toBeUndefined();
  });
});

describe('registryAuthHeader — environment fallback', () => {
  it('uses NPM_TOKEN when no .npmrc scope matches', () => {
    process.env.NPM_TOKEN = 'env-token';
    expect(registryAuthHeader('https://acme.example.com')).toBe('Bearer env-token');
  });

  it('uses NODE_AUTH_TOKEN as set by actions/setup-node', () => {
    process.env.NODE_AUTH_TOKEN = 'ci-token';
    expect(registryAuthHeader('https://acme.example.com')).toBe('Bearer ci-token');
  });

  it('prefers a matching .npmrc scope over the environment', () => {
    process.env.NPM_TOKEN = 'env-token';
    npmrc.writeProjectNpmrc('//acme.example.com/:_authToken=npmrc-token\n');
    expect(registryAuthHeader('https://acme.example.com')).toBe('Bearer npmrc-token');
  });

  it('ignores a blank environment token', () => {
    process.env.NPM_TOKEN = '   ';
    expect(registryAuthHeader('https://acme.example.com')).toBeUndefined();
  });
});

describe('registryAuthHeaders', () => {
  it('returns an empty object when no credential applies, so it can be spread', () => {
    expect(registryAuthHeaders('https://registry.npmjs.org')).toEqual({});
  });

  it('returns an Authorization header when a credential applies', () => {
    npmrc.writeProjectNpmrc('//acme.example.com/:_authToken=tok\n');
    expect(registryAuthHeaders('https://acme.example.com')).toEqual({ Authorization: 'Bearer tok' });
  });

  it('returns nothing for an unparseable registry URL, even with an env token set', () => {
    process.env.NPM_TOKEN = 'env-token';
    // Without an identifiable host we cannot tell who would receive the token.
    expect(registryAuthHeaders('not a url')).toEqual({});
  });
});

describe('redactCredentials', () => {
  it('strips inline userinfo', () => {
    expect(redactCredentials('https://alice:s3cret@acme.example.com/pack.tgz')).toBe(
      'https://acme.example.com/pack.tgz',
    );
  });

  it('strips a password-only credential', () => {
    expect(redactCredentials('https://:tok@acme.example.com/')).toBe('https://acme.example.com/');
  });

  it('leaves a credential-free URL untouched', () => {
    expect(redactCredentials('https://registry.npmjs.org/foo')).toBe('https://registry.npmjs.org/foo');
  });

  it('passes through a non-URL unchanged', () => {
    expect(redactCredentials('not a url')).toBe('not a url');
  });
});
