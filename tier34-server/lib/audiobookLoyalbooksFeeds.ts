/**
 * Curated Loyal Books per-book RSS feeds — search index + feed URLs.
 * Pattern: https://www.loyalbooks.com/book/{slug}/feed
 */

export type LoyalbooksFeed = {
  slug: string;
  title: string;
  author: string;
};

export function loyalbooksFeedUrl(slug: string): string {
  return `https://www.loyalbooks.com/book/${slug.trim()}/feed`;
}

/** Popular public-domain titles with known Loyal Books RSS feeds. */
export const AUDIOBOOK_LOYALBOOKS_FEEDS: LoyalbooksFeed[] = [
  { slug: 'pride-and-prejudice', title: 'Pride and Prejudice', author: 'Jane Austen' },
  { slug: 'frankenstein-by-mary-shelley', title: 'Frankenstein', author: 'Mary Shelley' },
  { slug: 'dracula-by-bram-stoker', title: 'Dracula', author: 'Bram Stoker' },
  { slug: 'alice-in-wonderland-by-lewis-carroll', title: "Alice's Adventures in Wonderland", author: 'Lewis Carroll' },
  { slug: 'treasure-island-by-robert-louis-stevenson', title: 'Treasure Island', author: 'Robert Louis Stevenson' },
  { slug: 'the-adventures-of-sherlock-holmes-by-sir-arthur-conan-doyle', title: 'The Adventures of Sherlock Holmes', author: 'Arthur Conan Doyle' },
  { slug: 'great-expectations-by-charles-dickens', title: 'Great Expectations', author: 'Charles Dickens' },
  { slug: 'moby-dick-by-herman-melville', title: 'Moby Dick', author: 'Herman Melville' },
  { slug: 'jane-eyre-by-charlotte-bronte', title: 'Jane Eyre', author: 'Charlotte Brontë' },
  { slug: 'wuthering-heights-by-emily-bronte', title: 'Wuthering Heights', author: 'Emily Brontë' },
  { slug: 'the-jungle-book-by-rudyard-kipling', title: 'The Jungle Book', author: 'Rudyard Kipling' },
  { slug: 'the-war-of-the-worlds-by-hg-wells', title: 'The War of the Worlds', author: 'H. G. Wells' },
  { slug: 'the-count-of-monte-cristo-by-alexandre-dumas', title: 'The Count of Monte Cristo', author: 'Alexandre Dumas' },
  { slug: 'the-picture-of-dorian-gray-by-oscar-wilde', title: 'The Picture of Dorian Gray', author: 'Oscar Wilde' },
  { slug: 'the-scarlet-letter-by-nathaniel-hawthorne', title: 'The Scarlet Letter', author: 'Nathaniel Hawthorne' },
  { slug: 'a-tale-of-two-cities-by-charles-dickens', title: 'A Tale of Two Cities', author: 'Charles Dickens' },
  { slug: 'the-time-machine-by-hg-wells', title: 'The Time Machine', author: 'H. G. Wells' },
  { slug: 'the-legend-of-sleepy-hollow-by-washington-irving', title: 'The Legend of Sleepy Hollow', author: 'Washington Irving' },
  { slug: 'around-the-world-in-80-days-by-jules-verne', title: 'Around the World in Eighty Days', author: 'Jules Verne' },
  { slug: 'the-call-of-the-wild-by-jack-london', title: 'The Call of the Wild', author: 'Jack London' },
];

export function searchLoyalbooksFeedIndex(query: string, feeds = AUDIOBOOK_LOYALBOOKS_FEEDS): LoyalbooksFeed[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  return feeds.filter(
    (f) =>
      f.title.toLowerCase().includes(q) ||
      f.author.toLowerCase().includes(q) ||
      f.slug.replace(/-/g, ' ').includes(q),
  );
}
