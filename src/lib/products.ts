import type { Product, ProductCategory, ProductDatabase } from '@/types/card';

let productsData: ProductDatabase | null = null;
try {
  productsData = require('../../data/products.json');
} catch {
  // products.json doesn't exist yet, run "npm run scrape:products" first
}

export function getAllProducts(): Product[] {
  if (!productsData) return [];
  return productsData.products;
}

export function getProductsByCategory(category: ProductCategory): Product[] {
  return getAllProducts().filter(p => p.category === category);
}

export function getProductsLastUpdated(): string {
  return productsData?.lastUpdated ?? '';
}
