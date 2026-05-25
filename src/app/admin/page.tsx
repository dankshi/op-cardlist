import { redirect } from 'next/navigation'

// Admin landing page → orders dashboard. The list moved to /admin/orders so
// the URL matches the nav label and leaves room for nested /admin/orders/[id].
export default function AdminPage() {
  redirect('/admin/orders')
}
