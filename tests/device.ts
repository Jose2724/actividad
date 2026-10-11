// One "device": the app's own store, sync queue and calculations, bundled for Node so tests/run.mjs can load it
// several times (each load is a separate tablet with its own memory).
export * from '../src/store'
export * from '../src/avance'
export * from '../src/outbox'
export { cellText, xDay, xDur, xTime, xlsxBytes } from '../src/xlsx'
