import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import type { Product, ProductCategory, ProductTag, ProductDatabase } from '../src/types/card';

const BASE_URL = 'https://en.onepiece-cardgame.com';
const PRODUCTS_URL = `${BASE_URL}/products/`;
const DELAY_MS = 500;
const CONCURRENCY = 3;

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function parseCategory(text: string): ProductCategory | null {
  const lower = text.toLowerCase();
  if (lower.includes('boosters')) return 'boosters';
  if (lower.includes('decks')) return 'decks';
  if (lower.includes('other')) return 'other';
  return null;
}

function extractProductId(href: string, name: string): string {
  // Try to extract a set code from the name, e.g., "[ST-20]" -> "st20", "[OP-13]" -> "op13"
  const codeMatch = name.match(/\[([A-Z]{1,4}-?\d{1,4})\]/i);
  if (codeMatch) {
    return codeMatch[1].toLowerCase().replace(/-/g, '');
  }

  // Base ID from the URL filename
  // "./boosters/op13.php" -> "op13"
  const match = href.match(/\.\/\w+\/(.+)\.php/);
  return match ? match[1] : href;
}

// Track seen IDs to make duplicates unique
const seenIds = new Map<string, number>();

function ensureUniqueId(baseId: string, name: string): string {
  // For products that share a detail page (like "goods_storage_boxset_5type"),
  // derive a unique suffix from the character name in the product name
  const charMatch = name.match(/-([A-Z][a-z.]+(?:\.[A-Z][a-z.]+)*(?:"[^"]*"[A-Z][a-z.]+)*)-?\s*$/);

  const count = (seenIds.get(baseId) || 0) + 1;
  seenIds.set(baseId, count);

  if (count === 1) return baseId;

  // Try to create a meaningful suffix from character name
  if (charMatch) {
    const suffix = charMatch[1].toLowerCase().replace(/[.\s"]/g, '_').replace(/_+/g, '_').replace(/_$/, '');
    return `${baseId}_${suffix}`;
  }

  return `${baseId}_${count}`;
}

function deriveTag(name: string, category: ProductCategory): ProductTag {
  const n = name.toLowerCase();

  // Boosters
  if (category === 'boosters') {
    if (n.includes('extra booster')) return 'extra-boosters';
    if (n.includes('premium booster')) return 'premium-boosters';
    return 'booster-packs';
  }

  // Decks
  if (category === 'decks') {
    if (n.includes('ultra deck')) return 'ultra-decks';
    return 'starter-decks';
  }

  // Other / Accessories - order matters: check compound names first
  if (n.includes('playmat') && (n.includes('storage') || n.includes('card case'))) return 'bundles';
  if (n.includes('sleeve')) return 'sleeves';
  if (n.includes('playmat')) return 'playmats';
  if (n.includes('storage box')) return 'storage';
  if (n.includes('card case') || n.includes('cardcase')) return 'card-cases';
  if (n.includes('illustration box')) return 'illustration-boxes';
  if (n.includes('double pack')) return 'double-packs';
  if (n.includes('tin pack')) return 'tin-packs';
  if (n.includes('don!!') || n.includes('don set')) return 'don-sets';
  if (n.includes('devil fruit')) return 'devil-fruits';
  if (n.includes('binder')) return 'binders';
  if (n.includes('anniversary')) return 'anniversary-sets';
  if (n.includes('collection') || n.includes('gift collection')) return 'collections';
  if (n.includes('goods set') || n.includes('special goods')) return 'bundles';

  return 'misc';
}

function resolveUrl(src: string, baseUrl: string): string {
  if (!src) return '';
  // Strip query params for clean URLs
  const cleanSrc = src.split('?')[0];

  if (cleanSrc.startsWith('http')) return cleanSrc;
  if (cleanSrc.startsWith('//')) return `https:${cleanSrc}`;
  if (cleanSrc.startsWith('/')) return `${BASE_URL}${cleanSrc}`;

  // Relative paths from the products page
  if (cleanSrc.startsWith('../')) {
    // "../images/products/..." relative to /products/ -> /images/products/...
    return `${BASE_URL}/${cleanSrc.replace('../', '')}`;
  }
  if (cleanSrc.startsWith('./')) {
    return `${baseUrl}${cleanSrc.substring(2)}`;
  }

  return `${baseUrl}${cleanSrc}`;
}

async function fetchListingPage(): Promise<Product[]> {
  console.log(`Fetching products listing: ${PRODUCTS_URL}`);
  const response = await fetch(PRODUCTS_URL, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Accept': 'text/html,application/xhtml+xml',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch products page: ${response.status}`);
  }

  const html = await response.text();
  const $ = cheerio.load(html);

  const products: Product[] = [];

  // Find all product links - they link to .php detail pages within boosters/, decks/, or other/
  $('a').each((_, el) => {
    const $el = $(el);
    const href = $el.attr('href') || '';

    // Only process product detail links
    if (!href.match(/^\.\/(boosters|decks|other)\/.+\.php/)) return;

    // Extract category from the URL path
    const categoryMatch = href.match(/^\.\/(boosters|decks|other)\//);
    const categoryFromUrl = categoryMatch ? categoryMatch[1] as ProductCategory : 'other';

    // Try to also get category from text (more accurate if present)
    const fullText = $el.text();
    const categoryTextMatch = fullText.match(/\[(BOOSTERS|DECKS|OTHER)\]/i);
    const category = categoryTextMatch ? parseCategory(categoryTextMatch[1]) || categoryFromUrl : categoryFromUrl;

    // Image
    const img = $el.find('img').first();
    const thumbnailSrc = img.attr('src') || '';
    const thumbnailUrl = resolveUrl(thumbnailSrc, PRODUCTS_URL);

    // Name - try h3 first, then img alt
    const name = $el.find('h3').text().trim()
      || $el.find('h2').text().trim()
      || img.attr('alt')?.trim()
      || '';

    if (!name) return; // Skip entries without a name

    // Release date
    const releaseDateMatch = fullText.match(/Release\s*(?:Date)?\s*([A-Z][a-z]+ \d{1,2},?\s*\d{4})/i);
    const releaseDate = releaseDateMatch ? releaseDateMatch[1].trim() : null;

    // MSRP
    const msrpMatch = fullText.match(/MSRP\s*(USD\s*\$[\d.,]+(?:\s*per\s*pack)?)/i);
    const msrp = msrpMatch ? msrpMatch[1].trim() : null;

    const baseId = extractProductId(href, name);
    const id = ensureUniqueId(baseId, name);
    const detailUrl = `${BASE_URL}/products/${href.substring(2)}`; // Remove "./"

    products.push({
      id,
      name,
      category,
      tag: deriveTag(name, category),
      releaseDate,
      msrp,
      detailUrl,
      thumbnailUrl,
      description: null,
      contents: null,
      detailImages: [],
      cardImages: [],
    });
  });

  return products;
}

async function fetchDetailPage(product: Product): Promise<Partial<Product>> {
  try {
    const response = await fetch(product.detailUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml',
      },
    });

    if (!response.ok) {
      console.error(`  Failed to fetch ${product.detailUrl}: ${response.status}`);
      return {};
    }

    const html = await response.text();
    const $ = cheerio.load(html);

    // Extract description - look for meaningful paragraph text
    let description: string | null = null;
    $('p').each((_, el) => {
      const text = $(el).text().trim();
      if (text.length > 30 && !text.includes('©') && !text.includes('BANDAI') && !description) {
        description = text;
      }
    });

    // Extract contents from <dt>Contents</dt><dd>...</dd> or similar structure
    let contents: string | null = null;
    $('dt').each((_, el) => {
      if ($(el).text().toLowerCase().includes('contents')) {
        contents = $(el).next('dd').text().trim() || null;
      }
    });

    // Extract the product's directory from the detail page URL
    // e.g., "https://.../products/boosters/eb03.php" -> product path segments "boosters/eb03"
    const urlMatch = product.detailUrl.match(/products\/(boosters|decks|other)\/([^.]+)\.php/);
    const productDir = urlMatch ? `${urlMatch[1]}/${urlMatch[2]}` : '';

    // Collect images - only those belonging to this product's directory
    const detailImageSet = new Set<string>();
    const cardImageSet = new Set<string>();

    $('img').each((_, el) => {
      const src = $(el).attr('src') || '';
      if (!src) return;

      const fullUrl = resolveUrl(src, product.detailUrl.substring(0, product.detailUrl.lastIndexOf('/') + 1));
      if (!fullUrl) return;

      // Skip common site-wide images
      if (fullUrl.includes('/common/') || fullUrl.includes('/beginners/')) return;
      if (fullUrl.includes('footer_illust') || fullUrl.includes('ico_')) return;
      if (fullUrl.includes('/sns/') || fullUrl.includes('btn_')) return;
      if (fullUrl.includes('logo_header') || fullUrl.includes('logo_footer')) return;

      // Only include images from this product's own directory
      // This filters out "related products" images from other products
      if (productDir && !fullUrl.includes(productDir)) return;

      const filename = fullUrl.split('/').pop() || '';

      // Product images (img_item*, mv_*, img_features*, etc.)
      if (filename.match(/^(img_item|mv_|img_\d|img_features)/)) {
        detailImageSet.add(fullUrl);
      }
      // Card preview images (e.g., EB03-001.webp, ST29-001.png)
      else if (filename.match(/^[A-Z]{2,4}\d{2,3}[-_]/)) {
        cardImageSet.add(fullUrl);
      }
      // Other product-specific images (DON cards, logos, etc.)
      else if (filename.match(/^(don_|img_pack|img_box|img_deck|img_sleeve)/)) {
        detailImageSet.add(fullUrl);
      }
    });

    const detailImages = Array.from(detailImageSet);
    const cardImages = Array.from(cardImageSet);

    return { description, contents, detailImages, cardImages };
  } catch (error) {
    console.error(`  Error fetching detail for ${product.id}:`, error);
    return {};
  }
}

async function enrichWithDetailPages(products: Product[]): Promise<void> {
  // Deduplicate detail URLs (some products share pages like st15-20.php)
  const urlToProducts = new Map<string, Product[]>();
  for (const product of products) {
    const existing = urlToProducts.get(product.detailUrl) || [];
    existing.push(product);
    urlToProducts.set(product.detailUrl, existing);
  }

  const uniqueUrls = Array.from(urlToProducts.keys());
  console.log(`\nFetching ${uniqueUrls.length} unique detail pages for ${products.length} products...`);

  let completed = 0;

  for (let i = 0; i < uniqueUrls.length; i += CONCURRENCY) {
    const batch = uniqueUrls.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(async (url) => {
      const productsForUrl = urlToProducts.get(url)!;
      const details = await fetchDetailPage(productsForUrl[0]);

      // Apply details to all products sharing this URL
      for (const product of productsForUrl) {
        if (details.description) product.description = details.description;
        if (details.contents) product.contents = details.contents;
        if (details.detailImages) product.detailImages = details.detailImages;
        if (details.cardImages) product.cardImages = details.cardImages;
      }

      completed++;
      process.stdout.write(`\r  Progress: ${completed}/${uniqueUrls.length}`);
    }));

    if (i + CONCURRENCY < uniqueUrls.length) {
      await sleep(DELAY_MS);
    }
  }

  console.log(); // New line after progress
}

async function main() {
  const args = process.argv.slice(2);
  const categoryFilter = args.find(a => a.startsWith('--category='))?.split('=')[1] as ProductCategory | undefined;
  const skipDetails = args.includes('--skip-details');
  const force = args.includes('--force');
  const debug = args.includes('--debug');

  console.log('One Piece Card Game Products Scraper');
  console.log('=====================================\n');

  const dataDir = path.join(process.cwd(), 'data');
  const outputPath = path.join(dataDir, 'products.json');

  // Fetch listing page
  let products = await fetchListingPage();
  console.log(`Found ${products.length} products on listing page`);

  if (debug) {
    for (const p of products) {
      console.log(`  [${p.category}] ${p.id}: ${p.name} | ${p.thumbnailUrl ? 'has thumb' : 'NO thumb'}`);
    }
  }

  if (categoryFilter) {
    products = products.filter(p => p.category === categoryFilter);
    console.log(`Filtered to ${products.length} ${categoryFilter} products`);
  }

  // Fetch detail pages (unless skipped)
  if (!skipDetails) {
    await enrichWithDetailPages(products);
  }

  // Merge with existing data if not forcing
  if (!force && fs.existsSync(outputPath)) {
    const existing: ProductDatabase = JSON.parse(fs.readFileSync(outputPath, 'utf-8'));
    const existingMap = new Map(existing.products.map(p => [p.id, p]));

    for (const product of products) {
      const prev = existingMap.get(product.id);
      if (prev && !product.description && prev.description) {
        product.description = prev.description;
        product.contents = prev.contents;
        product.detailImages = prev.detailImages;
        product.cardImages = prev.cardImages;
      }
    }
  }

  const database: ProductDatabase = {
    products,
    lastUpdated: new Date().toISOString(),
  };

  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(database, null, 2));

  // Summary
  const byCategory = products.reduce((acc, p) => {
    acc[p.category] = (acc[p.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  console.log(`\nSaved ${products.length} products to ${outputPath}`);
  console.log(`  Boosters: ${byCategory.boosters || 0}`);
  console.log(`  Decks: ${byCategory.decks || 0}`);
  console.log(`  Other: ${byCategory.other || 0}`);

  if (debug) {
    const withDesc = products.filter(p => p.description).length;
    const withImages = products.filter(p => p.detailImages.length > 0).length;
    console.log(`  With description: ${withDesc}`);
    console.log(`  With detail images: ${withImages}`);
  }
}

main().catch(console.error);
