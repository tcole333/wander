// The headers every R2 object carries (streaming.md 4.2): immutable, with an explicit Content-Type,
// so neither the edge nor a dev server guesses one or adds an encoding. publish-data sets them at
// upload and the local data server serves them; the zone adds CORS and Timing-Allow-Origin.
import { extname } from 'node:path';

/** The Content-Type each object gets, by extension; no other extension is published or served. */
export const CONTENT_TYPES: Readonly<Record<string, string>> = {
  '.wst': 'application/octet-stream',
  '.wot': 'application/octet-stream',
  '.wev': 'application/octet-stream',
  '.wsn': 'application/octet-stream',
  '.bin': 'application/octet-stream',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.avif': 'image/avif',
  '.jpg': 'image/jpeg',
  '.m4a': 'audio/mp4',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

export const IMMUTABLE = 'public, max-age=31536000, immutable';

export interface ObjectHeaders {
  'Cache-Control': string;
  'Content-Type': string;
}

/** A key's or file's object headers, or undefined when R2 never holds its extension. */
export function objectHeaders(key: string): ObjectHeaders | undefined {
  const type = CONTENT_TYPES[extname(key)];
  return type === undefined ? undefined : { 'Cache-Control': IMMUTABLE, 'Content-Type': type };
}
