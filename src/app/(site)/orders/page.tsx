import { redirect } from 'next/navigation'

// The buyer-side orders list lives at /mystuff?tab=purchases now so the
// "what I bought" view sits next to "what I sold" under one roof. This
// route is preserved as a redirect so any old links / bookmarks still
// land somewhere sensible.
export default function OrdersPage() {
  redirect('/mystuff?tab=purchases')
}
