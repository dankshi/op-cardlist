// SEO Configuration
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://opcardlist.com';

export const SITE_NAME = 'One Piece TCG Card List';
export const SITE_DESCRIPTION = 'The fastest, most comprehensive One Piece TCG card database with prices. Browse all cards, sets, and filter by color, type, rarity and more.';

// Social media handles (update with your actual handles)
export const TWITTER_HANDLE = '@opcardlist';

// Default OG Image (create this image for social sharing)
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

// SEO Keywords by category
export const BASE_KEYWORDS = [
  'One Piece TCG',
  'One Piece card game',
  'OPTCG',
  'One Piece trading cards',
  'card list',
  'card database',
  'deck building',
];

// Extract short human name from set name like "OP-10 - Royal Blood" → "Royal Blood"
export function getSetShortName(setName: string): string {
  const match = setName.match(/^[A-Z0-9-]+ - (.+)$/i);
  return match ? match[1] : setName;
}

// Set-specific keyword templates
export function getSetKeywords(setId: string, setName: string): string[] {
  const setUpper = setId.toUpperCase();
  const setNoHyphen = setId.replace('-', '').toUpperCase();
  const shortName = getSetShortName(setName);

  return [
    `${setUpper} card list`,
    `${setNoHyphen} card list`,
    `${setUpper} price list`,
    `${setNoHyphen} price list`,
    `${shortName} card list`,
    `${shortName} price guide`,
    `One Piece ${setUpper}`,
    `One Piece TCG ${setUpper}`,
    `One Piece ${shortName}`,
    `${setUpper} spoilers`,
    `${setUpper} cards`,
    `${setName} card list`,
    `${setUpper} price guide`,
    ...BASE_KEYWORDS,
  ];
}

// Card-specific keyword templates
export function getCardKeywords(cardName: string, cardId: string, setId: string): string[] {
  const setUpper = setId.toUpperCase();

  return [
    cardName,
    `${cardName} One Piece`,
    `${cardName} One Piece card`,
    `${cardName} ${setUpper}`,
    cardId,
    `${cardId} price`,
    `${cardId} effect`,
    `${cardName} TCG`,
    `${cardName} card`,
    `${cardName} card effect`,
    'One Piece TCG',
  ];
}

// Structured Data helpers
export function getOrganizationSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
    logo: `${SITE_URL}/logo.svg`,
    sameAs: [
      // Add your social media URLs here
      // 'https://twitter.com/opcardlist',
    ],
  };
}

export function getWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    alternateName: ['OPCardlist', 'OP Cardlist', 'opcardlist'],
    url: SITE_URL,
    description: SITE_DESCRIPTION,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE_URL}/search?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function getBreadcrumbSchema(items: { name: string; url: string }[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}
