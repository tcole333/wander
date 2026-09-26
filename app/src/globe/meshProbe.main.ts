// Entry of e2e/globe-mesh.html: reads the surface vertex back over every mesh scenario on the
// fixture at ?data=<origin>, on ?tiers=lite,full (both by default), and exposes the report to
// Playwright.
import type { Tier } from '../config/tunables';
import { runMeshProbe } from './meshProbe';

const output = document.getElementById('report');
if (!output) throw new Error('missing #report element');

const params = new URLSearchParams(location.search);
const dataHost = params.get('data');
if (!dataHost) throw new Error('name the data server with ?data=<origin>');
const tiers = (params.get('tiers') ?? 'lite,full')
  .split(',')
  .filter((tier): tier is Tier => tier === 'lite' || tier === 'full');

window.globeMesh = runMeshProbe(dataHost, tiers).then((report) => {
  const counts = report.tiers.map((t) => `${t.tier}: ${t.scenarios.length} scenarios`);
  output.textContent = `${counts.join(', ')} in ${Math.round(report.ms)} ms`;
  return report;
});
