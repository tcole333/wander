// Entry of e2e/lab/uniform-branches.html: runs the probe once, prints the report and exposes it to
// Playwright; with ?report=<browser> it also posts it (e2e/lab/uniform-branches.lab.ts).
import { postLabReport, reportFailures, reportingBrowser } from './labReport';
import { runUniformBranches } from './uniformBranches';

const output = document.getElementById('report');
if (!output) throw new Error('missing #report element');

const browser = reportingBrowser();
if (browser) reportFailures('uniform-branches', browser);

window.uniformBranches = runUniformBranches().then(async (report) => {
  output.textContent = JSON.stringify(report, null, 2);
  if (browser) await postLabReport('uniform-branches', browser, report);
  return report;
});
