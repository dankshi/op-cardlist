# Cloudflare R2 Image Backup

This project uses Cloudflare R2 to store backup copies of card images in case the official source goes down.

## Why R2?

- **Free egress** - No charges for bandwidth, regardless of traffic
- **S3-compatible API** - Easy integration with existing tools
- **Global CDN** - Fast delivery via Cloudflare's network
- **Generous free tier** - 10GB storage, 10M reads/month free

## Setup

### 1. Create R2 Bucket

1. Log into [Cloudflare Dashboard](https://dash.cloudflare.com)
2. Navigate to **R2 Object Storage** in the sidebar
3. Click **Create bucket**
4. Name it `op-cardlist` (or your preferred name)
5. Choose a location (Auto is fine)

### 2. Enable Public Access

1. Click into your bucket → **Settings** tab
2. Under **Public access**, either:
   - **R2.dev subdomain**: Enable for a quick public URL (e.g., `https://pub-xxx.r2.dev`)
   - **Custom domain**: Connect your own domain for a cleaner URL

### 3. Create API Token

1. Go to R2 overview → **Manage R2 API Tokens**
2. Click **Create API Token**
3. Configure:
   - **Token name**: `op-cardlist-backup`
   - **Permissions**: Object Read & Write
   - **Bucket scope**: Select your bucket (or all buckets)
4. Click **Create API Token**
5. **Save the credentials immediately** - they won't be shown again:
   - Access Key ID
   - Secret Access Key

### 4. Get Account ID

Your Account ID is visible in:
- The dashboard URL: `dash.cloudflare.com/<ACCOUNT_ID>/r2`
- The R2 overview page sidebar
- The S3 endpoint URL shown after creating the API token

### 5. Configure Environment Variables

Create a `.env` file in the project root:

```env
R2_ACCOUNT_ID=your_32_char_account_id
R2_ACCESS_KEY_ID=your_access_key_id
R2_SECRET_ACCESS_KEY=your_secret_access_key
R2_BUCKET_NAME=op-cardlist
R2_PUBLIC_URL=https://pub-xxxxx.r2.dev
```

## Usage

### Backup Images to R2

```bash
# Stream images directly to R2 (no local storage required)
npm run backup:images

# Force re-upload all images (skip existence check)
npm run backup:images -- --force

# Also update cards.json to use R2 URLs
npm run backup:images -- --update-json
```

### URL Structure

Images are stored with the following structure:
```
https://your-r2-url.r2.dev/cards/OP01-001.png
https://your-r2-url.r2.dev/cards/OP01-001_p1.png  (parallel art)
```

## Next.js Configuration

After setting up R2, update `next.config.ts` to allow images from your R2 domain:

```typescript
images: {
  remotePatterns: [
    // ... existing patterns
    {
      protocol: "https",
      hostname: "pub-xxxxx.r2.dev",  // Your R2 public URL
      pathname: "/cards/**",
    },
  ],
}
```

## Switching to R2 Images

To switch the app to use R2 images instead of the official source:

1. Run the backup with `--update-json`:
   ```bash
   npm run backup:images -- --update-json
   ```

2. This updates all `imageUrl` fields in `data/cards.json` to point to R2

3. Update `next.config.ts` with your R2 domain (see above)

## Cost Estimate

For ~2000 card images (~100MB total):

| Resource | Free Tier | Our Usage | Cost |
|----------|-----------|-----------|------|
| Storage | 10 GB/month | ~100 MB | $0 |
| Class A ops (writes) | 1M/month | ~2,000 | $0 |
| Class B ops (reads) | 10M/month | Varies | $0 |
| Egress | Unlimited | Unlimited | $0 |

You'll stay well within the free tier unless the site gets massive traffic.

## Troubleshooting

### "Missing R2 credentials" error
- Ensure `.env` file exists in project root
- Check that all R2_* variables are set correctly

### "Access Denied" error
- Verify API token has read/write permissions
- Check bucket name matches exactly

### Images not loading on site
- Ensure public access is enabled on the bucket
- Check `next.config.ts` has the R2 domain in `remotePatterns`
- Verify the R2_PUBLIC_URL matches your actual public URL
