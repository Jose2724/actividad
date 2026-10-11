import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { keepStorage } from './supabase'
import './styles.css'

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)

// who is signed in and what is waiting to go up are not to be cleared when the device runs short of space
keepStorage()

// the app keeps opening without WiFi once it has been loaded once (see public/sw.js)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register(import.meta.env.BASE_URL + 'sw.js').catch(() => { /* no offline copy on this browser */ }) })
}
