import { MetadataRoute } from 'next';
import { getAllSets, getAllCards } from '@/lib/cards';
import { SITE_URL } from '@/lib/seo';

export default function sitemap(): MetadataRoute.Sitemap {
  const sets = getAllSets();
  const cards = getAllCards();

  // Homepage
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: SITE_URL,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 1.0,
    },
  ];

  // All set pages (high priority - these are key landing pages)
  const setPages: MetadataRoute.Sitemap = sets.map((set) => ({
    url: `${SITE_URL}/${set.id}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.9,
  }));

  // All card pages (medium priority)
  const cardPages: MetadataRoute.Sitemap = cards.map((card) => ({
    url: `${SITE_URL}/card/${card.id.toLowerCase()}`,
    lastModified: new Date(),
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  return [...staticPages, ...setPages, ...cardPages];
}
