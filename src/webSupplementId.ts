/**
 * The id prefix that marks a search row as coming from the web rather than the catalog.
 *
 * Six places decide what to do with a row by testing this prefix: which rows the supplement is
 * allowed to merge, which get the relaxed title match, which render under "from the web". The
 * yt-dlp search built its rows as `yt-` instead, so none of the six recognised them and every hit
 * was dropped before anything was drawn. A literal string repeated in six files cannot disagree
 * with itself once it is written down once.
 */

export const WEB_SUPPLEMENT_ID_PREFIX = 'youtube-';

/** True when a search row came from the web supplement rather than the catalog. */
export function isWebSupplementId(id: string): boolean {
  return id.startsWith(WEB_SUPPLEMENT_ID_PREFIX);
}
