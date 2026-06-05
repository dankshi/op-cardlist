// Mapping of our set IDs to TCGPlayer set URL names
// TCGPlayer uses URL-friendly names like "a-fist-of-divine-speed" for OP11
// Shared between the scraper (scripts/scrape-prices.ts) and search APIs
export const SET_NAME_MAP: Record<string, string[]> = {
  'op-01': ['romance-dawn', 'romance-dawn-pre-release-cards'],
  'op-02': ['paramount-war', 'paramount-war-pre-release-cards'],
  'op-03': ['pillars-of-strength', 'pillars-of-strength-pre-release-cards'],
  'op-04': ['kingdoms-of-intrigue', 'kingdoms-of-intrigue-pre-release-cards'],
  'op-05': ['awakening-of-the-new-era', 'awakening-of-the-new-era-pre-release-cards', 'awakening-of-the-new-era-1st-anniversary-tournament-cards'],
  'op-06': ['wings-of-the-captain', 'wings-of-the-captain-pre-release-cards'],
  'op-07': ['500-years-in-the-future', '500-years-in-the-future-pre-release-cards'],
  'op-08': ['two-legends', 'two-legends-pre-release-cards'],
  'op-09': ['emperors-in-the-new-world', 'emperors-in-the-new-world-pre-release-cards', 'emperors-in-the-new-world-2nd-anniversary-tournament-cards'],
  'op-10': ['royal-blood', 'royal-blood-pre-release-cards'],
  'op-11': ['a-fist-of-divine-speed', 'a-fist-of-divine-speed-release-event-cards'],
  'op-12': ['legacy-of-the-master', 'legacy-of-the-master-release-event-cards'],
  'op-13': ['carrying-on-his-will', 'carrying-on-his-will-3rd-anniversary-tournament-cards'],
  // OP-16 slug is a best guess — CONFIRM via `npx tsx scripts/discover-tcg-sets.ts --report-only`
  // before running auto-map (TCGplayer had not indexed OP-16 at ingest time).
  'op-16': ['the-time-of-battle'],
  'eb-01': ['extra-booster-memorial-collection'],
  'eb-02': ['extra-booster-anime-25th-collection'],
  'eb-03': ['extra-booster-one-piece-heroines-edition'],
  'op14-eb04': ['extra-booster-the-azure-seas-seven', 'the-azure-seas-seven', 'the-azure-seas-seven-release-event-cards'],
  'op15-eb04': ['adventure-on-kamis-island'],
  'prb-01': ['premium-booster-the-best'],
  'prb-02': ['premium-booster-the-best-vol-2'],
  // Promo / other-product are catch-all categories on Bandai's side that
  // map to TCGplayer's "Promotion Cards" + "Demo Deck Cards" sets.
  'promo': ['one-piece-promotion-cards'],
  'other-product': ['one-piece-demo-deck-cards'],
};
