// The local data server (streaming.md 7.3): serves a profile's build in the R2 key layout with
// the production headers (4.2), from an origin of its own, so a page fetches local data exactly as
// it fetches wander-data.traviscole.xyz: cross-origin under CORS, immutable, the stored bytes with
// no Content-Encoding. /release.json is the release for that build (release.ts); it is not an R2
// key. Plain Node, so it runs outside Vite:
//
//   npm run data -- --profile fixture|region [--port N]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { localRelease } from './release.ts';

/** Each profile's port, so the fixture and region servers can run side by side. */
export const DATA_PORTS = { fixture: 8791, region: 8792 } as const;
export type Profile = keyof typeof DATA_PORTS;

const REBUILD: Record<Profile, string> = {
  fixture: 'run `npm run fixture` in app/',
  region: 'run `uv run prebuild --profile region` in pipeline/',
};

/** The Content-Type each object gets at upload (4.2); nothing else is served. */
const CONTENT_TYPES: Record<string, string> = {
  '.wst': 'application/octet-stream',
  '.wot': 'application/octet-stream',
  '.wev': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.json': 'application/json',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

// The zone's Transform Rule and the objects' own headers (4.2).
const DATA_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Timing-Allow-Origin': '*',
  'Cache-Control': 'public, max-age=31536000, immutable',
};

export interface DataServerOptions {
  profile: Profile;
  port?: number;
  host?: string;
  /** The repo root, whose build/ holds the profile's output. */
  repo?: string;
}

export interface DataServer {
  /** The server's origin, which the release names as its dataHost. */
  url: string;
  close(): Promise<void>;
}

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

export class DataServerError extends Error {
  override name = 'DataServerError';
}

/** Starts serving `build/<profile>/`; throws, naming the command, when that build is missing. */
export async function startDataServer(options: DataServerOptions): Promise<DataServer> {
  const { profile, host = '127.0.0.1', repo = REPO_ROOT } = options;
  const root = resolve(repo, 'build', profile);
  const stages = resolve(repo, 'build', 'stages', profile);
  for (const required of [root, join(stages, 'coverage.json'), join(stages, 'surface.json')]) {
    if (!existsSync(required)) {
      throw new DataServerError(`${required} is missing: ${REBUILD[profile]}`);
    }
  }

  let origin = '';
  const server = createServer((req, res) => {
    try {
      serve(req, res, root, () => JSON.stringify(localRelease(stages, origin)));
    } catch (error) {
      send(res, 500, String(error));
    }
  });
  await new Promise<void>((done, fail) => {
    server.once('error', fail);
    server.listen(options.port ?? DATA_PORTS[profile], host, done);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new DataServerError('no TCP address');
  origin = `http://${host}:${address.port}`;
  return {
    url: origin,
    close: () =>
      new Promise((done, fail) => server.close((error) => (error ? fail(error) : done()))),
  };
}

function serve(req: IncomingMessage, res: ServerResponse, root: string, release: () => string) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    return send(res, 405, 'GET or HEAD');
  }
  let path: string;
  try {
    path = decodeURIComponent(new URL(req.url ?? '/', 'http://data').pathname);
  } catch {
    return send(res, 400, 'bad path');
  }
  if (path === '/release.json') {
    const body = release();
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Timing-Allow-Origin': '*',
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }

  // Only files under the root, with an extension R2 serves, and never a path that climbs out.
  const file = resolve(root, `.${path}`);
  const type = CONTENT_TYPES[extname(file)];
  const stat = file.startsWith(root + sep) && type ? statOrNull(file) : null;
  if (!type || !stat?.isFile()) return send(res, 404, 'not found');
  res.writeHead(200, { ...DATA_HEADERS, 'Content-Type': type, 'Content-Length': stat.size });
  if (req.method === 'HEAD') return res.end();
  createReadStream(file)
    .on('error', () => res.destroy())
    .pipe(res);
}

function send(res: ServerResponse, status: number, message: string): void {
  res.writeHead(status, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'text/plain' });
  res.end(message);
}

function statOrNull(file: string) {
  try {
    return statSync(file);
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: { profile: { type: 'string' }, port: { type: 'string' }, host: { type: 'string' } },
  });
  const profile = values.profile;
  if (profile !== 'fixture' && profile !== 'region') {
    throw new DataServerError('--profile must be fixture or region');
  }
  const port = values.port === undefined ? undefined : Number(values.port);
  const server = await startDataServer({ profile, port, host: values.host });
  console.log(`serving build/${profile}/ at ${server.url} (release: ${server.url}/release.json)`);
}
