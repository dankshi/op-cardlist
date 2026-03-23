import { Shippo } from 'shippo'
import type { AddressCreateRequest } from 'shippo/models/components'

let _shippo: Shippo | null = null

export function getShippo(): Shippo {
  if (!_shippo) {
    if (!process.env.SHIPPO_API_KEY) {
      throw new Error('SHIPPO_API_KEY is not set')
    }
    _shippo = new Shippo({ apiKeyHeader: process.env.SHIPPO_API_KEY })
  }
  return _shippo
}

export const PLATFORM_ADDRESS: AddressCreateRequest = {
  name: process.env.PLATFORM_SHIP_NAME || 'nomi market',
  street1: process.env.PLATFORM_SHIP_LINE1 || '',
  city: process.env.PLATFORM_SHIP_CITY || '',
  state: process.env.PLATFORM_SHIP_STATE || '',
  zip: process.env.PLATFORM_SHIP_ZIP || '',
  country: process.env.PLATFORM_SHIP_COUNTRY || 'US',
  email: process.env.PLATFORM_SHIP_EMAIL || '',
  phone: process.env.PLATFORM_SHIP_PHONE || '',
}

const DEFAULT_PARCEL = {
  length: '8',
  width: '6',
  height: '1',
  distanceUnit: 'in' as const,
  weight: '4',
  massUnit: 'oz' as const,
}

export interface ShippingRate {
  rateId: string
  carrier: string
  service: string
  estimatedCost: number
  estimatedDays: number
}

export async function getShippingRates(
  fromAddress: AddressCreateRequest,
  options?: { insuranceAmount?: number }
): Promise<ShippingRate[]> {
  const shippo = getShippo()

  const shipment = await shippo.shipments.create({
    addressFrom: fromAddress,
    addressTo: PLATFORM_ADDRESS,
    parcels: [DEFAULT_PARCEL],
    extra: options?.insuranceAmount
      ? {
          insurance: {
            amount: options.insuranceAmount.toFixed(2),
            content: 'Trading card',
            currency: 'USD',
          },
        }
      : undefined,
  })

  const ALLOWED_SERVICES = ['usps_ground_advantage', 'ups_ground_saver']

  const rates = (shipment.rates || [])
    .filter(r => r.amount !== undefined && r.objectId)
    .filter(r => r.servicelevel?.token && ALLOWED_SERVICES.includes(r.servicelevel.token))
    .sort((a, b) => Number(a.amount) - Number(b.amount))

  if (rates.length === 0) {
    throw new Error('No shipping rates available')
  }

  return rates.map(r => ({
    rateId: r.objectId!,
    carrier: r.provider || 'Unknown',
    service: r.servicelevel?.name || r.servicelevel?.token || 'Standard',
    estimatedCost: Number(r.amount),
    estimatedDays: r.estimatedDays || 3,
  }))
}

export async function createShippingLabel(rateId: string) {
  const shippo = getShippo()

  const transaction = await shippo.transactions.create({
    rate: rateId,
    labelFileType: 'PDF',
    async: false,
  })

  if (transaction.status !== 'SUCCESS' || !transaction.labelUrl) {
    throw new Error(transaction.messages?.map(m => m.text).join(', ') || 'Label creation failed')
  }

  const rate = typeof transaction.rate === 'object' ? transaction.rate : null
  return {
    labelUrl: transaction.labelUrl,
    trackingNumber: transaction.trackingNumber || '',
    carrier: rate?.provider || 'USPS',
    cost: Number(rate?.amount || 0),
  }
}

export async function createOutboundLabel(buyerAddress: AddressCreateRequest) {
  const shippo = getShippo()

  const shipment = await shippo.shipments.create({
    addressFrom: PLATFORM_ADDRESS,
    addressTo: buyerAddress,
    parcels: [DEFAULT_PARCEL],
  })

  const rates = shipment.rates || []
  const cheapest = rates
    .filter(r => r.amount !== undefined)
    .sort((a, b) => Number(a.amount) - Number(b.amount))[0]

  if (!cheapest?.objectId) {
    throw new Error('No shipping rates available for buyer address')
  }

  const transaction = await shippo.transactions.create({
    rate: cheapest.objectId,
    labelFileType: 'PDF',
    async: false,
  })

  if (transaction.status !== 'SUCCESS' || !transaction.labelUrl) {
    throw new Error(transaction.messages?.map(m => m.text).join(', ') || 'Outbound label creation failed')
  }

  const outRate = typeof transaction.rate === 'object' ? transaction.rate : null
  return {
    labelUrl: transaction.labelUrl,
    trackingNumber: transaction.trackingNumber || '',
    carrier: outRate?.provider || 'USPS',
    cost: Number(outRate?.amount || 0),
  }
}
