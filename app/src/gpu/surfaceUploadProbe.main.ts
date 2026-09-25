// Entry of e2e/surface-upload.html: uploads the tiles of the release at ?data=<origin>, at
// ?tier=lite|full (lite by default), optionally only ?levels=<from>-<to> and at most ?limit=<n>
// tiles, and exposes the report to Playwright; with ?report=<browser> it also posts it
// (e2e/lab/surface-upload.lab.ts).
import type { Tier } from '../config/tunables';
import { labTarget, postLabReport, reportFailures } from '../lab/labReport';
import { runSurfaceUpload } from './surfaceUploadProbe';

const output = document.getElementById('report');
if (!output) throw new Error('missing #report element');

const params = new URLSearchParams(location.search);
const dataHost = params.get('data');
if (!dataHost) throw new Error('name the data server with ?data=<origin>');
const tier: Tier = params.get('tier') === 'full' ? 'full' : 'lite';
const [from = 0, to = Infinity] = (params.get('levels') ?? '')
  .split('-')
  .filter(Boolean)
  .map(Number);
const limit = Number(params.get('limit') ?? Infinity);

const target = labTarget(`surface-upload-${tier}`);
if (target) reportFailures(target);

window.surfaceUpload = runSurfaceUpload(dataHost, { tier, levels: [from, to], limit }).then(
  async (report) => {
    output.textContent = `${report.uploads.length} uploaded in ${report.frames.length} frames`;
    if (target) await postLabReport(target, report);
    return report;
  },
);
