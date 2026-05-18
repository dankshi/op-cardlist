import * as dotenv from 'dotenv';
import { S3Client, PutObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.local' });

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing Supabase env vars (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)');
  process.exit(1);
}
const supabase = createClient(supabaseUrl, supabaseServiceKey);

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
  // Flag renamed from --update-json (the JSON file is gone). The new flag
  // updates the cards table's image_url column to point at R2.
  const updateDb = args.includes('--update-db') || args.includes('--update-json');

  console.log('One Piece Card Image Backup Tool');
  console.log('=================================');
  console.log('Mode: Direct stream to R2 (no local storage)\n');

  // Load all card image URLs from the cards table (paginated to defeat
  // Supabase's 1000-row default cap).
  console.log('Loading card image URLs from DB...');
  const rows: { id: string; image_url: string | null }[] = [];
  const PAGE_SIZE = 1000;
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('cards')
      .select('id, image_url')
      .order('id')
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error('Error fetching cards:', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < PAGE_SIZE) break;
  }

  // Collect unique image URLs by R2 key.
  const imageUrls = new Map<string, string>(); // key -> source url
  const keyToCardIds = new Map<string, string[]>(); // key -> all card_ids using this image
  for (const row of rows) {
    if (!row.image_url) continue;
    const key = getImageKey(row.image_url);
    imageUrls.set(key, row.image_url);
    const ids = keyToCardIds.get(key);
    if (ids) ids.push(row.id); else keyToCardIds.set(key, [row.id]);
  }

  console.log(`Found ${imageUrls.size} unique images across ${rows.length} cards\n`);

  // Stream images directly to R2.
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

  // Optionally rewrite cards.image_url to point at R2. We do this in
  // chunked UPDATE-by-id batches since the supabase-js client doesn't
  // expose a clean bulk UPDATE; chunk size 200 keeps each request small.
  if (updateDb && R2_PUBLIC_URL) {
    console.log('\nUpdating cards.image_url to R2 URLs...');
    const updates: { id: string; image_url: string }[] = [];
    for (const [key, cardIds] of keyToCardIds) {
      const r2Url = `${R2_PUBLIC_URL}/${key}`;
      for (const id of cardIds) updates.push({ id, image_url: r2Url });
    }

    const CHUNK = 200;
    let written = 0;
    for (let i = 0; i < updates.length; i += CHUNK) {
      const chunk = updates.slice(i, i + CHUNK);
      // upsert on id; only updates image_url + bumps updated_at.
      const { error } = await supabase.from('cards').upsert(chunk, { onConflict: 'id' });
      if (error) {
        console.error(`  chunk ${i}: ${error.message}`);
        continue;
      }
      written += chunk.length;
    }
    console.log(`Updated ${written}/${updates.length} cards.image_url rows.`);
  }

  console.log('\nDone!');
  if (R2_PUBLIC_URL) {
    console.log(`\nImages available at: ${R2_PUBLIC_URL}/cards/[CARD_ID].png`);
    console.log('Example: ' + R2_PUBLIC_URL + '/cards/OP01-001.png');
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
