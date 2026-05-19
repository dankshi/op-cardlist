// set_id → Bandai cardlist series ID. Mirrors the SETS dict in
// scripts/scrape-bandai-cards.ts. Used to build deep-links into Bandai's
// official catalog (e.g. for the card-detail debug block + admin tools)
// so we can sanity-check our scraped fields against the source of truth.
export const BANDAI_SERIES_ID: Record<string, string> = {
  'op-01': '569101', 'op-02': '569102', 'op-03': '569103', 'op-04': '569104',
  'op-05': '569105', 'op-06': '569106', 'op-07': '569107', 'op-08': '569108',
  'op-09': '569109', 'op-10': '569110', 'op-11': '569111', 'op-12': '569112',
  'op-13': '569113',
  'op14-eb04': '569114', 'op15-eb04': '569115',
  'eb-01': '569201', 'eb-02': '569202', 'eb-03': '569203',
  'prb-01': '569301', 'prb-02': '569302',
  'promo': '569901', 'other-product': '569801',
}

/** Bandai's official cardlist URL with a fragment that jumps to the card
 *  row. Returns null when the set isn't in the series map. */
export function bandaiCardUrl(setId: string, cardId: string): string | null {
  const seriesId = BANDAI_SERIES_ID[setId]
  return seriesId
    ? `https://en.onepiece-cardgame.com/cardlist/?series=${seriesId}#${cardId}`
    : null
}
