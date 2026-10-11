/**
 * A QR code as one SVG path: `size` modules a side (the white margin around it included), one 1×1 square per dark
 * module, rows down and columns across as the library gives them. Drawn black on white so any camera reads it.
 * The library is only loaded when a code is shown.
 */
export async function qrPath(text: string): Promise<{ size: number; d: string }> {
  const { encode } = await import('uqr')
  const q = encode(text, { ecc: 'M', border: 4 })
  let d = ''
  q.data.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += 'M' + x + ' ' + y + 'h1v1h-1z' }))
  return { size: q.size, d }
}

/** this app's own address: where another device has to go to open the same app (the demo or the one with a server) */
export const appUrl = () => location.origin + import.meta.env.BASE_URL
