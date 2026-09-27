// Sample Meanwhile entries for the UI harness alone, in the contract's shape. The walk's real
// entries come from ../meanwhile.tambora.json; the harness reads that file when it exists.
import type { MeanwhileByBeat, MeanwhileEntry } from '../contract';
import { dayFromIso } from '../dates';
import type { LonLat } from '../story';

function entry(label: string, iso: string, dateLabel: string, at: LonLat, wiki: string) {
  const source = {
    title: `${wiki.replace(/_/g, ' ')} (Wikipedia)`,
    url: `https://en.wikipedia.org/wiki/${wiki}`,
  };
  return { label, day: dayFromIso(iso), dateLabel, at, source } satisfies MeanwhileEntry;
}

const hundredDays = entry(
  'Napoleon returns: the Hundred Days',
  '1815-03-20',
  'March–July 1815',
  [2.3522, 48.8566],
  'Hundred_Days',
);
const vienna = entry(
  'Congress of Vienna redraws Europe',
  '1815-06-09',
  'September 1814 – June 1815',
  [16.3738, 48.2082],
  'Congress_of_Vienna',
);
const nepal = entry(
  'Anglo-Nepalese War',
  '1815-04-01',
  '1814–1816',
  [85.324, 27.7172],
  'Anglo-Nepalese_War',
);
const kandy = entry(
  'Kandyan Convention',
  '1815-03-02',
  '2 March 1815',
  [80.6337, 7.2906],
  'Kandyan_Convention',
);
const waterloo = entry(
  'Battle of Waterloo',
  '1815-06-18',
  '18 June 1815',
  [4.4125, 50.68],
  'Battle_of_Waterloo',
);
const sugauli = entry(
  'Treaty of Sugauli ends the war in Nepal',
  '1816-03-04',
  'December 1815 – March 1816',
  [84.73, 26.77],
  'Sugauli_Treaty',
);
const tucuman = entry(
  'Argentina declares independence',
  '1816-07-09',
  '9 July 1816',
  [-65.2226, -26.8083],
  'Argentine_Declaration_of_Independence',
);
const algiers = entry(
  'Bombardment of Algiers',
  '1816-08-27',
  '27 August 1816',
  [3.0588, 36.7538],
  'Bombardment_of_Algiers_(1816)',
);
const amherst = entry(
  "Lord Amherst's embassy reaches Beijing",
  '1816-08-29',
  'August 1816',
  [116.3, 40.0],
  'Amherst_embassy',
);
const monroe = entry(
  'James Monroe elected president',
  '1816-12-04',
  'November–December 1816',
  [-77.0365, 38.8977],
  '1816_United_States_presidential_election',
);
const maratha = entry(
  'Third Anglo-Maratha War',
  '1817-11-05',
  '1817–1818',
  [73.8567, 18.5204],
  'Third_Anglo-Maratha_War',
);
const wartburg = entry(
  'Students gather at the Wartburg',
  '1817-10-18',
  '18 October 1817',
  [10.3065, 50.9665],
  'Wartburg_Festival',
);

export const SAMPLE_MEANWHILE: MeanwhileByBeat = {
  'world-1815': [vienna, hundredDays, nepal],
  sunda: [hundredDays, vienna, kandy],
  sumbawa: [hundredDays, vienna, nepal],
  ash: [vienna, waterloo, nepal],
  veil: [waterloo, vienna, sugauli],
  'europe-1816': [tucuman, algiers, amherst],
  'new-england-1816': [tucuman, algiers, monroe],
  'yunnan-bengal-1817': [maratha, wartburg],
};
