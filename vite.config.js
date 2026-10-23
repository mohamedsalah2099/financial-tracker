import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import jsonDb from './db-plugin.js'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), jsonDb({ file: 'data/db.json' })],
  server: {
    // Saving the database shouldn't trigger a page reload.
    watch: { ignored: ['**/data/db.json', '**/data/db.json.tmp'] },
  },
})
