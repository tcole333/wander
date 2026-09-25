// Entry of e2e/gpu-timer.html: runs the GPU timer probe once and exposes the report to the spec.
import { runGpuTimerProbe } from './gpuTimerProbe';

const output = document.getElementById('report');
if (!output) throw new Error('missing #report element');

window.gpuTimerProbe = runGpuTimerProbe().then((report) => {
  output.textContent = JSON.stringify(report, null, 2);
  return report;
});
