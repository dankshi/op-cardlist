const data = require('../data/cards.json');
const priceData = require('../data/prices.json');
const prices = priceData.prices;

// Approximate current box market prices (early 2026 estimates)
// USER SHOULD VERIFY WITH LIVE TCGPLAYER DATA
const boxPrices = {
  'op-03': 130,
  'op-04': 160,
  'op-05': 200,
  'op-06': 150,
  'op-07': 135,
  'op-08': 140,
  'op-09': 280,
  'op-10': 100,
  'op-11': 160,
  'op-12': 140,
  'op-13': 165,
  'op14-eb04': 110,
  'eb-03': 85,
};

console.log('========================================================================');
console.log('  CASE PULL STRATEGY - EXPECTED VALUE ANALYSIS');
console.log('  Strategy: Buy case -> pull until 2 SPs -> sell remaining boxes sealed');
console.log('========================================================================');
console.log('');
console.log('Key assumptions:');
console.log('  - 1 case = 12 boxes');
console.log('  - 2 SPs guaranteed per case (+ possible manga rare)');
console.log('  - SPs distributed randomly across 12 boxes');
console.log('  - Case price = 12 x box price x 0.90 (10% case/distributor discount)');
console.log('  - Box prices are ESTIMATES - verify with live TCGPlayer data!');
console.log('  - Prices as of: ' + priceData.lastUpdated);
console.log('');

const results = [];

for (const set of data.sets) {
  const spCards = set.cards.filter(c => c.rarity === 'SP');
  if (spCards.length === 0) continue;

  const setId = set.id;
  const boxPrice = boxPrices[setId];
  if (!boxPrice) continue;

  // Get SP prices
  const spPriced = spCards.map(c => {
    const p = prices[c.id];
    return { id: c.id, name: c.name, market: p ? p.marketPrice : 0 };
  }).filter(s => s.market > 0);

  if (spPriced.length === 0) continue;

  const avgSP = spPriced.reduce((s, c) => s + c.market, 0) / spPriced.length;
  const minSP = Math.min(...spPriced.map(c => c.market));
  const maxSP = Math.max(...spPriced.map(c => c.market));

  // Calculate per-box EV (non-SP cards only)
  const pullRates = { C: 144, UC: 72, R: 24, SR: 8, SEC: 1 };
  let boxEV = 0;

  for (const [rarity, pullsPerBox] of Object.entries(pullRates)) {
    const rarityCards = set.cards.filter(c => c.rarity === rarity && !c.isParallel);
    const pricedRarity = rarityCards.filter(c => prices[c.id] && prices[c.id].marketPrice > 0);
    if (pricedRarity.length === 0) continue;
    const totalVal = pricedRarity.reduce((s, c) => s + prices[c.id].marketPrice, 0);
    boxEV += (pullsPerBox / rarityCards.length) * totalVal;
  }

  // Parallel bonus (~3 per box)
  const parallels = set.cards.filter(c => c.isParallel && c.rarity !== 'SP' && prices[c.id] && prices[c.id].marketPrice > 0);
  if (parallels.length > 0) {
    const parallelAvg = parallels.reduce((s, c) => s + prices[c.id].marketPrice, 0) / parallels.length;
    boxEV += 3 * parallelAvg;
  }

  // Manga card check
  const mangaCards = set.cards.filter(c => c.artStyle === 'manga' && prices[c.id] && prices[c.id].marketPrice > 0);
  let mangaAvg = 0;
  if (mangaCards.length > 0) {
    mangaAvg = mangaCards.reduce((s, c) => s + prices[c.id].marketPrice, 0) / mangaCards.length;
  }

  // === SIMULATION ===
  // With 2 SPs randomly placed in 12 boxes, E[position of 2nd SP]:
  // P(2nd SP at position k) = (k-1) / C(12,2) for k=2..12
  let expectedBoxesOpened = 0;
  for (let k = 2; k <= 12; k++) {
    expectedBoxesOpened += k * (k - 1) / 66;
  }

  const boxesRemaining = 12 - expectedBoxesOpened;

  // Case cost
  const caseRetail = 12 * boxPrice;
  const caseCost = caseRetail * 0.90;

  // Revenue
  const sealedRevenue = boxesRemaining * boxPrice;
  const openedCardValue = expectedBoxesOpened * boxEV;
  const spRevenue = 2 * avgSP;
  const mangaRevenue = mangaAvg * 0.5;

  const totalRevenue = sealedRevenue + openedCardValue + spRevenue + mangaRevenue;
  const netProfit = totalRevenue - caseCost;
  const roi = (netProfit / caseCost) * 100;

  // Best case: 2 SPs in first 2 boxes, top 2 SP values
  const topTwoSP = spPriced.sort((a, b) => b.market - a.market).slice(0, 2).reduce((s, c) => s + c.market, 0);
  const bestCaseProfit = (10 * boxPrice) + (2 * boxEV) + topTwoSP - caseCost;

  // Worst case: SPs in box 11 and 12, bottom 2 SP values
  const bottomTwoSP = spPriced.sort((a, b) => a.market - b.market).slice(0, 2).reduce((s, c) => s + c.market, 0);
  const worstCaseProfit = (0 * boxPrice) + (12 * boxEV) + bottomTwoSP - caseCost;

  results.push({
    setId, setName: set.name, boxPrice, caseCost, caseRetail,
    spCount: spPriced.length, avgSP, minSP, maxSP, topTwoSP, bottomTwoSP,
    boxEV, expectedBoxesOpened, boxesRemaining,
    sealedRevenue, openedCardValue, spRevenue, mangaRevenue,
    totalRevenue, netProfit, roi, bestCaseProfit, worstCaseProfit
  });
}

// Sort by ROI
results.sort((a, b) => b.roi - a.roi);

for (const r of results) {
  const bar = '='.repeat(60);
  console.log(bar);
  console.log('  ' + r.setId.toUpperCase() + ' - ' + r.setName);
  console.log(bar);
  console.log('  Box market price:     ~$' + r.boxPrice);
  console.log('  Case cost (12 boxes): ~$' + r.caseCost.toFixed(0) + ' (with 10% case discount)');
  console.log('  Per-box EV (cards):   $' + r.boxEV.toFixed(2));
  console.log('');
  console.log('  SP Pool (' + r.spCount + ' cards):');
  console.log('    Avg: $' + r.avgSP.toFixed(2) + ' | Min: $' + r.minSP.toFixed(2) + ' | Max: $' + r.maxSP.toFixed(2));
  console.log('');
  console.log('  Expected boxes to open for 2 SPs: ' + r.expectedBoxesOpened.toFixed(1) + ' / 12');
  console.log('  Boxes left to sell sealed:         ' + r.boxesRemaining.toFixed(1));
  console.log('');
  console.log('  REVENUE BREAKDOWN:');
  console.log('    Sealed box sales:   $' + r.sealedRevenue.toFixed(0));
  console.log('    Opened card value:  $' + r.openedCardValue.toFixed(0));
  console.log('    2x SP cards:        $' + r.spRevenue.toFixed(0));
  if (r.mangaRevenue > 0) console.log('    Manga bonus:        $' + r.mangaRevenue.toFixed(0));
  console.log('    -------------------------');
  console.log('    Total revenue:      $' + r.totalRevenue.toFixed(0));
  console.log('    Case cost:         -$' + r.caseCost.toFixed(0));
  console.log('    =========================');
  const sign = r.netProfit >= 0 ? '+' : '';
  console.log('    NET PROFIT:         ' + sign + '$' + r.netProfit.toFixed(0) + '  (' + sign + r.roi.toFixed(1) + '% ROI)');
  console.log('');
  console.log('  SCENARIO RANGE:');
  console.log('    Best case  (SPs early + top hits):   ' + (r.bestCaseProfit >= 0 ? '+' : '') + '$' + r.bestCaseProfit.toFixed(0));
  console.log('    Worst case (SPs last + low hits):    ' + (r.worstCaseProfit >= 0 ? '+' : '') + '$' + r.worstCaseProfit.toFixed(0));
  const verdict = r.netProfit > 200 ? 'STRONG BUY' : r.netProfit > 0 ? 'MARGINAL' : 'AVOID';
  console.log('    Verdict: ' + verdict);
  console.log('');
}

console.log('================================================================');
console.log('  RANKING SUMMARY (sorted by expected ROI)');
console.log('================================================================');
for (const r of results) {
  const verdict = r.netProfit > 200 ? 'STRONG' : r.netProfit > 0 ? 'MARGIN' : 'AVOID ';
  const sign = r.roi >= 0 ? '+' : '';
  console.log('  [' + verdict + '] ' + r.setId.toUpperCase().padEnd(12) + ' | Net: ' + (r.netProfit >= 0 ? '+' : '') + '$' + r.netProfit.toFixed(0).padStart(6) + ' | ROI: ' + sign + r.roi.toFixed(1).padStart(6) + '% | Avg SP: $' + r.avgSP.toFixed(0).padStart(5));
}

console.log('');
console.log('================================================================');
console.log('  NOTES');
console.log('================================================================');
console.log('  - Box prices are ESTIMATES. Plug in real prices for accuracy.');
console.log('  - Card prices from: ' + priceData.lastUpdated);
console.log('  - Does NOT account for: TCGPlayer fees (~13%), shipping costs,');
console.log('    time to sell singles, price decay on opened singles.');
console.log('  - "Best case" assumes SPs land in boxes 1-2 AND you hit top SPs.');
console.log('  - "Worst case" assumes SPs in boxes 11-12 AND you hit bottom SPs.');
console.log('  - Selling fees eat ~13% of revenue. Subtract that from profit.');
console.log('  - The more SPs in a set pool, the more variance in your outcome.');
