'use client';

import { useState } from 'react';
import type { Card } from '@/types/card';
import { SITE_URL } from '@/lib/seo';

interface ShareButtonsProps {
  card: Card;
}

export function ShareButtons({ card }: ShareButtonsProps) {
  const [copied, setCopied] = useState(false);

  const url = `${SITE_URL}/card/${card.id.toLowerCase()}`;
  const price = card.price?.marketPrice;
  const priceText = price != null
    ? price >= 1000
      ? `$${(price / 1000).toFixed(1)}k`
      : `$${price.toFixed(2)}`
    : null;

  const twitterText = priceText
    ? `Check out ${card.name} - currently at ${priceText}!`
    : `Check out this ${card.name} from ${card.setId.toUpperCase()}!`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  };

  const handleTwitterShare = () => {
    const twitterUrl = `https://twitter.com/intent/tweet?text=${encodeURIComponent(twitterText)}&url=${encodeURIComponent(url)}`;
    window.open(twitterUrl, '_blank', 'width=550,height=420');
  };

  const btnClass = "p-1.5 rounded-md text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100 transition-colors cursor-pointer";

  return (
    <div className="flex items-center gap-0.5">
      <button onClick={handleTwitterShare} className={btnClass} title="Share on X">
        <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
        </svg>
      </button>
      <button
        onClick={handleCopyLink}
        className={`p-1.5 rounded-md transition-colors cursor-pointer ${
          copied ? 'text-green-500' : 'text-zinc-400 hover:text-zinc-600 hover:bg-zinc-100'
        }`}
        title={copied ? 'Copied!' : 'Copy link'}
      >
        {copied ? (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        ) : (
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
          </svg>
        )}
      </button>
    </div>
  );
}
