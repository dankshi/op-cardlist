import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { ProductDatabase } from '../src/types/card';

// R2 Configuration from environment variables
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'op-cardlist';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const CONCURRENCY = 5;

function createR2Client(): S3Client {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error(
      'Missing R2 credentials. Please set:\n' +
      '  R2_ACCOUNT_ID\n' +
      '  R2_ACCESS_KEY_ID\n' +
      '  R2_SECRET_ACCESS_KEY\n' +
      'Optional:\n' +
      '  R2_BUCKET_NAME (default: op-cardlist)\n' +
      '  R2_PUBLIC_URL'
    );
  }

  return new S3Client({
    region: 'auto',
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
  });
}

async function checkExists(client: S3Client, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
    }));
    return true;
  } catch {
    return false;
  }
}

function getContentType(filename: string): string {
  if (filename.endsWith('.webp')) return 'image/webp';
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg';
  if (filename.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

function getR2Key(sourceUrl: string, category: string, productId: string): string {
  // Extract just the filename from the URL
  const url = new URL(sourceUrl);
  const filename = path.basename(url.pathname);
  return `products/${category}/${productId}/${filename}`;
}

async function streamToR2(
  client: S3Client,
  sourceUrl: string,
  key: string,
  skipExisting: boolean
): Promise<{ success: boolean; skipped: boolean }> {
  try {
    if (skipExisting && await checkExists(client, key)) {
      return { success: true, skipped: true };
    }

    const response = await fetch(sourceUrl);
    if (!response.ok) {
      console.error(`\nFailed to download ${sourceUrl}: ${response.status}`);
      return { success: false, skipped: false };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = key.split('/').pop() || '';

    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: getContentType(filename),
      CacheControl: 'public, max-age=31536000', // 1 year cache
    }));

    return { success: true, skipped: false };
  } catch (error) {
    console.error(`\nError processing ${key}:`, error);
    return { success: false, skipped: false };
  }
}

async function processInBatches<T, R>(
  items: T[],
  batchSize: number,
  processor: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(processor));
    results.push(...batchResults);

    const completed = Math.min(i + batchSize, items.length);
    process.stdout.write(`\r  Progress: ${completed}/${items.length}`);
  }

  console.log();
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const skipExisting = !args.includes('--force');
  const thumbnailsOnly = args.includes('--thumbnails-only');
  const categoryFilter = args.find(a => a.startsWith('--category='))?.split('=')[1];

  console.log('One Piece Product Image Backup Tool');
  console.log('====================================');
  console.log('Mode: Direct stream to R2\n');

  // Load products database
  const dataPath = path.join(process.cwd(), 'data', 'products.json');
  if (!fs.existsSync(dataPath)) {
    console.error('Error: data/products.json not found. Run "npm run scrape:products" first.');
    process.exit(1);
  }

  const database: ProductDatabase = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  // Collect all images to upload
  const imageUrls = new Map<string, string>(); // R2 key -> source URL

  for (const product of database.products) {
    if (categoryFilter && product.category !== categoryFilter) continue;

    // Always include thumbnail
    if (product.thumbnailUrl) {
      const key = getR2Key(product.thumbnailUrl, product.category, product.id);
      imageUrls.set(key, product.thumbnailUrl);
    }

    if (!thumbnailsOnly) {
      // Detail page images
      for (const imgUrl of product.detailImages) {
        const key = getR2Key(imgUrl, product.category, product.id);
        imageUrls.set(key, imgUrl);
      }

      // Card preview images
      for (const imgUrl of product.cardImages) {
        const key = getR2Key(imgUrl, product.category, product.id);
        imageUrls.set(key, imgUrl);
      }
    }
  }

  console.log(`Found ${imageUrls.size} images to process`);
  if (thumbnailsOnly) console.log('(Thumbnails only mode)');
  if (categoryFilter) console.log(`(Filtered to category: ${categoryFilter})`);
  if (skipExisting) console.log('(Skipping images that already exist in R2)');
  console.log();

  const client = createR2Client();
  const items = Array.from(imageUrls.entries()).map(([key, url]) => ({ key, url }));

  const results = await processInBatches(items, CONCURRENCY, async (item) => {
    const result = await streamToR2(client, item.url, item.key, skipExisting);
    return { ...item, ...result };
  });

  const uploaded = results.filter(r => r.success && !r.skipped).length;
  const skipped = results.filter(r => r.skipped).length;
  const failed = results.filter(r => !r.success).length;

  console.log(`\nResults:`);
  console.log(`  Uploaded: ${uploaded}`);
  console.log(`  Skipped (already exists): ${skipped}`);
  console.log(`  Failed: ${failed}`);

  if (failed > 0) {
    console.log('\nFailed images:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  ${r.key}`);
    });
  }

  if (R2_PUBLIC_URL) {
    console.log(`\nImages available at: ${R2_PUBLIC_URL}/products/{category}/{product-id}/filename`);
    console.log(`Example: ${R2_PUBLIC_URL}/products/boosters/op13/img_thumbnail.png`);
  }

  console.log('\nDone!');
}

main().catch(console.error);
