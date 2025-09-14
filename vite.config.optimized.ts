// Optimized Vite Configuration with Enhanced Chunking Strategy
// Non-breaking enhancement to existing build configuration
// Reduces bundle sizes and improves caching

import { defineConfig } from 'vite';
import solid from 'vite-plugin-solid';
import { VitePWA } from 'vite-plugin-pwa';
import UnoCSS from 'unocss/vite';
import compression from 'vite-plugin-compression2';
import { visualizer } from 'rollup-plugin-visualizer';
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
    }),
    
    // NEW: Brotli compression for smaller files
    compression({
      algorithm: 'brotliCompress',
      threshold: 100, // Only compress files > 100 bytes
      deleteOriginalAssets: false, // Keep originals for compatibility
      compressionOptions: { 
        level: 11 // Maximum compression
      },
      exclude: [/\.map$/, /\.LICENSE\.txt$/],
    }),
    
    // NEW: Bundle analyzer (only in build, not dev)
    ...(process.env.ANALYZE ? [visualizer({
      open: true,
      gzipSize: true,
      brotliSize: true,
      filename: 'dist/stats.html',
      template: 'treemap' // or 'sunburst', 'network'
    })] : [])
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
    
    // Optimize CSS
    cssMinify: 'lightningcss',
    cssCodeSplit: true,
    
    // Source maps only for errors
    sourcemap: 'hidden',
    
    // Increase chunk size warning limit (we'll optimize below)
    chunkSizeWarningLimit: 1000,
    
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
            
            // Motion/Animation
            if (id.includes('@motionone') || id.includes('motion')) {
              return 'animation';
            }
            
            // PWA/Workbox
            if (id.includes('workbox') || id.includes('vite-plugin-pwa')) {
              return 'pwa';
            }
            
            // All other vendor code
            return 'vendor-misc';
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
            if (id.includes('import/flexible-importer')) {
              return 'import-system';
            }
            if (id.includes('ImportModal')) {
              return 'import-ui';
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
            
            // Shared components
            if (id.includes('components/')) {
              // Heavy components in separate chunks
              if (id.includes('AddPasswordModal')) {
                return 'modal-password';
              }
              if (id.includes('OnboardingFlow')) {
                return 'modal-onboarding';
              }
              // Light components bundled together
              return 'components-shared';
            }
            
            // Pages (already code-split by router)
            if (id.includes('pages/')) {
              const pageName = id.split('/pages/')[1]?.split('.')[0]?.toLowerCase();
              if (pageName) {
                return `page-${pageName}`;
              }
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
        chunkFileNames: (chunkInfo) => {
          const facadeModuleId = chunkInfo.facadeModuleId ? 
            path.basename(chunkInfo.facadeModuleId, path.extname(chunkInfo.facadeModuleId)) : 
            'chunk';
          return `assets/${facadeModuleId}-[hash].js`;
        },
        
        // Asset file naming for better caching
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name.split('.');
          const ext = info[info.length - 1];
          
          // Images
          if (/png|jpe?g|svg|gif|tiff|bmp|ico/i.test(ext)) {
            return `assets/images/[name]-[hash][extname]`;
          }
          
          // Fonts
          if (/woff2?|ttf|otf|eot/i.test(ext)) {
            return `assets/fonts/[name]-[hash][extname]`;
          }
          
          // CSS
          if (ext === 'css') {
            return `assets/styles/[name]-[hash][extname]`;
          }
          
          // Default
          return `assets/[name]-[hash][extname]`;
        },
        
        // Entry chunk name
        entryFileNames: 'assets/[name]-[hash].js',
        
        // Optimize imports
        generatedCode: {
          preset: 'es2015',
          arrowFunctions: true,
          constBindings: true,
          objectShorthand: true
        },
        
        // Better tree shaking
        treeshake: {
          moduleSideEffects: false,
          propertyReadSideEffects: false,
          tryCatchDeoptimization: false
        }
      },
      
      // External dependencies (if using CDN)
      external: [],
      
      // Optimize dependency pre-bundling
      preserveEntrySignatures: 'strict'
    },
    
    // Report compressed size
    reportCompressedSize: true,
    
    // Consistent hashing for better caching
    modulePreload: {
      polyfill: true
    }
  },
  
  // Optimize dependency pre-bundling
  optimizeDeps: {
    include: [
      'solid-js',
      'solid-js/web',
      'solid-js/store',
      '@solidjs/router',
      'dexie'
    ],
    exclude: [
      '@noble/ciphers',
      '@noble/hashes',
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
      '@workers': path.resolve(__dirname, './src/workers')
    }
  },
  
  // Environment variables
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __VERSION__: JSON.stringify(process.env.npm_package_version || '2.0.0')
  }
});