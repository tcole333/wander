// The local data server (streaming.md 7.3): serves a profile's build in the R2 key layout with
// the production headers (4.2), from an origin of its own, so a page fetches local data exactly as
// it fetches wander-data.traviscole.xyz: cross-origin under CORS, immutable, the stored bytes with
// no Content-Encoding. /release.json is the release for that build (release.ts); it is not an R2
// key. Plain Node, so it runs outside Vite:
//
//   npm run data -- --profile fixture|region|global [--port N]
import { createReadStream, statSync } from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { objectHeaders } from './objectHeaders.ts';
import { localRelease, OUTPUT_DIR, profileBuild, type Profile } from './release.ts';

/** Each profile's port, so the fixture and region servers can run side by side. */
export const DATA_PORTS: Record<Profile, number> = { fixture: 8791, region: 8792, global: 8793 };

// The zone's Transform Rule (4.2); each object's own headers come from objectHeaders.ts.
const ZONE_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Timing-Allow-Origin': '*' };

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

export class DataServerError extends Error {
  override name = 'DataServerError';
}

/** Starts serving `build/<profile>/`; throws, naming the command, when that build is missing. */
export async function startDataServer(options: DataServerOptions): Promise<DataServer> {
  const { profile, host = '127.0.0.1', repo } = options;
  const { root, stages } = profileBuild(profile, repo);

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
      ...ZONE_HEADERS,
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    return res.end(req.method === 'HEAD' ? undefined : body);
  }

  // Only files under the root, with an extension R2 serves, and never a path that climbs out.
  const file = resolve(root, `.${path}`);
  const headers = objectHeaders(file);
  const stat = file.startsWith(root + sep) && headers ? statOrNull(file) : null;
  if (!headers || !stat?.isFile()) return send(res, 404, 'not found');
  res.writeHead(200, { ...ZONE_HEADERS, ...headers, 'Content-Length': stat.size });
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
  if (profile === undefined || !(profile in DATA_PORTS)) {
    throw new DataServerError('--profile must be fixture, region or global');
  }
  const port = values.port === undefined ? undefined : Number(values.port);
  const server = await startDataServer({ profile: profile as Profile, port, host: values.host });
  console.log(
    `serving build/${OUTPUT_DIR[profile as Profile]}/ at ${server.url} (release: ${server.url}/release.json)`,
  );
}
