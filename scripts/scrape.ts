import * as cheerio from 'cheerio';
import * as fs from 'fs';
import * as path from 'path';
import type { Card, CardSet, CardDatabase, CardColor, CardType, Rarity, Attribute, ArtStyle } from '../src/types/card';

const BASE_URL = 'https://en.onepiece-cardgame.com';

// Map of set series IDs to their info
const SETS: Record<string, { id: string; name: string }> = {
  '569113': { id: 'op-13', name: 'OP-13 Booster Pack - CARRYING ON HIS WILL' },
  '569112': { id: 'op-12', name: 'OP-12 Booster Pack' },
  '569111': { id: 'op-11', name: 'OP-11 Booster Pack' },
  '569110': { id: 'op-10', name: 'OP-10 Booster Pack' },
  '569109': { id: 'op-09', name: 'OP-09 Booster Pack' },
  '569108': { id: 'op-08', name: 'OP-08 Booster Pack' },
  '569107': { id: 'op-07', name: 'OP-07 Booster Pack' },
  '569106': { id: 'op-06', name: 'OP-06 Booster Pack' },
  '569105': { id: 'op-05', name: 'OP-05 Booster Pack' },
  '569104': { id: 'op-04', name: 'OP-04 Booster Pack' },
  '569103': { id: 'op-03', name: 'OP-03 Booster Pack' },
  '569102': { id: 'op-02', name: 'OP-02 Booster Pack' },
  '569101': { id: 'op-01', name: 'OP-01 Booster Pack' },
};

function parseRarity(text: string): Rarity {
  const rarityMap: Record<string, Rarity> = {
    'L': 'L',
    'SEC': 'SEC',
    'SR': 'SR',
    'R': 'R',
    'UC': 'UC',
    'C': 'C',
    'SP': 'SP',
    'TR': 'TR',
    'P': 'P',
  };
  return rarityMap[text.trim()] || 'C';
}

function parseCardType(text: string): CardType {
  const typeMap: Record<string, CardType> = {
    'LEADER': 'LEADER',
    'CHARACTER': 'CHARACTER',
    'EVENT': 'EVENT',
    'STAGE': 'STAGE',
  };
  return typeMap[text.trim().toUpperCase()] || 'CHARACTER';
}

function parseColors(text: string): CardColor[] {
  const colorMap: Record<string, CardColor> = {
    'red': 'Red',
    'green': 'Green',
    'blue': 'Blue',
    'purple': 'Purple',
    'black': 'Black',
    'yellow': 'Yellow',
  };

  const colors: CardColor[] = [];
  const normalized = text.toLowerCase();

  for (const [key, value] of Object.entries(colorMap)) {
    if (normalized.includes(key)) {
      colors.push(value);
    }
  }

  return colors.length > 0 ? colors : ['Red'];
}

function parseAttribute(text: string): Attribute | null {
  const attrMap: Record<string, Attribute> = {
    'strike': 'Strike',
    'slash': 'Slash',
    'special': 'Special',
    'wisdom': 'Wisdom',
    'ranged': 'Ranged',
  };

  const normalized = text.toLowerCase();
  for (const [key, value] of Object.entries(attrMap)) {
    if (normalized.includes(key)) {
      return value;
    }
  }
  return null;
}

function parseNumber(text: string): number | null {
  const cleaned = text.replace(/[^\d]/g, '');
  if (cleaned === '' || text.includes('-')) return null;
  return parseInt(cleaned, 10);
}

function parseTraits(text: string): string[] {
  return text.split('/').map(t => t.trim()).filter(t => t.length > 0);
}

// Known wanted poster cards (card IDs that are wanted poster art)
const WANTED_CARDS = new Set<string>([
  'OP01-016_p4',
  'OP03-112_p4',
  'OP05-067_p4',
  'OP13-118_p4',
  'OP13-119_p4',
  // Add more as discovered
]);

// Known manga art cards
const MANGA_CARDS = new Set<string>([
  // Add manga card IDs as discovered
]);

function detectArtStyle(cardId: string, imageUrl: string, variant: string | undefined, isParallel: boolean): ArtStyle {
  if (!isParallel) {
    return 'standard';
  }

  // Check against known wanted poster cards
  if (WANTED_CARDS.has(cardId)) {
    return 'wanted';
  }

  // Check against known manga cards
  if (MANGA_CARDS.has(cardId)) {
    return 'manga';
  }

  const lowerUrl = imageUrl.toLowerCase();

  // URL-based detection as fallback
  if (lowerUrl.includes('_manga') || lowerUrl.includes('manga_')) {
    return 'manga';
  }

  if (lowerUrl.includes('_wanted') || lowerUrl.includes('wanted_')) {
    return 'wanted';
  }

  // Default to alternate art for other parallels
  return 'alternate';
}

async function fetchPage(seriesId: string): Promise<string> {
  const url = `${BASE_URL}/cardlist/?series=${seriesId}`;
  console.log(`Fetching: ${url}`);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }

  return response.text();
}

function parseCards(html: string, setId: string): Card[] {
  const $ = cheerio.load(html);
  const cards: Card[] = [];
  const seenIds = new Set<string>();

  $('dl.modalCol').each((_, element) => {
    const $card = $(element);
    const fullId = $card.attr('id');

    if (!fullId || seenIds.has(fullId)) {
      return;
    }
    seenIds.add(fullId);

    // Check if this is a parallel art version (e.g., OP13-001_p1)
    const isParallel = fullId.includes('_');
    const variant = isParallel ? fullId.split('_')[1] : undefined;
    const baseId = isParallel ? fullId.split('_')[0] : fullId;

    // Parse info line: "OP13-001 | L | LEADER" or "OP13-001 | SP CARD | LEADER"
    const infoText = $card.find('.infoCol').text();
    const infoParts = infoText.split('|').map(s => s.trim());

    const rarityText = (infoParts[1] || '').replace('CARD', '').trim();
    const rarity = parseRarity(rarityText);
    const cardType = parseCardType(infoParts[2] || '');

    // Card name
    const name = $card.find('.cardName').text().trim();

    // Image URL
    const imgSrc = $card.find('.frontCol img').attr('data-src') || '';
    const imageUrl = imgSrc.startsWith('..')
      ? `${BASE_URL}${imgSrc.substring(2)}`
      : imgSrc.startsWith('/')
        ? `${BASE_URL}${imgSrc}`
        : imgSrc;

    // Stats
    const costText = $card.find('.cost').text().replace('Life', '').replace('Cost', '').trim();
    const powerText = $card.find('.power').text().replace('Power', '').trim();
    const counterText = $card.find('.counter').text().replace('Counter', '').trim();

    const cost = cardType === 'LEADER' ? null : parseNumber(costText);
    const life = cardType === 'LEADER' ? parseNumber(costText) : null;
    const power = parseNumber(powerText);
    const counter = parseNumber(counterText);

    // Attribute
    const attrText = $card.find('.attribute i').text().trim() ||
                     $card.find('.attribute').text().replace('Attribute', '').trim();
    const attribute = parseAttribute(attrText);

    // Colors
    const colorText = $card.find('.color').text().replace('Color', '').trim();
    const colors = parseColors(colorText);

    // Traits
    const traitsText = $card.find('.feature').text().replace('Type', '').trim();
    const traits = parseTraits(traitsText);

    // Effect
    const effectText = $card.find('.text').clone().children('h3').remove().end().text().trim();

    // Check for trigger effect
    const fullText = $card.find('.text').text();
    const triggerMatch = fullText.match(/\[Trigger\]([^[]*)/i);
    const trigger = triggerMatch ? triggerMatch[1].trim() : null;

    // Detect art style
    const artStyle = detectArtStyle(fullId, imageUrl, variant, isParallel);

    const card: Card = {
      id: fullId,
      baseId,
      name,
      type: cardType,
      colors,
      rarity,
      cost,
      power,
      counter,
      life,
      attribute,
      traits,
      effect: effectText,
      trigger,
      imageUrl,
      setId,
      variant,
      isParallel,
      artStyle,
    };

    cards.push(card);
  });

  return cards;
}

async function scrapeSet(seriesId: string): Promise<CardSet | null> {
  const setInfo = SETS[seriesId];
  if (!setInfo) {
    console.error(`Unknown series ID: ${seriesId}`);
    return null;
  }

  try {
    const html = await fetchPage(seriesId);
    const cards = parseCards(html, setInfo.id);

    console.log(`Found ${cards.length} unique cards in ${setInfo.name}`);

    return {
      id: setInfo.id,
      name: setInfo.name,
      seriesId,
      releaseDate: new Date().toISOString().split('T')[0],
      cardCount: cards.length,
      cards,
    };
  } catch (error) {
    console.error(`Error scraping ${setInfo.name}:`, error);
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const seriesIds = args.length > 0 ? args : Object.keys(SETS);

  console.log(`Scraping ${seriesIds.length} set(s)...`);

  const sets: CardSet[] = [];

  for (const seriesId of seriesIds) {
    const set = await scrapeSet(seriesId);
    if (set) {
      sets.push(set);
    }
    // Small delay between requests
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  const database: CardDatabase = {
    sets,
    lastUpdated: new Date().toISOString(),
  };

  const outputPath = path.join(process.cwd(), 'data', 'cards.json');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(database, null, 2));

  console.log(`\nSaved ${sets.length} set(s) with ${sets.reduce((sum, s) => sum + s.cardCount, 0)} total cards to ${outputPath}`);
}

main().catch(console.error);
