// SEO Configuration
export const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.nomimarket.com';

export const SITE_NAME = 'NOMI Market';
export const SITE_DESCRIPTION = 'Buy and sell authenticated TCG cards on nomi market. Every order verified before it ships. Daily market prices across every set.';

// Social media handles
export const TWITTER_HANDLE = '@nomimarket';

// Default OG Image (create this image for social sharing)
export const DEFAULT_OG_IMAGE = `${SITE_URL}/og-image.png`;

// SEO Keywords by category
export const BASE_KEYWORDS = [
  'TCG marketplace',
  'trading card marketplace',
  'buy sell TCG cards',
  'authenticated cards',
  'One Piece TCG',
  'One Piece card game',
  'OPTCG',
  'card list',
  'card database',
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
    logo: `${SITE_URL}/nomi-logo.png`,
    sameAs: [
      // 'https://twitter.com/nomimarket',
    ],
  };
}

export function getWebSiteSchema() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE_NAME,
    alternateName: ['NOMI Market', 'NomiMarket', 'nomi market'],
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
