import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import netlify from '@netlify/vite-plugin'

export default defineConfig({ plugins: [react(), ...(process.env.LOCAL_UI_PREVIEW === '1' ? [] : [netlify()])] })
