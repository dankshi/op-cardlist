import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import type { CardDatabase } from '../src/types/card';

// R2 Configuration from environment variables
const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID!;
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID!;
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY!;
const R2_BUCKET_NAME = process.env.R2_BUCKET_NAME || 'op-cardlist';
const R2_PUBLIC_URL = process.env.R2_PUBLIC_URL;

const CONCURRENCY = 5; // Number of parallel uploads

// Initialize S3 client for R2
function createR2Client(): S3Client {
  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    throw new Error(
      'Missing R2 credentials. Please set:\n' +
      '  R2_ACCOUNT_ID\n' +
      '  R2_ACCESS_KEY_ID\n' +
      '  R2_SECRET_ACCESS_KEY\n' +
      'Optional:\n' +
      '  R2_BUCKET_NAME (default: op-cardlist)\n' +
      '  R2_PUBLIC_URL (for updating card URLs)'
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

// Download from source and upload directly to R2 (no local storage)
async function streamToR2(
  client: S3Client,
  sourceUrl: string,
  key: string,
  skipExisting: boolean
): Promise<{ success: boolean; skipped: boolean }> {
  try {
    // Check if already exists in R2
    if (skipExisting && await checkExists(client, key)) {
      return { success: true, skipped: true };
    }

    // Download image into memory
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      console.error(`\nFailed to download ${sourceUrl}: ${response.status}`);
      return { success: false, skipped: false };
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Upload directly to R2
    await client.send(new PutObjectCommand({
      Bucket: R2_BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: 'image/png',
      CacheControl: 'public, max-age=31536000', // 1 year cache
    }));

    return { success: true, skipped: false };
  } catch (error) {
    console.error(`\nError processing ${key}:`, error);
    return { success: false, skipped: false };
  }
}

function getImageKey(imageUrl: string): string {
  // Extract card ID from URL: https://...card/OP01-001.png?... -> cards/OP01-001.png
  const match = imageUrl.match(/card\/([^?]+)/);
  if (match) {
    return `cards/${match[1]}`;
  }
  // Fallback: use filename
  const url = new URL(imageUrl);
  return `cards/${path.basename(url.pathname)}`;
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

    // Progress update
    const completed = Math.min(i + batchSize, items.length);
    process.stdout.write(`\r  Progress: ${completed}/${items.length}`);
  }

  console.log(); // New line after progress
  return results;
}

async function main() {
  const args = process.argv.slice(2);
  const skipExisting = !args.includes('--force');
  const updateJson = args.includes('--update-json');

  console.log('One Piece Card Image Backup Tool');
  console.log('=================================');
  console.log('Mode: Direct stream to R2 (no local storage)\n');

  // Load card database
  const dataPath = path.join(process.cwd(), 'data', 'cards.json');
  if (!fs.existsSync(dataPath)) {
    console.error('Error: data/cards.json not found. Run "npm run scrape" first.');
    process.exit(1);
  }

  const database: CardDatabase = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

  // Collect all unique image URLs
  const imageUrls = new Map<string, string>(); // key -> url
  for (const set of database.sets) {
    for (const card of set.cards) {
      if (card.imageUrl) {
        const key = getImageKey(card.imageUrl);
        imageUrls.set(key, card.imageUrl);
      }
    }
  }

  console.log(`Found ${imageUrls.size} unique images across ${database.sets.length} sets\n`);

  // Stream images directly to R2
  console.log('Uploading images to Cloudflare R2...');
  if (skipExisting) {
    console.log('(Skipping images that already exist in R2)\n');
  }

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

  // Optionally update cards.json with new URLs
  if (updateJson && R2_PUBLIC_URL) {
    console.log('\nUpdating cards.json with R2 URLs...');

    for (const set of database.sets) {
      for (const card of set.cards) {
        if (card.imageUrl) {
          const key = getImageKey(card.imageUrl);
          card.imageUrl = `${R2_PUBLIC_URL}/${key}`;
        }
      }
    }

    database.lastUpdated = new Date().toISOString();
    fs.writeFileSync(dataPath, JSON.stringify(database, null, 2));
    console.log('Updated cards.json with new image URLs');
  }

  console.log('\nDone!');

  if (R2_PUBLIC_URL) {
    console.log(`\nImages available at: ${R2_PUBLIC_URL}/cards/[CARD_ID].png`);
    console.log('Example: ' + R2_PUBLIC_URL + '/cards/OP01-001.png');
  }
}

main().catch(console.error);
