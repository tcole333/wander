import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { tunables } from './tunables';

const designDoc = readFileSync(
  new URL('../../../docs/design/streaming.md', import.meta.url),
  'utf8',
);
/** The borders' build rules, which section 10 lists beside the app's tunables. */
const borderRules = parse(
  readFileSync(new URL('../../../pipeline/config/borders/rules.yaml', import.meta.url), 'utf8'),
) as Record<string, number>;

function sectionTenNames(markdown: string): string[] {
  const section = markdown.split(/^## 10\. Tunables$/m)[1]?.split(/^## /m)[0];
  if (!section) throw new Error('section 10 (Tunables) not found in streaming.md');
  const rows = section.split('\n').filter((line) => line.startsWith('| `'));
  return rows.flatMap((row) => {
    const nameCell = row.split('|')[1] ?? '';
    return [...nameCell.matchAll(/`([A-Za-z0-9]+)`/g)].map((match) => match[1] ?? '');
  });
}

describe('tunables', () => {
  const documented = sectionTenNames(designDoc);

  it('has a starting value for every name in the design doc table', () => {
    const missing = documented.filter((name) => !(name in tunables) && !(name in borderRules));
    expect(missing).toEqual([]);
  });

  it('holds no name the design doc table lacks', () => {
    const undocumented = Object.keys(tunables).filter((name) => !documented.includes(name));
    expect(undocumented).toEqual([]);
  });

  it("documents every one of the borders' build rules", () => {
    const undocumented = Object.keys(borderRules).filter((name) => !documented.includes(name));
    expect(undocumented).toEqual([]);
  });
});
