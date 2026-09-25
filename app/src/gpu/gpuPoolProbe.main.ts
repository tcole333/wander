// Entry of e2e/gpu-pool.html. It runs the pool probe once, exposes the report to the spec and
// prints it, so the page also works opened by hand on the dev server. With ?report=<browser> it
// also posts the report for the lab specs (e2e/lab/gpu-pool.lab.ts).
import { postLabReport, reportFailures, reportingBrowser } from '../lab/labReport';
import { runGpuPoolProbe } from './gpuPoolProbe';

const output = document.getElementById('report');
if (!output) throw new Error('missing #report element');

const browser = reportingBrowser();
if (browser) reportFailures('gpu-pool', browser);

window.gpuPoolProbe = Promise.resolve().then(async () => {
  const report = runGpuPoolProbe();
  output.textContent = JSON.stringify(report, null, 2);
  if (browser) await postLabReport('gpu-pool', browser, report);
  return report;
});
