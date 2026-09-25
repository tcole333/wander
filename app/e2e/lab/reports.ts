// The dev server's end of lab reports (src/lab/labReport.ts): a page posts JSON to
// /__lab/report/<what>-<browser>, and this writes it to build/lab/<what>-<browser>.json, where the
// lab specs read it. Dev server only; the production build has no such route.
import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Connect, Plugin } from 'vite';
import { LAB_REPORT_NAME, LAB_REPORT_PATH } from '../../src/lab/labReport.ts';

/** build/lab/ at the repo root, git-ignored with the rest of build/. */
export const LAB_DIR = fileURLToPath(new URL('../../../build/lab/', import.meta.url));

/** Larger than any report a lab page writes, including per-frame timings. */
const MAX_BYTES = 64 * 1024 * 1024;

export function labReportPath(name: string): string {
  return join(LAB_DIR, `${name}.json`);
}

export function labReports(): Plugin {
  return {
    name: 'wander-lab-reports',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(LAB_REPORT_PATH, receive);
    },
  };
}

// Mounted at LAB_REPORT_PATH, so req.url is `/<name>`.
const receive: Connect.NextHandleFunction = (req, res) => {
  const name = (req.url ?? '').slice(1).split('?')[0] ?? '';
  const reply = (status: number, message = '') => {
    res.statusCode = status;
    res.end(message);
  };
  if (req.method !== 'POST') return reply(405, 'POST a JSON report');
  if (!LAB_REPORT_NAME.test(name)) return reply(400, `bad report name ${name}`);

  const chunks: Buffer[] = [];
  let bytes = 0;
  req.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
    if (bytes > MAX_BYTES) {
      reply(413, 'report too large');
      req.destroy();
      return;
    }
    chunks.push(chunk);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    const text = Buffer.concat(chunks).toString('utf8');
    try {
      JSON.parse(text);
    } catch {
      return reply(400, 'report is not JSON');
    }
    // Written whole, then renamed, so a spec polling for the file never reads half of it.
    mkdirSync(LAB_DIR, { recursive: true });
    const partial = labReportPath(`${name}.partial`);
    writeFileSync(partial, text);
    renameSync(partial, labReportPath(name));
    reply(204);
  });
};
