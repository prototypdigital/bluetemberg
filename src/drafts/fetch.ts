import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { get, type RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import type { Readable } from 'node:stream';

import { urlIssue } from './check.js';

/**
 * A fetcher for the one network read the create-loop does: loading a cited documentation page to
 * confirm its quote. The URL comes from a draft — model output — so it is treated as hostile:
 *
 * - https only, a public host name, no credentials — checked on the first URL and on every
 *   redirect hop (at most {@link MAX_REDIRECTS});
 * - the host must resolve only to public addresses. The check runs inside the socket's own DNS
 *   lookup, so the address that was checked is the address connected to: a name cannot pass the
 *   check and then rebind to `127.0.0.1` or a cloud metadata endpoint;
 * - no cookies, no credentials, no proxy; bounded time and size.
 *
 * The page is returned as text for a substring match and nothing else — it is never logged,
 * stored, or handed to a model.
 */

export const MAX_REDIRECTS = 5;
export const MAX_PAGE_BYTES = 5 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 15_000;

export interface FetchedPage {
  /** The URL that served the page, after redirects. */
  finalUrl: string;
  text: string;
}

export type PageFetcher = (url: string) => Promise<FetchedPage>;

const NON_PUBLIC = new BlockList();
for (const [net, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  NON_PUBLIC.addSubnet(net, prefix, 'ipv4');
}
for (const [net, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['100::', 64],
  ['2001:db8::', 32],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  NON_PUBLIC.addSubnet(net, prefix, 'ipv6');
}

/** True for loopback, private, link-local, CGNAT, documentation, multicast and reserved addresses. */
export function isNonPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return NON_PUBLIC.check(address, 'ipv4');
  if (family !== 6) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped) return NON_PUBLIC.check(mapped[1], 'ipv4');
  return NON_PUBLIC.check(address, 'ipv6');
}

/** A DNS lookup that fails unless every resolved address is public. Exported for tests. */
export const publicOnlyLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (err, addresses: LookupAddress[]) => {
    if (err) return callback(err, '', 0);
    if (addresses.length === 0 || addresses.some((a) => isNonPublicAddress(a.address))) {
      return callback(new Error(`${hostname} resolves to a non-public address`), '', 0);
    }
    if (options.all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
};

const TEXT_TYPE = /^(?:text\/|application\/(?:xhtml\+xml|xml|json)|$)/i;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function decoded(res: IncomingMessage): Readable {
  const encoding = String(res.headers['content-encoding'] ?? '').toLowerCase();
  if (encoding === 'gzip' || encoding === 'x-gzip') return res.pipe(createGunzip());
  if (encoding === 'br') return res.pipe(createBrotliDecompress());
  if (encoding === 'deflate') return res.pipe(createInflate());
  return res;
}

function readCapped(stream: Readable, res: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    stream.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_PAGE_BYTES) {
        res.destroy();
        stream.destroy();
        reject(new Error(`page is larger than ${MAX_PAGE_BYTES / (1024 * 1024)} MiB`));
        return;
      }
      chunks.push(chunk);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    stream.on('error', reject);
  });
}

type Hop = { redirect: string } | { page: FetchedPage };

function requestOnce(url: string): Promise<Hop> {
  const options: RequestOptions = {
    lookup: publicOnlyLookup,
    agent: false,
    timeout: FETCH_TIMEOUT_MS,
    headers: {
      'User-Agent': 'bluetemberg-citation-check',
      Accept: 'text/html,text/plain,text/markdown;q=0.9,*/*;q=0.1',
      'Accept-Encoding': 'gzip, br, deflate',
    },
  };
  return new Promise((resolve, reject) => {
    const req = get(url, options, (res) => {
      const status = res.statusCode ?? 0;
      if (REDIRECT_STATUSES.has(status)) {
        res.resume();
        const location = res.headers.location;
        if (!location) return reject(new Error(`HTTP ${status} without a Location header`));
        return resolve({ redirect: new URL(location, url).toString() });
      }
      if (status < 200 || status >= 300) {
        res.resume();
        return reject(new Error(`HTTP ${status}`));
      }
      const type = String(res.headers['content-type'] ?? '');
      if (!TEXT_TYPE.test(type)) {
        res.resume();
        return reject(new Error(`not a text page (${type.split(';')[0].slice(0, 60)})`));
      }
      readCapped(decoded(res), res)
        .then((text) => resolve({ page: { finalUrl: url, text } }))
        .catch(reject);
    });
    req.on('timeout', () => req.destroy(new Error(`timed out after ${FETCH_TIMEOUT_MS / 1000}s`)));
    req.on('error', reject);
  });
}

/** Fetch a public documentation page as text. Rejects with a short reason on any refusal or failure. */
export const fetchPublicPage: PageFetcher = async (start) => {
  let url = start;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const issue = urlIssue(url);
    if (issue) throw new Error(hop === 0 ? `url ${issue}` : `redirect target ${issue}`);
    const result = await requestOnce(url);
    if ('page' in result) return result.page;
    url = result.redirect;
  }
  throw new Error(`more than ${MAX_REDIRECTS} redirects`);
};
