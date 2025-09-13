# EOXVault Zero - Ultra-Secure Mobile Password Manager PWA

A production-ready, mobile-first password manager Progressive Web App (PWA) with biometric authentication and military-grade encryption.

## 🔐 Features

- **Biometric Authentication**: WebAuthn support for Face ID/Touch ID
- **Military-Grade Encryption**: ChaCha20-Poly1305 with PBKDF2 key derivation
- **100% Offline**: All data stored locally in encrypted IndexedDB
- **Mobile-First Design**: Optimized for iPhone 16 Pro and iPad
- **PWA Support**: Install as native app on iOS/Android
- **Zero-Server Architecture**: No backend dependencies
- **Secure Export/Import**: Encrypted backup functionality

## 🚀 Quick Start

### Prerequisites

- [Bun](https://bun.sh/) v1.0.0 or higher
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) for Cloudflare deployment

### Installation

```bash
# Clone the repository
git clone [repository-url]
cd eoxvault-zero

# Install dependencies
bun install

# Start development server
bun run dev
```

Visit `http://localhost:3000` to see the app running.

### Building for Production

```bash
# Build the application
bun run build

# Preview production build
bun run preview
```

### Deployment to Cloudflare Pages

```bash
# Deploy to Cloudflare Pages
bun run deploy

# Or use the deployment script
./deploy.sh
```

Your app will be available at: `https://eoxvault-zero.pages.dev`

## 📱 Installation on Mobile

### iOS (iPhone/iPad)

1. Open Safari and navigate to your app URL
2. Tap the Share button
3. Select "Add to Home Screen"
4. Name the app and tap "Add"

### Android

1. Open Chrome and navigate to your app URL
2. Tap the menu (three dots)
3. Select "Add to Home screen"
4. Confirm installation

## 🛡️ Security Features

- **Encryption**: ChaCha20-Poly1305 authenticated encryption
- **Key Derivation**: PBKDF2 with SHA-512 (210,000 iterations)
- **Biometric Lock**: WebAuthn with platform authenticator
- **Auto-Lock**: 15-minute session timeout
- **Secure Storage**: All data encrypted at rest in IndexedDB
- **Memory Protection**: Automatic key clearing on logout

## 🏗️ Architecture

```
eoxvault-zero/
├── src/
│   ├── components/        # UI components
│   ├── context/          # React context providers
│   ├── lib/              # Core libraries
│   │   ├── auth/         # Authentication service
│   │   ├── crypto/       # Encryption service
│   │   └── db/           # Database service
│   ├── pages/            # Application pages
│   └── styles/           # Global styles
├── public/               # Static assets
└── dist/                 # Build output
```

## 🔧 Technology Stack

- **Framework**: SolidJS (reactive UI)
- **Routing**: @solidjs/router
- **Database**: Dexie (IndexedDB wrapper)
- **Encryption**: @noble/ciphers, @noble/hashes
- **Authentication**: @simplewebauthn/browser
- **Styling**: UnoCSS (atomic CSS)
- **Build Tool**: Vite
- **PWA**: vite-plugin-pwa
- **Deployment**: Cloudflare Pages

## 📝 Environment Variables

No environment variables required! This is a zero-config, client-only application.

## 🧪 Testing

```bash
# Run type checking
bun run type-check

# Build and test
bun run build
```

## 🔄 Updating Dependencies

```bash
# Update all dependencies
bun update

# Rebuild after updates
bun run build
```

## 🐛 Troubleshooting

### Build Issues

If you encounter build errors:

```bash
# Clear cache and reinstall
rm -rf node_modules bun.lockb
bun install
bun run build
```

### PWA Not Installing

Ensure your app is served over HTTPS (automatic on Cloudflare Pages).

### WebAuthn Not Available

WebAuthn requires a secure context (HTTPS) and is not available in all browsers. The app will fall back to password authentication if WebAuthn is unavailable.

## 📄 License

MIT License - See LICENSE file for details

## 🤝 Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 🛡️ Security Notice

This application uses client-side encryption. While the encryption is strong, remember:
- Never share your master password
- Use a strong, unique password for the vault
- Regularly backup your encrypted data
- The app cannot recover lost passwords

## 📞 Support

For issues and questions, please open a GitHub issue.

---

Built with ❤️ for maximum security and privacy