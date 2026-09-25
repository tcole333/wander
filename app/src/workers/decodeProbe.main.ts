// Entry of e2e/decode.html: decodes the tiles of the release at ?data=<origin>, optionally only
// ?levels=<from>-<to>, prints a summary and exposes the report to Playwright; with
// ?report=<browser> it also posts it (e2e/lab/decode.lab.ts).
import { labTarget, postLabReport, reportFailures } from '../lab/labReport';
import { runDecodeProbe } from './decodeProbe';

const output = document.getElementById('report');
if (!output) throw new Error('missing #report element');

const params = new URLSearchParams(location.search);
const dataHost = params.get('data');
if (!dataHost) throw new Error('name the data server with ?data=<origin>');
const [from = 0, to = Infinity] = (params.get('levels') ?? '')
  .split('-')
  .filter(Boolean)
  .map(Number);

const target = labTarget('decode');
if (target) reportFailures(target);

window.decodeProbe = runDecodeProbe(dataHost, [from, to]).then(async (report) => {
  const { tiles, errors, wallMs } = report;
  output.textContent = `${tiles.length} decoded, ${errors.length} failed, ${Math.round(wallMs)} ms`;
  if (target) await postLabReport(target, report);
  return report;
});
