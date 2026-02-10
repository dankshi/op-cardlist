// Debug: find all TCGPlayer products for a card number
async function check() {
  await new Promise(r => setTimeout(r, 2000));
  const res = await fetch('https://mp-search-api.tcgplayer.com/v1/search/request?q=Kouzuki+Hiyori+OP06-106&isList=false', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' },
    body: JSON.stringify({
      algorithm: 'sales_exp_fields_boosted', from: 0, size: 20,
      filters: { term: { productLineName: ['one-piece-card-game'], productTypeName: ['Cards'] }, range: {}, match: {} },
      listingSearch: { filters: { term: {}, range: {}, exclude: { channelExclusion: 0 } } },
      context: { cart: {}, shippingCountry: 'US' },
      settings: { useFuzzySearch: true, didYouMean: {} }, sort: {}
    })
  });
  if (res.status !== 200) { console.log('HTTP', res.status); return; }
  const text = await res.text();
  if (text.startsWith('<')) { console.log('Rate limited'); return; }
  const data = JSON.parse(text);
  const products = data.results?.[0]?.results || [];
  console.log('Found', products.length, 'products');
  products.forEach(p => {
    console.log('ID:', p.productId, '| $' + p.marketPrice, '|', p.productName, '| Set:', p.setName);
  });

  // Also check pricepoints for product 539501
  console.log('\nPricepoints for 539501:');
  const res2 = await fetch('https://mpapi.tcgplayer.com/v2/product/539501/pricepoints', {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
  });
  const pp = await res2.json();
  console.log(JSON.stringify(pp, null, 2));
}
check().catch(console.error);
