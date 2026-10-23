import { encode } from 'uqr'
import { writeFileSync } from 'node:fs'
const url = process.argv[2], out = process.argv[3]
const q = encode(url, { ecc: 'M', border: 2 })
const n = q.size, s = 10
let d = ''
for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) if (q.data[y][x]) d += `M${x * s} ${y * s}h${s}v${s}h-${s}z`
writeFileSync(out, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n * s} ${n * s}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${d}" fill="#000"/></svg>`)
console.log('qr', n)
