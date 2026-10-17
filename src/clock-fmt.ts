export { clockNow } from './clock'
/** "9:41 AM" */
export const fmtTime = (ms: number) => new Date(ms).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
