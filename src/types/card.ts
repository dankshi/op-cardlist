export type CardColor = 'Red' | 'Green' | 'Blue' | 'Purple' | 'Black' | 'Yellow';
export type CardType = 'LEADER' | 'CHARACTER' | 'EVENT' | 'STAGE';
export type Rarity = 'L' | 'SEC' | 'SR' | 'R' | 'UC' | 'C' | 'SP' | 'TR' | 'P';
export type Attribute = 'Strike' | 'Slash' | 'Special' | 'Wisdom' | 'Ranged';
export type ArtStyle = 'standard' | 'alternate' | 'wanted' | 'manga';

export interface CardPrice {
  marketPrice: number | null;
  lowPrice: number | null;
  midPrice: number | null;
  highPrice: number | null;
  lastUpdated: string | null;
  tcgplayerUrl: string | null;
  tcgplayerProductId: number | null;
}

export interface Card {
  id: string;              // e.g., "OP13-001" or "OP13-001_p1" for parallels
  baseId: string;          // e.g., "OP13-001" (without variant suffix)
  name: string;
  type: CardType;
  colors: CardColor[];
  rarity: Rarity;
  cost: number | null;     // null for leaders
  power: number | null;
  counter: number | null;
  life: number | null;     // only for leaders
  attribute: Attribute | null;
  traits: string[];        // e.g., ["Straw Hat Crew", "Supernovas"]
  effect: string;
  trigger: string | null;
  imageUrl: string;
  setId: string;           // e.g., "op-13"
  variant?: string;        // e.g., "p1", "p2" for parallel art
  isParallel: boolean;     // true for alternate art versions
  artStyle?: ArtStyle;     // 'standard', 'alternate', 'wanted', 'manga'
  price?: CardPrice;       // TCGPlayer price data
}

export interface CardSet {
  id: string;              // e.g., "op-13"
  name: string;            // e.g., "OP-13 Booster Pack"
  seriesId: string;        // e.g., "569113" (from URL)
  releaseDate: string;     // ISO date
  cardCount: number;
  cards: Card[];
}

export interface CardDatabase {
  sets: CardSet[];
  lastUpdated: string;
}

export interface SetImageData {
  setId: string;
  setName: string;
  boosterBoxImageUrl: string | null;
  tcgplayerUrl: string | null;
  tcgplayerProductId: number | null;
  lastUpdated: string;
}

export interface SetImagesDatabase {
  sets: Record<string, SetImageData>;
  lastUpdated: string;
}
