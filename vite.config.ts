import path from 'path';
import { fileURLToPath } from 'url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa'; // Tambahkan ini

// Fix: Define __dirname for ESM environments as it is not globally available
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [
        react(),
        // Tambahkan konfigurasi PWA di bawah ini
        VitePWA({
          registerType: 'autoUpdate',
          includeAssets: ['favicon.ico', 'Bounty Segar Glossy Emblem.png'],
          manifest: {
            name: 'Dry Warehouse System BSI',
            short_name: 'DWH-BSI',
            description: 'Sistem Manajemen Gudang Bounty Segar Indonesia',
            theme_color: '#ef4444', // Warna merah UI kamu
            background_color: '#f8fafc',
            display: 'standalone',
            icons: [
              {
                src: 'Bounty Segar Glossy Emblem.png',
                sizes: '192x192',
                type: 'image/png'
              },
              {
                src: 'Bounty Segar Glossy Emblem.png',
                sizes: '512x512',
                type: 'image/png'
              },
              {
                src: 'Bounty Segar Glossy Emblem.png',
                sizes: '512x512',
                type: 'image/png',
                purpose: 'any maskable'
              }
            ]
          }
        })
      ],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          // Fix: path.resolve now uses the properly defined __dirname
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});