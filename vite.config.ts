import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// served from https://jose2724.github.io/actividad/ (GitHub Pages, folder docs/)
export default defineConfig({ plugins: [react()], base: '/actividad/' })
