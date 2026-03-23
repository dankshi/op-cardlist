'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { IntakeIssue, IntakeIssueType, IntakeResolutionStatus, IntakeResolutionType } from '@/types/database'

const ISSUE_TYPE_LABELS: Record<IntakeIssueType, string> = {
  wrong_card: 'Wrong Card',
  wrong_condition: 'Wrong Condition',
  missing_item: 'Missing Item',
  counterfeit: 'Counterfeit',
  damaged_in_transit: 'Damaged in Transit',
  wrong_quantity: 'Wrong Quantity',
  other: 'Other',
}

const RESOLUTION_TYPE_LABELS: Record<IntakeResolutionType, string> = {
  replacement_requested: 'Request Replacement',
  partial_refund: 'Partial Refund',
  full_refund: 'Full Refund',
  order_cancelled: 'Cancel Order',
  item_accepted: 'Accept Item',
  new_item_created: 'Create New Item',
  seller_contacted: 'Contact Seller',
}

const STATUS_FILTER_OPTIONS: { value: string; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'escalated', label: 'Escalated' },
  { value: 'resolved', label: 'Resolved' },
]

interface IssueWithRelations extends Omit<IntakeIssue, 'order' | 'order_item' | 'creator' | 'resolver'> {
  order?: { id: string; status: string; buyer?: { display_name: string }; seller?: { display_name: string } }
  order_item?: { id: string; card_name: string; condition: string; snapshot_photo_url: string | null }
  creator?: { display_name: string }
  resolver?: { display_name: string }
}

export default function IssuesDashboard() {
  const [issues, setIssues] = useState<IssueWithRelations[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('open')
  const [typeFilter, setTypeFilter] = useState('all')
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState<string | null>(null)
  const [resolutionData, setResolutionData] = useState<Record<string, { type: IntakeResolutionType; notes: string }>>({})
  const router = useRouter()
  const supabase = createClient()

  const fetchIssues = useCallback(async () => {
    const params = new URLSearchParams()
    if (statusFilter !== 'all') params.set('resolutionStatus', statusFilter)
    if (typeFilter !== 'all') params.set('issueType', typeFilter)
    params.set('limit', '50')

    const res = await fetch(`/api/admin/intake/issues?${params}`)
    if (res.status === 403) { router.push('/'); return }
    const data = await res.json()
    setIssues(data.issues || [])
  }, [statusFilter, typeFilter, router])

  useEffect(() => {
    async function init() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) { router.push('/auth/sign-in'); return }
      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single()
      if (!profile?.is_admin) { router.push('/'); return }
      await fetchIssues()
      setLoading(false)
    }
    init()
  }, [supabase, router, fetchIssues])

  useEffect(() => {
    if (!loading) fetchIssues()
  }, [statusFilter, typeFilter, fetchIssues, loading])

  const handleResolve = async (issueId: string, resolutionStatus: IntakeResolutionStatus) => {
    setActionLoading(issueId)
    const data = resolutionData[issueId]

    const res = await fetch(`/api/admin/intake/issues/${issueId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        resolutionStatus,
        resolutionType: data?.type || undefined,
        notes: data?.notes || undefined,
      }),
    })

    if (res.ok) {
      await fetchIssues()
      setExpandedIssue(null)
    } else {
      const result = await res.json()
      alert(result.error || 'Failed to update issue')
    }
    setActionLoading(null)
  }

  const getAgeBadge = (createdAt: string) => {
    const hours = Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60))
    if (hours < 1) return { text: '<1h', className: 'bg-green-100 text-green-600' }
    if (hours < 24) return { text: `${hours}h`, className: 'bg-yellow-100 text-yellow-600' }
    const days = Math.floor(hours / 24)
    return { text: `${days}d`, className: days > 3 ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600' }
  }

  if (loading) {
    return (
      <div className="py-20 text-center">
        <div className="w-8 h-8 border-2 border-orange-500 border-t-transparent rounded-full animate-spin mx-auto" />
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold text-zinc-900">Intake Issues</h1>
        <Link
          href="/admin/intake"
          className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 transition-colors"
        >
          Back to Scanner
        </Link>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex gap-1 bg-zinc-100 rounded-lg p-1">
          {STATUS_FILTER_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${
                statusFilter === opt.value
                  ? 'bg-white text-zinc-900 shadow-sm'
                  : 'text-zinc-500 hover:text-zinc-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border border-zinc-200 text-sm text-zinc-700 bg-white"
        >
          <option value="all">All Types</option>
          {Object.entries(ISSUE_TYPE_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      {/* Issues List */}
      {issues.length === 0 ? (
        <div className="text-center py-12 text-zinc-500">
          <p className="text-lg font-medium">No issues found</p>
          <p className="text-sm mt-1">
            {statusFilter === 'open' ? 'All clear — no open issues.' : 'Try adjusting filters.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {issues.map(issue => {
            const age = getAgeBadge(issue.created_at)
            const isExpanded = expandedIssue === issue.id

            return (
              <div key={issue.id} className="bg-white border border-zinc-200 rounded-lg overflow-hidden">
                <button
                  onClick={() => setExpandedIssue(isExpanded ? null : issue.id)}
                  className="w-full p-4 text-left cursor-pointer"
                >
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded ${age.className}`}>
                      {age.text}
                    </span>

                    <span className="text-xs font-medium px-2 py-0.5 rounded bg-red-100 text-red-600">
                      {ISSUE_TYPE_LABELS[issue.issue_type]}
                    </span>

                    <span className={`text-xs px-2 py-0.5 rounded ${
                      issue.resolution_status === 'open' ? 'bg-red-50 text-red-500' :
                      issue.resolution_status === 'resolved' ? 'bg-green-50 text-green-500' :
                      issue.resolution_status === 'escalated' ? 'bg-purple-50 text-purple-500' :
                      'bg-yellow-50 text-yellow-500'
                    }`}>
                      {issue.resolution_status}
                    </span>

                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-zinc-900 truncate block">{issue.description}</span>
                    </div>

                    <Link
                      href={`/orders/${issue.order_id}`}
                      onClick={e => e.stopPropagation()}
                      className="text-xs text-orange-500 hover:text-orange-600 font-medium"
                    >
                      #{issue.order_id.slice(0, 8)}
                    </Link>

                    <svg className={`w-4 h-4 text-zinc-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </button>

                {isExpanded && (
                  <div className="px-4 pb-4 border-t border-zinc-100 pt-4">
                    <div className="grid grid-cols-2 gap-4 mb-4 text-sm">
                      <div>
                        <p className="text-zinc-500">Order</p>
                        <p className="font-medium text-zinc-900">#{issue.order_id.slice(0, 8)}</p>
                        {issue.order && (
                          <p className="text-xs text-zinc-400">
                            Seller: {issue.order.seller?.display_name} &middot; Buyer: {issue.order.buyer?.display_name}
                          </p>
                        )}
                      </div>
                      <div>
                        <p className="text-zinc-500">Item</p>
                        <p className="font-medium text-zinc-900">{issue.order_item?.card_name || 'N/A (missing item)'}</p>
                      </div>
                      {issue.expected_card_name && (
                        <>
                          <div>
                            <p className="text-zinc-500">Expected</p>
                            <p className="font-medium text-zinc-900">{issue.expected_card_name}</p>
                          </div>
                          <div>
                            <p className="text-zinc-500">Received</p>
                            <p className="font-medium text-zinc-900">{issue.received_card_name || '—'}</p>
                          </div>
                        </>
                      )}
                      <div>
                        <p className="text-zinc-500">Flagged by</p>
                        <p className="font-medium text-zinc-900">{issue.creator?.display_name || 'Unknown'}</p>
                        <p className="text-xs text-zinc-400">{new Date(issue.created_at).toLocaleString()}</p>
                      </div>
                      {issue.resolved_at && (
                        <div>
                          <p className="text-zinc-500">Resolved by</p>
                          <p className="font-medium text-zinc-900">{issue.resolver?.display_name || 'Unknown'}</p>
                          <p className="text-xs text-zinc-400">{new Date(issue.resolved_at).toLocaleString()}</p>
                        </div>
                      )}
                    </div>

                    {issue.resolution_notes && (
                      <div className="bg-zinc-50 rounded-lg p-3 mb-4 text-sm text-zinc-600">
                        <p className="text-xs font-medium text-zinc-500 mb-1">Resolution Notes</p>
                        {issue.resolution_notes}
                      </div>
                    )}

                    {issue.resolution_status !== 'resolved' && (
                      <div className="border-t border-zinc-100 pt-4">
                        <div className="grid grid-cols-2 gap-3 mb-3">
                          <div>
                            <label className="block text-xs font-medium text-zinc-500 mb-1">Resolution Type</label>
                            <select
                              value={resolutionData[issue.id]?.type || ''}
                              onChange={e => setResolutionData(prev => ({
                                ...prev,
                                [issue.id]: { ...prev[issue.id], type: e.target.value as IntakeResolutionType, notes: prev[issue.id]?.notes || '' },
                              }))}
                              className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm text-zinc-700 bg-white"
                            >
                              <option value="">Select resolution...</option>
                              {Object.entries(RESOLUTION_TYPE_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>{label}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-xs font-medium text-zinc-500 mb-1">Notes</label>
                            <input
                              type="text"
                              value={resolutionData[issue.id]?.notes || ''}
                              onChange={e => setResolutionData(prev => ({
                                ...prev,
                                [issue.id]: { ...prev[issue.id], type: prev[issue.id]?.type || 'item_accepted' as IntakeResolutionType, notes: e.target.value },
                              }))}
                              placeholder="Resolution details..."
                              className="w-full px-3 py-2 rounded-lg border border-zinc-200 text-sm text-zinc-700 placeholder-zinc-400"
                            />
                          </div>
                        </div>

                        <div className="flex gap-2">
                          <button
                            onClick={() => handleResolve(issue.id, 'in_progress')}
                            disabled={actionLoading === issue.id}
                            className="px-3 py-1.5 bg-yellow-500 text-white text-xs font-semibold rounded-lg hover:bg-yellow-600 transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            Mark In Progress
                          </button>
                          <button
                            onClick={() => handleResolve(issue.id, 'escalated')}
                            disabled={actionLoading === issue.id}
                            className="px-3 py-1.5 bg-purple-500 text-white text-xs font-semibold rounded-lg hover:bg-purple-600 transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            Escalate
                          </button>
                          <button
                            onClick={() => handleResolve(issue.id, 'resolved')}
                            disabled={actionLoading === issue.id || !resolutionData[issue.id]?.type}
                            className="px-3 py-1.5 bg-green-500 text-white text-xs font-semibold rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 cursor-pointer"
                          >
                            Resolve
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
