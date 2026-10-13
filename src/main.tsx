import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { keepStorage } from './supabase'
import { loadPdf } from './pdf'
import { loadZip } from './xlsx'
import { lang } from './i18n'
import './styles.css'

// the language the screens are in, for the browser (how it reads the page aloud, how it breaks the words)
document.documentElement.lang = lang

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

// who is signed in and what is waiting to go up are not to be cleared when the device runs short of space
keepStorage()

// What makes the report's PDF and Excel is big and only comes down when it is needed. It is brought in the background
// a moment after the app starts, once the offline copy is being kept: "Enviar reporte" then also works without WiFi.
const warm = () => { void loadPdf().catch(() => undefined); void loadZip().catch(() => undefined) }

// the app keeps opening without WiFi once it has been loaded once (see public/sw.js)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => { /* no offline copy on this browser */ })
    const go = () => setTimeout(warm, 2500)
    void navigator.serviceWorker.ready.then(() => {
      if (navigator.serviceWorker.controller) { go(); return }
      navigator.serviceWorker.addEventListener('controllerchange', go, { once: true })
      setTimeout(go, 8000)
    }).catch(go)
  })
} else setTimeout(warm, 2500)
