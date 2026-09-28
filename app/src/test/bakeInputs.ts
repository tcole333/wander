// Old stage records hash the whole pipeline, including stages that never produce surface bytes.
// Keep exact-code acceptance and one audited compatibility pair for the shipped bakes. Unknown
// code hashes still fail. See docs/design/measurements/work/surface-bake/provenance.md.
import { treeSha } from './stamp';

export const CODE_PATHS = [
  'pipeline/src',
  'pipeline/config',
  'pipeline/pyproject.toml',
  'pipeline/uv.lock',
  'shared/constants.json',
];

// Coverage, surface and their shared machinery. The six independent stages and their configs
// are excluded; shared modules, dependency pins and constants stay guarded in full. A new
// dependency requires an edit to one of these modules, which invalidates the compatibility pair.
export const SURFACE_CODE_PATHS = [
  ...[
    '__init__',
    'cli',
    'codes',
    'config',
    'constants',
    'coverage',
    'cube',
    'excerpts',
    'expect',
    'fetch',
    'fields',
    'footprint',
    'gebco',
    'hashing',
    'height',
    'layers',
    'natural_earth',
    'paths',
    'profiles',
    'records',
    'sources',
    'surface',
    'tiles',
    'workers',
    'wst',
  ].map((name) => `pipeline/src/prebuild/${name}.py`),
  'pipeline/pyproject.toml',
  'pipeline/uv.lock',
  'shared/constants.json',
];

const SHIPPED_CODE = '07a04a65765ced8063726fa8d91cc4676e38be460e4f339060317ab6a650a499';
const COMPATIBLE_SURFACE_CODE = 'a804ffaf4e0ad24cef5f23e4ece67821624538657e29450b803dd99717809da7';

export function matchesSurfaceCode(code: string, repo: string): boolean {
  return (
    code === treeSha(CODE_PATHS, repo) ||
    (code === SHIPPED_CODE && treeSha(SURFACE_CODE_PATHS, repo) === COMPATIBLE_SURFACE_CODE)
  );
}
