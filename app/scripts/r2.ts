// The R2 bucket over its S3 API, for publish-data (streaming.md 4.3): paginated listing, HEAD, and
// PUTs that never overwrite (If-None-Match: *, which R2 answers with 412 when the key exists),
// signed with aws4fetch and retried with backoff on network errors, 429 and 5xx. The credentials
// come from ~/.config/wander/r2.env, outside the repo (WANDER_R2_ENV names another file); their
// values never reach a message or a log, and the ~/.aws profiles are never read.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { AwsClient } from 'aws4fetch';
import type { ObjectHeaders } from './objectHeaders.ts';

export const BUCKET = 'wander-data';

const ATTEMPTS = 6;
const BACKOFF_MS = 500;
const CREDENTIALS = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_ENDPOINT'] as const;

export class R2Error extends Error {
  override name = 'R2Error';
}

export interface R2Credentials {
  accessKeyId: string;
  secretAccessKey: string;
  /** `https://<account>.r2.cloudflarestorage.com`. */
  endpoint: string;
}

export function r2EnvPath(): string {
  return process.env.WANDER_R2_ENV ?? join(homedir(), '.config', 'wander', 'r2.env');
}

/** The S3 credentials from a KEY=value file; a failure names the file and keys, never a value. */
export function readR2Env(path: string = r2EnvPath()): R2Credentials {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    throw new R2Error(`cannot read the R2 credentials file ${path}`);
  }
  const values = new Map<string, string>();
  for (const line of text.split('\n')) {
    const match = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (match) values.set(match[1]!, match[2]!.replace(/^(['"])(.*)\1$/, '$2'));
  }
  const missing = CREDENTIALS.filter((name) => !values.get(name));
  if (missing.length > 0) throw new R2Error(`${path} has no ${missing.join(', ')}`);
  const value = (name: (typeof CREDENTIALS)[number]) => values.get(name)!;
  return {
    accessKeyId: value('R2_ACCESS_KEY_ID'),
    secretAccessKey: value('R2_SECRET_ACCESS_KEY'),
    endpoint: value('R2_ENDPOINT'),
  };
}

export class R2Bucket {
  private readonly client: AwsClient;
  private readonly base: string;

  constructor(credentials: R2Credentials, bucket: string = BUCKET) {
    const { accessKeyId, secretAccessKey, endpoint } = credentials;
    this.client = new AwsClient({
      accessKeyId,
      secretAccessKey,
      service: 's3',
      region: 'auto',
      retries: 0,
    });
    this.base = `${endpoint.replace(/\/+$/, '')}/${bucket}`;
  }

  /** Every key under `prefix` with its size, across ListObjectsV2's pages. */
  async list(prefix: string): Promise<Map<string, number>> {
    const sizes = new Map<string, number>();
    const what = `list ${prefix}`;
    let token: string | undefined;
    do {
      const query = new URLSearchParams({ 'list-type': '2', prefix, 'max-keys': '1000' });
      if (token !== undefined) query.set('continuation-token', token);
      const response = await this.send(`${this.base}?${query}`, { method: 'GET' }, what);
      const xml = await (await ok(response, what)).text();
      for (const [, contents] of xml.matchAll(/<Contents>(.*?)<\/Contents>/gs)) {
        const key = tag(contents!, 'Key');
        const size = tag(contents!, 'Size');
        if (key === undefined || size === undefined) throw new R2Error(`${what}: bad XML`);
        sizes.set(key, Number(size));
      }
      token = tag(xml, 'IsTruncated') === 'true' ? tag(xml, 'NextContinuationToken') : undefined;
    } while (token !== undefined);
    return sizes;
  }

  /** The object's headers, or undefined when the bucket has no such key. */
  async head(key: string): Promise<Headers | undefined> {
    const response = await this.send(this.url(key), { method: 'HEAD' }, `HEAD ${key}`);
    if (response.status === 404) return undefined;
    return (await ok(response, `HEAD ${key}`)).headers;
  }

  /** Writes the object unless the key exists: 'present' when R2 already holds it. */
  async put(
    key: string,
    body: Uint8Array<ArrayBuffer>,
    headers: ObjectHeaders,
  ): Promise<'created' | 'present'> {
    const init = { method: 'PUT', headers: { ...headers, 'If-None-Match': '*' }, body };
    const response = await this.send(this.url(key), init, `PUT ${key}`);
    if (response.status === 412) {
      await response.body?.cancel();
      return 'present';
    }
    await (await ok(response, `PUT ${key}`)).body?.cancel();
    return 'created';
  }

  private url(key: string): string {
    return `${this.base}/${key.split('/').map(encodeURIComponent).join('/')}`;
  }

  /**
   * A signed request, signed again and retried with backoff on network errors, 429 and 5xx. A
   * network error that outlasts the retries is thrown as its code alone, since fetch's own error
   * names the endpoint's host.
   */
  private async send(url: string, init: RequestInit, what: string): Promise<Response> {
    for (let attempt = 1; ; attempt += 1) {
      try {
        const response = await this.client.fetch(url, init);
        if ((response.status < 500 && response.status !== 429) || attempt === ATTEMPTS) {
          return response;
        }
        await response.body?.cancel();
      } catch (error) {
        if (attempt === ATTEMPTS) throw new R2Error(`${what}: network error ${networkCode(error)}`);
      }
      const wait = BACKOFF_MS * 2 ** (attempt - 1) * (0.5 + Math.random());
      await new Promise((done) => setTimeout(done, wait));
    }
  }
}

/**
 * The response when it succeeded; otherwise an error with its status and S3 error code alone, since
 * an error body can echo the access key id.
 */
async function ok(response: Response, what: string): Promise<Response> {
  if (response.ok) return response;
  const code = tag(await response.text(), 'Code');
  throw new R2Error(`${what}: HTTP ${response.status}${code === undefined ? '' : ` ${code}`}`);
}

/** A failed fetch's error code (ENOTFOUND, ECONNRESET…), which never names the host. */
function networkCode(error: unknown): string {
  const code = (error as { cause?: { code?: unknown } } | undefined)?.cause?.code;
  return typeof code === 'string' ? code : 'without a code';
}

/** The text of the first `<name>` element, unescaped. */
function tag(xml: string, name: string): string | undefined {
  const text = new RegExp(`<${name}>(.*?)</${name}>`, 's').exec(xml)?.[1];
  return text
    ?.replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');
}
