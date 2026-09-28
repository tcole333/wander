// A story's lock (streaming.md 3.9: stories/<story>/story.lock.json), which the prebuild's media
// and meanwhile stages write and the app bundles with the story: per image, the baked crop's files
// on the data host with their sizes, and the credit, license and Commons page; Meanwhile's entries
// for each beat and each month (story/meanwhile.ts); and the lobby's glows. withLock joins the
// images to the parsed story, so the card reads its image from the data host and its credit from
// the bundle.
import type { Story, StoryImage } from './story';

/** One baked file of an image: its key on the data host, its size in px and its bytes. */
export interface LockedFile {
  key: string;
  w: number;
  h: number;
  bytes: number;
}

export interface LockedImage {
  /** The Commons file, its sha1 and the crop the story names, which find the entry. */
  commons: string;
  sha1: string;
  crop: number[];
  files: LockedFile[];
  /** The makers, as the card's caption names them. */
  credit: string;
  /**
   * The holding collection's own credit line, where it asks to be credited so (the David Rumsey
   * Map Collection's), which the caption gives in full under the makers.
   */
  collection?: string;
  /** The license as Commons states it, or the source's rights statement as the story words it. */
  license: string;
  /** The file's page on Commons. */
  source: string;
}

/** An event from the event index, as Meanwhile shows it. */
export interface LockedEvent {
  qid: string;
  /** The Wikidata label, its first letter capitalized. */
  label: string;
  /** An ISO date, and the precision the panel prints it at, 'day', 'month' or 'year'. */
  date: string;
  precision: string;
  /** [lon, lat]. */
  at: number[];
  /** A beat's entry: the line the story's writers give it, in the story's voice. */
  line?: string;
  source: { title: string; url: string };
}

export interface StoryLock {
  images: LockedImage[];
  meanwhile?: {
    /** By beat id. */
    beats: Record<string, LockedEvent[]>;
    /** By month, 'YYYY-MM', for scrubbing. */
    months: Record<string, LockedEvent[]>;
  };
  /** The lobby's glows: the best-scored events of every era, spread over the globe. */
  glows?: { qid: string; label: string; at: number[] }[];
}

/** The lock's entry for a beat's image: the same file, cropped the same. */
export function lockedImage(lock: StoryLock, image: StoryImage): LockedImage | undefined {
  return lock.images.find(
    (entry) => entry.sha1 === image.sha1 && image.crop.every((value, i) => entry.crop[i] === value),
  );
}

/** The story with each beat's image joined to its lock entry, where the lock has one. */
export function withLock(story: Story, lock: StoryLock): Story {
  const beats = story.beats.map((beat) => ({
    ...beat,
    image: { ...beat.image, locked: lockedImage(lock, beat.image) },
  }));
  return { ...story, beats };
}
