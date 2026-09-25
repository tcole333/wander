// Entry of e2e/lab/uniform-branches.html: runs the probe once, prints the report and exposes it to
// Playwright; with ?report=<browser> it also posts it (e2e/lab/uniform-branches.lab.ts).
import { labTarget, postLabReport, reportFailures } from './labReport';
import { runUniformBranches } from './uniformBranches';

const output = document.getElementById('report');
if (!output) throw new Error('missing #report element');

const target = labTarget('uniform-branches');
if (target) reportFailures(target);

window.uniformBranches = runUniformBranches().then(async (report) => {
  output.textContent = JSON.stringify(report, null, 2);
  if (target) await postLabReport(target, report);
  return report;
});
