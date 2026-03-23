/**
 * Zebra BrowserPrint client utility
 *
 * Connects to a Zebra thermal label printer via the BrowserPrint agent
 * running on localhost. The agent must be installed on the workstation.
 *
 * Download: https://www.zebra.com/us/en/support-downloads/printer-software/by-request-software.html
 *
 * The agent exposes an HTTP API on port 9100 (default).
 * We send raw ZPL commands to print labels.
 */

const BROWSER_PRINT_URL = 'http://localhost:9100'

export type PrinterStatus = 'ready' | 'offline' | 'error'

interface ZebraDevice {
  name: string
  uid: string
  connection: string
  deviceType: string
}

/**
 * Check if the Zebra BrowserPrint agent is running and a printer is available
 */
export async function getPrinterStatus(): Promise<PrinterStatus> {
  try {
    const res = await fetch(`${BROWSER_PRINT_URL}/available`, {
      method: 'GET',
      headers: { 'Content-Type': 'text/plain' },
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return 'offline'
    const data = await res.json()
    if (data?.printer && data.printer.length > 0) return 'ready'
    return 'offline'
  } catch {
    return 'offline'
  }
}

/**
 * Get the default Zebra printer device info
 */
export async function getDefaultPrinter(): Promise<ZebraDevice | null> {
  try {
    const res = await fetch(`${BROWSER_PRINT_URL}/default?type=printer`, {
      method: 'GET',
      signal: AbortSignal.timeout(3000),
    })
    if (!res.ok) return null
    const device = await res.json()
    return device?.uid ? device : null
  } catch {
    return null
  }
}

/**
 * Send ZPL commands to the Zebra printer
 */
export async function printZpl(zpl: string): Promise<boolean> {
  try {
    const device = await getDefaultPrinter()
    if (!device) {
      console.error('No Zebra printer found')
      return false
    }

    const res = await fetch(`${BROWSER_PRINT_URL}/write`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({
        device: { uid: device.uid },
        data: zpl,
      }),
      signal: AbortSignal.timeout(10000),
    })

    return res.ok
  } catch (err) {
    console.error('Print error:', err)
    return false
  }
}

/**
 * Print a product QR label via our API + Zebra printer
 */
export async function printProductLabel(
  orderItemId: string,
  cardName: string,
  shortOrderId: string,
): Promise<{ success: boolean; zpl?: string; error?: string }> {
  const res = await fetch('/api/admin/intake/print-label', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'product',
      data: { orderItemId, cardName, shortOrderId },
    }),
  })

  if (!res.ok) {
    const data = await res.json()
    return { success: false, error: data.error }
  }

  const { zpl } = await res.json()
  const printed = await printZpl(zpl)
  return { success: printed, zpl }
}

/**
 * Print a triage QR label via our API + Zebra printer
 */
export async function printTriageLabel(
  type: 'triage_no_order' | 'triage_user_id',
  triagePackageId: string,
  extra?: { sellerName?: string; trackingNumber?: string },
): Promise<{ success: boolean; zpl?: string; error?: string }> {
  const res = await fetch('/api/admin/intake/print-label', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type,
      data: {
        triagePackageId,
        sellerName: extra?.sellerName,
        trackingNumber: extra?.trackingNumber,
      },
    }),
  })

  if (!res.ok) {
    const data = await res.json()
    return { success: false, error: data.error }
  }

  const { zpl } = await res.json()
  const printed = await printZpl(zpl)
  return { success: printed, zpl }
}
