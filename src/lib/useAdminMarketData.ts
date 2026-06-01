'use client'

import { makePersistentToggle } from './usePersistentToggle'

/** Returns whether the admin-only market-data drawer on /card/[id] (the
 *  Listings / Offers / Sales tables + the "View market data" link) should
 *  currently render, plus a setter that persists the preference.
 *
 *  Hidden behind an admin gate while the marketplace is still seeding —
 *  with few real listings the section looks empty, so we keep it
 *  admin-only for now and let admins toggle it from the profile dropdown.
 *  Hidden by default; admins opt in via the toggle and the choice sticks. */
export const useAdminMarketData = makePersistentToggle(
  'nomi:admin-market-data-visible',
  'nomi:admin-market-data-toggle',
)
