import { requireAdmin } from '@/lib/auth'
import { AdminNav } from '@/components/admin/AdminNav'

// Admin is its own self-contained app — it does NOT live inside the
// storefront (site) chrome. This layout owns the full-height background
// and the top navigation, and gates the whole section on is_admin in one
// place (server-side) so individual pages don't have to.
export const dynamic = 'force-dynamic'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const { user, profile } = await requireAdmin()
  const adminName = profile?.display_name || profile?.username || 'Admin'
  const adminEmail = user.email || ''

  return (
    <div className="min-h-screen bg-slate-50">
      <AdminNav adminName={adminName} adminEmail={adminEmail} />
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">{children}</main>
    </div>
  )
}
