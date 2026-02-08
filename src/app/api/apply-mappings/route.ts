import { NextResponse } from 'next/server';
import * as fs from 'fs';
import * as path from 'path';

interface CardMapping {
  cardId: string;
  tcgProductId: number;
  tcgUrl: string;
  tcgName: string;
  price?: number | null;
}

interface PriceData {
  lastUpdated: string;
  prices: Record<string, {
    marketPrice?: number | null;
    lowPrice?: number | null;
    midPrice?: number | null;
    highPrice?: number | null;
    lastUpdated?: string;
    tcgplayerUrl?: string;
    tcgplayerProductId?: number;
  }>;
}

interface CardData {
  id: string;
  artStyle?: string;
  [key: string]: unknown;
}

interface SetData {
  id: string;
  cards: CardData[];
  [key: string]: unknown;
}

interface CardsDatabase {
  lastUpdated: string;
  sets: SetData[];
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const mappings: Record<string, CardMapping> = body.mappings || {};
    const artStyleChanges: Record<string, string> = body.artStyleChanges || {};

    if (Object.keys(mappings).length === 0 && Object.keys(artStyleChanges).length === 0) {
      return NextResponse.json({ error: 'No changes provided' }, { status: 400 });
    }

    // Read existing prices.json
    const pricesPath = path.join(process.cwd(), 'data', 'prices.json');
    const cardsPath = path.join(process.cwd(), 'data', 'cards.json');

    let priceData: PriceData = {
      lastUpdated: new Date().toISOString(),
      prices: {},
    };

    if (fs.existsSync(pricesPath)) {
      const content = fs.readFileSync(pricesPath, 'utf-8');
      priceData = JSON.parse(content);
    }

    // Apply mappings
    let updated = 0;
    for (const [cardId, mapping] of Object.entries(mappings)) {
      // Initialize if doesn't exist
      if (!priceData.prices[cardId]) {
        priceData.prices[cardId] = {};
      }

      // Update with mapping data
      priceData.prices[cardId] = {
        ...priceData.prices[cardId],
        tcgplayerProductId: mapping.tcgProductId,
        tcgplayerUrl: mapping.tcgUrl,
        lastUpdated: new Date().toISOString(),
      };

      // If we have a price from the mapping, use it
      if (mapping.price !== undefined && mapping.price !== null) {
        priceData.prices[cardId].marketPrice = mapping.price;
      }

      updated++;
    }

    // Update the lastUpdated timestamp
    priceData.lastUpdated = new Date().toISOString();

    // Write back to prices.json
    fs.writeFileSync(pricesPath, JSON.stringify(priceData, null, 2));

    // Apply artStyle changes to cards.json
    let artStyleUpdated = 0;
    if (Object.keys(artStyleChanges).length > 0 && fs.existsSync(cardsPath)) {
      const cardsContent = fs.readFileSync(cardsPath, 'utf-8');
      const cardsData: CardsDatabase = JSON.parse(cardsContent);

      for (const set of cardsData.sets) {
        for (const card of set.cards) {
          if (artStyleChanges[card.id]) {
            card.artStyle = artStyleChanges[card.id];
            artStyleUpdated++;
          }
        }
      }

      if (artStyleUpdated > 0) {
        cardsData.lastUpdated = new Date().toISOString();
        fs.writeFileSync(cardsPath, JSON.stringify(cardsData, null, 2));
      }
    }

    return NextResponse.json({
      success: true,
      updated,
      artStyleUpdated,
      message: `Applied ${updated} mappings to prices.json, ${artStyleUpdated} artStyle changes to cards.json`
    });
  } catch (error) {
    console.error('Error applying mappings:', error);
    return NextResponse.json({
      error: 'Failed to apply mappings',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
