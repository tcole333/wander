// Entry of e2e/gpu-pool.html. It runs the pool probe once, exposes the report to the spec and
// prints it, so the page also works opened by hand on the dev server.
import { runGpuPoolProbe } from './gpuPoolProbe';

const output = document.getElementById('report');
if (!output) throw new Error('missing #report element');

window.gpuPoolProbe = Promise.resolve().then(() => {
  const report = runGpuPoolProbe();
  output.textContent = JSON.stringify(report, null, 2);
  return report;
});
