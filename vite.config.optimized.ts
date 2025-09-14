// Optimized Vite Configuration with Enhanced Chunking Strategy
// Non-breaking enhancement to existing build configuration
// Reduces bundle sizes and improves caching

import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';
import UnoCSS from 'unocss/vite';
import path from 'path';

export default defineConfig({
  plugins: [
    solid(),
    UnoCSS(),
    
    // PWA Configuration (preserved from original)
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.ico', 'robots.txt'],
      manifest: {
        name: 'VuVault Zero',
        short_name: 'VuVault',
        description: 'Zero-knowledge password manager with advanced encryption',
        theme_color: '#000000',
        background_color: '#000000',
        display: 'standalone',
        orientation: 'portrait',
        categories: ['security', 'utilities'],
        icons: [
          {
            src: '/icon-192.svg',
            sizes: '192x192',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          },
          {
            src: '/icon-512.svg',
            sizes: '512x512',
            type: 'image/svg+xml',
            purpose: 'any maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}'],
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  
  build: {
    // Target modern browsers for smaller bundles
    target: 'esnext',
    
    // Use terser for better minification
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.log in production
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug'],
        passes: 2 // Multiple passes for better compression
      },
      mangle: {
        safari10: true // Fix Safari 10 issues
      },
      format: {
        comments: false // Remove all comments
      }
    },
    
    // Source maps only for errors
    sourcemap: 'hidden',
    
    // Increase chunk size warning limit
    chunkSizeWarningLimit: 500,
    
    // Enhanced rollup options
    rollupOptions: {
      output: {
        // Manual chunks for better caching and parallel loading
        manualChunks: (id) => {
          // Node modules chunking
          if (id.includes('node_modules')) {
            // Critical crypto libraries in separate chunk
            if (id.includes('@noble/ciphers') || id.includes('@noble/hashes')) {
              return 'crypto-noble';
            }
            
            // Argon2 in its own chunk (loaded on demand)
            if (id.includes('argon2')) {
              return 'crypto-argon2';
            }
            
            // WebAuthn libraries
            if (id.includes('@simplewebauthn')) {
              return 'auth-webauthn';
            }
            
            // SolidJS framework core
            if (id.includes('solid-js/web')) {
              return 'framework-web';
            }
            if (id.includes('solid-js/store')) {
              return 'framework-store';
            }
            if (id.includes('solid-js')) {
              return 'framework-core';
            }
            
            // Router
            if (id.includes('@solidjs/router')) {
              return 'router';
            }
            
            // Database
            if (id.includes('dexie')) {
              return 'database';
            }
            
            // UnoCSS runtime
            if (id.includes('@unocss') || id.includes('uno')) {
              return 'styles';
            }
            
            // PWA/Workbox
            if (id.includes('workbox') || id.includes('vite-plugin-pwa')) {
              return 'pwa';
            }
            
            // All other vendor code
            return 'vendor';
          }
          
          // Application code chunking
          if (id.includes('src/')) {
            // Enhanced services (lazy loaded)
            if (id.includes('enhanced-auth-service')) {
              return 'services-enhanced-auth';
            }
            if (id.includes('enhanced-crypto-service')) {
              return 'services-enhanced-crypto';
            }
            
            // Import system (lazy loaded)
            if (id.includes('import/')) {
              return 'import-system';
            }
            if (id.includes('ImportModal')) {
              return 'import-modal';
            }
            
            // Core services
            if (id.includes('lib/auth/')) {
              return 'services-auth';
            }
            if (id.includes('lib/crypto/')) {
              return 'services-crypto';
            }
            if (id.includes('lib/db/')) {
              return 'services-db';
            }
            
            // Components
            if (id.includes('components/')) {
              // Heavy components in separate chunks
              if (id.includes('AddPasswordModal')) {
                return 'modal-password';
              }
              if (id.includes('OnboardingFlow')) {
                return 'modal-onboarding';
              }
              // Other components
              return 'components';
            }
            
            // Context providers
            if (id.includes('context/')) {
              return 'context';
            }
            
            // Workers
            if (id.includes('workers/')) {
              return 'workers';
            }
          }
        },
        
        // Optimize chunk names for caching
        chunkFileNames: 'assets/[name]-[hash].js',
        
        // Asset file naming for better caching
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name.split('.');
          const ext = info[info.length - 1];
          
          // CSS
          if (ext === 'css') {
            return 'assets/[name]-[hash][extname]';
          }
          
          // Default
          return 'assets/[name]-[hash][extname]';
        },
        
        // Entry chunk name
        entryFileNames: 'assets/[name]-[hash].js'
      }
    },
    
    // Report compressed size
    reportCompressedSize: false
  },
  
  // Optimize dependency pre-bundling
  optimizeDeps: {
    include: [
      'solid-js',
      'solid-js/web',
      'solid-js/store',
      '@solidjs/router',
      'dexie',
      '@metamask/browser-passworder',
      '@noble/hashes/sha3',
      '@noble/hashes/sha256',
      '@noble/hashes/sha512',
      '@noble/hashes/utils'
    ],
    exclude: [
      'argon2-browser'
    ],
    esbuildOptions: {
      target: 'esnext',
      define: {
        global: 'globalThis'
      }
    }
  },
  
  // Development server (preserved from original)
  server: {
    port: 3005,
    host: true,
    strictPort: true,
    cors: true
  },
  
  // Preview server
  preview: {
    port: 3006,
    host: true,
    strictPort: true
  },
  
  // Resolve configuration
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@components': path.resolve(__dirname, './src/components'),
      '@lib': path.resolve(__dirname, './src/lib'),
      '@pages': path.resolve(__dirname, './src/pages'),
      '@context': path.resolve(__dirname, './src/context'),
      '@workers': path.resolve(__dirname, './src/workers'),
      // Fix for @noble/hashes dynamic imports
      '@noble/hashes/sha3': path.resolve(__dirname, 'node_modules/@noble/hashes/sha3.js'),
      '@noble/hashes/sha256': path.resolve(__dirname, 'node_modules/@noble/hashes/sha256.js'),
      '@noble/hashes/sha512': path.resolve(__dirname, 'node_modules/@noble/hashes/sha512.js')
    }
  },
  
  // Define global for CommonJS compatibility
  define: {
    global: 'globalThis',
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV || 'production')
  }
});