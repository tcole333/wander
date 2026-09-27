// A beat's image straight from Wikimedia Commons (a local prototype: no mirror yet): one API call
// per image gives a thumbnail wide enough for the crop to stay sharp, the original's size for the
// frame's shape, and the author and license for the credit.
import { creditLine, plainText } from './format';

export interface CommonsImage {
  /** A thumbnail wide enough that the crop fills the card at 2x. */
  full: string;
  /** A small thumbnail of the same image, shown while `full` loads. */
  preview: string;
  width: number;
  height: number;
  credit: string;
  /** The file's page on Commons. */
  page: string;
}

const API = 'https://commons.wikimedia.org/w/api.php';
/** Device pixels the crop should cover: the card's image width at 2x. */
const CROP_PX = 680;
/** Commons' largest standard thumbnail width; it rounds requests up to one of these. */
const WIDTHS = [330, 500, 960, 1280, 1920, 3840];

/**
 * Makers for files whose Commons Artist field names the uploader instead: the Internet Archive's
 * Flickr account. The maker stands in the credit before Commons' license.
 */
const MAKERS: Record<string, string> = {
  'File:Recollections of a lifetime - or men and things I have seen - in a series of familiar letters to a friend - historical, biographical, anecdotical, and descriptive (1856) (14740173686).jpg':
    'Lossing & Barritt, for S. G. Goodrich',
};

const cache = new Map<string, Promise<CommonsImage>>();

/** The image for a Commons file title ('File:...'), with `cropWidth` the crop's share of its width. */
export function commonsImage(title: string, cropWidth: number): Promise<CommonsImage> {
  const width = Math.min(3840, Math.ceil(CROP_PX / Math.max(0.05, cropWidth)));
  const key = `${title}@${width}`;
  let image = cache.get(key);
  if (!image) {
    image = fetchImage(title, width);
    // A failure is not cached, so the next visit to the beat tries again.
    void image.catch(() => cache.delete(key));
    cache.set(key, image);
  }
  return image;
}

interface ApiResponse {
  query?: {
    pages?: Record<
      string,
      {
        missing?: string;
        imageinfo?: {
          url: string;
          thumburl?: string;
          width: number;
          height: number;
          descriptionurl: string;
          extmetadata?: Record<string, { value?: unknown }>;
        }[];
      }
    >;
  };
}

async function fetchImage(title: string, width: number): Promise<CommonsImage> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    origin: '*',
    prop: 'imageinfo',
    iiprop: 'url|size|extmetadata',
    iiextmetadatafilter: 'Artist|Credit|LicenseShortName',
    iiurlwidth: String(width),
    titles: title,
  });
  const response = await fetch(`${API}?${params.toString()}`);
  if (!response.ok) throw new Error(`Commons answered ${response.status} for ${title}`);
  const body = (await response.json()) as ApiResponse;
  const page = Object.values(body.query?.pages ?? {})[0];
  const info = page?.imageinfo?.[0];
  if (!info || page.missing !== undefined) throw new Error(`no Commons file ${title}`);
  const meta = (name: string) => {
    const value = info.extmetadata?.[name]?.value;
    return typeof value === 'string' ? value : '';
  };
  const full = info.thumburl ?? info.url;
  const maker = MAKERS[title];
  const license = meta('LicenseShortName');
  return {
    full,
    preview: previewOf(full),
    width: info.width,
    height: info.height,
    credit: maker
      ? `${maker} · ${plainText(license)}`
      : creditLine(meta('Artist'), meta('Credit'), license),
    page: info.descriptionurl,
  };
}

/** A thumbnail about a quarter as wide, at a standard width, or the same URL for an original. */
function previewOf(thumb: string): string {
  const match = /\/(\d+)px-/.exec(thumb);
  if (!match) return thumb;
  const quarter = Number(match[1]) / 4;
  const width = WIDTHS.filter((w) => w <= quarter).pop() ?? WIDTHS[0];
  return thumb.replace(/\/\d+px-/, `/${width}px-`);
}
