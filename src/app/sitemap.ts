import { MetadataRoute } from 'next';
import { getAllSets, getAllCards } from '@/lib/cards';
import { getAllCharacterSlugs } from '@/lib/characters';
import { SITE_URL } from '@/lib/seo';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const sets = getAllSets();
  const cards = await getAllCards();

  // Homepage and key pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
    {
      url: `${SITE_URL}/hot`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.8,
    },
    {
      url: `${SITE_URL}/products`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 0.7,
    },
  ];

  // All set pages (high priority - these are key landing pages)
  const setPages: MetadataRoute.Sitemap = sets.map((set) => ({
    url: `${SITE_URL}/${set.id}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.9,
  }));

  // Character pages
  const characterSlugs = getAllCharacterSlugs();
  const characterPages: MetadataRoute.Sitemap = characterSlugs.map((slug) => ({
    url: `${SITE_URL}/character/${slug}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  // All card pages (medium priority)
  const cardPages: MetadataRoute.Sitemap = cards.map((card) => ({
    url: `${SITE_URL}/card/${card.id.toLowerCase()}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  return [...staticPages, ...setPages, ...characterPages, ...cardPages];
}
