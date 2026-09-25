// Entry of e2e/lab/browser-features.html: prints what the browser offers and exposes it to
// Playwright; with ?report=<browser> it also posts it (e2e/lab/browser-features.lab.ts).
import { detectBrowserFeatures } from './browserFeatures';
import { postLabReport, reportFailures, reportingBrowser } from './labReport';

const output = document.getElementById('report');
if (!output) throw new Error('missing #report element');

const browser = reportingBrowser();
if (browser) reportFailures('browser-features', browser);

window.browserFeatures = Promise.resolve().then(async () => {
  const features = detectBrowserFeatures();
  output.textContent = JSON.stringify(features, null, 2);
  if (browser) await postLabReport('browser-features', browser, features);
  return features;
});
