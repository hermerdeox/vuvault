# 🔐 **EOXVault Zero - Secure Password Sharing Feature Implementation**

## **CRITICAL CONTEXT**
You are implementing a **secure password sharing feature** for EOXVault Zero (VuVault), a **production-ready PWA password manager** currently in active use. This is a **zero-knowledge, offline-first application** with no backend server. Any implementation MUST maintain these core principles.

## **🚨 PRODUCTION CONSTRAINTS - DO NOT VIOLATE**
1. **NO BACKEND SERVER** - Application must remain 100% client-side
2. **ZERO-KNOWLEDGE** - Service must never access unencrypted data
3. **MAINTAIN EXISTING ARCHITECTURE** - Do not refactor core systems
4. **PRESERVE OFFLINE FUNCTIONALITY** - Core features must work offline
5. **NO BREAKING CHANGES** - Existing vault data must remain accessible

## **📋 IMPLEMENTATION REQUIREMENTS**

### **Core Sharing Mechanism**
Implement a **hybrid sharing approach** that maintains zero-knowledge principles:

```typescript
// Sharing Methods Priority Order (with fallbacks):
1. WebRTC Peer-to-Peer (for real-time, same network sharing)
   └── Fallback: Manual SDP exchange via QR/text
2. Encrypted URL Fragments (for async sharing via links)
   └── Fallback: Encrypted file export if URL too long
3. QR Code Exchange (for in-person secure transfer)
   └── Fallback: Chunked QR codes for large payloads
4. Encrypted File Export (for manual transfer)
   └── Fallback: Split files if size exceeds limits
```

### **Technical Implementation Stack**

#### **1. Crypto Implementation** (Use Existing Noble Libraries)
```typescript
// File: src/lib/crypto/sharing-crypto-service.ts

import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { x25519 } from '@noble/curves/ed25519';
import { randomBytes } from '@noble/hashes/utils';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';

class SharingCryptoService {
  // Maximum payload sizes for compatibility
  private readonly MAX_URL_FRAGMENT_SIZE = 2048; // Conservative for broad compatibility
  private readonly MAX_QR_PAYLOAD_SIZE = 2953; // QR code version 40 limit
  private readonly CHUNK_SIZE = 1024; // For chunked operations
  
  // Error recovery and retry logic
  private retryOperation<T>(
    operation: () => Promise<T>,
    maxRetries: number = 3,
    delay: number = 1000
  ): Promise<T> {
    return new Promise(async (resolve, reject) => {
      for (let i = 0; i < maxRetries; i++) {
        try {
          const result = await operation();
          resolve(result);
          return;
        } catch (error) {
          if (i === maxRetries - 1) {
            reject(error);
            return;
          }
          await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
        }
      }
    });
  }
  
  // Generate ephemeral keypair with validation
  generateShareKeypair(): { privateKey: Uint8Array; publicKey: Uint8Array } | null {
    try {
      const privateKey = x25519.utils.randomPrivateKey();
      const publicKey = x25519.getPublicKey(privateKey);
      
      // Validate keypair
      if (privateKey.length !== 32 || publicKey.length !== 32) {
        console.error('Invalid keypair generated');
        return null;
      }
      
      return { privateKey, publicKey };
    } catch (error) {
      console.error('Keypair generation failed:', error);
      return null;
    }
  }

  // Encrypt with size validation and chunking support
  async encryptForSharing(
    item: VaultItem,
    recipientPublicKey: Uint8Array,
    senderPrivateKey: Uint8Array,
    permissions: SharePermissions
  ): Promise<EncryptedSharePackage | null> {
    try {
      // Validate inputs
      if (!item || !recipientPublicKey || !senderPrivateKey) {
        throw new Error('Invalid input parameters');
      }
      
      // Size check before encryption
      const itemSize = new Blob([JSON.stringify(item)]).size;
      if (itemSize > 100 * 1024) { // 100KB limit per item
        throw new Error('Item too large for sharing');
      }
      
      // Generate shared secret via ECDH with validation
      const sharedSecret = x25519.getSharedSecret(senderPrivateKey, recipientPublicKey);
      if (!sharedSecret || sharedSecret.length === 0) {
        throw new Error('Failed to generate shared secret');
      }
      
      // Derive encryption key with error handling
      const salt = randomBytes(32);
      const encryptionKey = await this.retryOperation(async () => 
        pbkdf2(sha256, sharedSecret, salt, 100000, 32)
      );
      
      // Prepare share data with timestamp validation
      const now = Date.now();
      const shareData = {
        item: this.sanitizeItem(item), // Remove any sensitive metadata
        permissions: this.validatePermissions(permissions),
        sharedAt: now,
        expiresAt: permissions.expiresAt || now + (24 * 60 * 60 * 1000),
        version: '1.0.0', // For future compatibility
        checksum: await this.calculateChecksum(item)
      };
      
      // Encrypt with nonce and additional data
      const nonce = randomBytes(12);
      const cipher = chacha20poly1305(encryptionKey, nonce);
      
      const plaintext = new TextEncoder().encode(JSON.stringify(shareData));
      const encrypted = cipher.encrypt(plaintext);
      
      // Verify encryption succeeded
      if (!encrypted || encrypted.length === 0) {
        throw new Error('Encryption failed');
      }
      
      return {
        encrypted,
        nonce,
        salt,
        senderPublicKey: x25519.getPublicKey(senderPrivateKey),
        permissions,
        metadata: {
          size: encrypted.length,
          chunked: encrypted.length > this.MAX_URL_FRAGMENT_SIZE,
          version: '1.0.0'
        }
      };
    } catch (error) {
      console.error('Encryption failed:', error);
      return null;
    }
  }
  
  // Sanitize item to remove system metadata
  private sanitizeItem(item: VaultItem): VaultItem {
    const sanitized = { ...item };
    delete sanitized.lastAccessed;
    delete sanitized.accessCount;
    delete sanitized.syncStatus;
    return sanitized;
  }
  
  // Validate and normalize permissions
  private validatePermissions(permissions: SharePermissions): SharePermissions {
    return {
      canView: permissions.canView ?? true,
      canEdit: permissions.canEdit ?? false,
      canReshare: permissions.canReshare ?? false,
      expiresAt: permissions.expiresAt || Date.now() + (24 * 60 * 60 * 1000),
      accessCount: 0,
      maxAccessCount: permissions.maxAccessCount || 100
    };
  }
  
  // Calculate checksum for integrity verification
  private async calculateChecksum(item: VaultItem): Promise<string> {
    const data = new TextEncoder().encode(JSON.stringify(item));
    const hash = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hash))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
}
```

#### **2. Database Schema Extension with Migration Safety**
```typescript
// File: src/lib/db/database.ts (EXTEND, don't replace)

import Dexie, { Transaction } from 'dexie';

class VaultDatabase extends Dexie {
  // ... existing tables ...
  
  // NEW TABLES - Add these
  sharedItems!: Table<SharedItem, string>;
  shareInvitations!: Table<ShareInvitation, string>;
  trustedContacts!: Table<TrustedContact, string>;
  shareMigrationLog!: Table<MigrationLog, string>; // Track migration status

  constructor() {
    super('VaultDB');
    
    // Preserve existing version 1 schema exactly
    this.version(1).stores({
      vaultItems: '++id, userId, category, createdAt, updatedAt'
      // ... other existing stores ...
    });
    
    // Add version 2 with new tables and migration safety
    this.version(2).stores({
      // PRESERVE all existing stores exactly as they are
      vaultItems: '++id, userId, category, createdAt, updatedAt',
      
      // NEW STORES with indexes for performance
      sharedItems: '++id, itemId, sharedBy, sharedWith, createdAt, expiresAt, [sharedBy+sharedWith]',
      shareInvitations: '++id, token, itemId, createdAt, status, expiresAt',
      trustedContacts: '++id, name, publicKey, addedAt, trustLevel, fingerprint',
      shareMigrationLog: '++id, version, migratedAt, status'
    }).upgrade(async (trans: Transaction) => {
      // Safe migration with rollback capability
      try {
        // Check if migration already completed
        const existingMigration = await trans.table('shareMigrationLog')
          .where('version').equals('2.0.0').first();
        
        if (existingMigration?.status === 'completed') {
          console.log('Migration already completed');
          return;
        }
        
        // Log migration start
        await trans.table('shareMigrationLog').add({
          version: '2.0.0',
          migratedAt: Date.now(),
          status: 'in_progress'
        });
        
        // Verify existing data integrity
        const itemCount = await trans.table('vaultItems').count();
        console.log(`Migrating with ${itemCount} existing items`);
        
        // Update migration status
        await trans.table('shareMigrationLog')
          .where('version').equals('2.0.0')
          .modify({ status: 'completed' });
          
      } catch (error) {
        console.error('Migration failed:', error);
        // Log failure for debugging
        await trans.table('shareMigrationLog').add({
          version: '2.0.0',
          migratedAt: Date.now(),
          status: 'failed',
          error: error.message
        });
        throw error; // Trigger rollback
      }
    });
  }
  
  // Database health check
  async healthCheck(): Promise<boolean> {
    try {
      // Test basic operations
      await this.vaultItems.count();
      
      // Check if sharing tables exist (v2)
      if (this.verno >= 2) {
        await this.sharedItems.count();
        await this.shareInvitations.count();
      }
      
      return true;
    } catch (error) {
      console.error('Database health check failed:', error);
      return false;
    }
  }
  
  // Cleanup expired shares (run periodically)
  async cleanupExpiredShares(): Promise<void> {
    const now = Date.now();
    
    try {
      await this.transaction('rw', this.sharedItems, this.shareInvitations, async () => {
        // Remove expired shared items
        await this.sharedItems
          .where('expiresAt').below(now)
          .delete();
        
        // Remove expired invitations
        await this.shareInvitations
          .where('expiresAt').below(now)
          .delete();
      });
    } catch (error) {
      console.error('Cleanup failed:', error);
    }
  }
}

// Enhanced types with validation
interface SharedItem {
  id?: string;
  itemId: string;
  encryptedData: Uint8Array;
  encryptedKey: Uint8Array;
  sharedBy: string;
  sharedWith: string;
  permissions: SharePermissions;
  createdAt: number;
  expiresAt?: number;
  accessLog?: AccessLogEntry[]; // Track access for audit
  version: string; // For compatibility
}

interface AccessLogEntry {
  timestamp: number;
  action: 'view' | 'edit' | 'reshare';
  deviceId?: string;
}

interface SharePermissions {
  canView: boolean;
  canEdit: boolean;
  canReshare: boolean;
  expiresAt?: number;
  accessCount?: number;
  maxAccessCount?: number;
  requiresBiometric?: boolean; // Additional security
  ipRestrictions?: string[]; // Optional IP whitelist
}

interface MigrationLog {
  id?: string;
  version: string;
  migratedAt: number;
  status: 'in_progress' | 'completed' | 'failed';
  error?: string;
}
```

#### **3. Sharing Context with Error Boundaries**
```typescript
// File: src/context/SharingContext.tsx

import { createContext, useContext, JSX, ErrorBoundary } from 'solid-js';
import { createSignal, createEffect, onCleanup, batch } from 'solid-js';

interface SharingContextType {
  activeShares: () => SharedItem[];
  pendingInvitations: () => ShareInvitation[];
  shareItem: (itemId: string, method: ShareMethod) => Promise<ShareResult>;
  acceptShare: (token: string) => Promise<void>;
  revokeShare: (shareId: string) => Promise<void>;
  createShareLink: (itemId: string, permissions: SharePermissions) => Promise<string>;
  isSharing: () => boolean;
  shareError: () => string | null;
  clearError: () => void;
}

export const SharingProvider: Component<{ children: JSX.Element }> = (props) => {
  const [activeShares, setActiveShares] = createSignal<SharedItem[]>([]);
  const [pendingInvitations, setPendingInvitations] = createSignal<ShareInvitation[]>([]);
  const [isSharing, setIsSharing] = createSignal(false);
  const [shareError, setShareError] = createSignal<string | null>(null);
  
  // Initialize WebRTC peer connection pool with cleanup
  const peerConnections = new Map<string, RTCPeerConnection>();
  
  // Cleanup on unmount
  onCleanup(() => {
    peerConnections.forEach(pc => {
      pc.close();
    });
    peerConnections.clear();
  });
  
  // Browser compatibility check
  const checkCompatibility = (): boolean => {
    const required = [
      typeof RTCPeerConnection !== 'undefined',
      typeof crypto?.subtle !== 'undefined',
      typeof indexedDB !== 'undefined',
      typeof TextEncoder !== 'undefined'
    ];
    
    return required.every(check => check);
  };
  
  // Load shares with error recovery
  const loadShares = async () => {
    try {
      const shares = await db.sharedItems
        .where('sharedBy').equals(currentUser.id)
        .or('sharedWith').equals(currentUser.id)
        .toArray();
      
      batch(() => {
        setActiveShares(shares);
        setShareError(null);
      });
    } catch (error) {
      console.error('Failed to load shares:', error);
      setShareError('Failed to load shared items');
      
      // Attempt recovery
      setTimeout(() => loadShares(), 5000);
    }
  };
  
  const createShareLink = async (itemId: string, permissions: SharePermissions): Promise<string> => {
    if (!checkCompatibility()) {
      throw new Error('Browser does not support required features');
    }
    
    setIsSharing(true);
    setShareError(null);
    
    try {
      // Validate item exists
      const item = await db.vaultItems.get(itemId);
      if (!item) {
        throw new Error('Item not found');
      }
      
      // Check share rate limit
      if (!shareValidator.canCreateShare(currentUser.id)) {
        throw new Error('Share rate limit exceeded. Please try again later.');
      }
      
      // Generate secure token with collision check
      let shareToken: string;
      let attempts = 0;
      do {
        shareToken = generateSecureToken();
        const existing = await db.shareInvitations
          .where('token').equals(shareToken).first();
        if (!existing) break;
        attempts++;
      } while (attempts < 10);
      
      if (attempts >= 10) {
        throw new Error('Failed to generate unique token');
      }
      
      const keypair = sharingCrypto.generateShareKeypair();
      if (!keypair) {
        throw new Error('Failed to generate encryption keys');
      }
      
      // Encrypt item with size check
      const encryptedPackage = await sharingCrypto.encryptForSharing(
        item, 
        keypair.publicKey, 
        keypair.privateKey, 
        permissions
      );
      
      if (!encryptedPackage) {
        throw new Error('Failed to encrypt item');
      }
      
      // Check if payload fits in URL
      const shareData = {
        t: shareToken,
        k: base64url.encode(keypair.publicKey),
        p: permissions,
        v: '1.0.0' // version for compatibility
      };
      
      const encodedData = base64url.encode(JSON.stringify(shareData));
      
      // Use chunked approach if too large
      if (encodedData.length > 2048) {
        // Store in IndexedDB and return retrieval link
        await db.shareInvitations.add({
          token: shareToken,
          itemId,
          encryptedPackage,
          createdAt: Date.now(),
          expiresAt: permissions.expiresAt,
          status: 'pending',
          chunked: true
        });
        
        return `${window.location.origin}/share#c:${shareToken}`;
      }
      
      // Store invitation for verification
      await db.shareInvitations.add({
        token: shareToken,
        itemId,
        encryptedPackage,
        createdAt: Date.now(),
        expiresAt: permissions.expiresAt,
        status: 'pending',
        chunked: false
      });
      
      return `${window.location.origin}/share#${encodedData}`;
      
    } catch (error) {
      console.error('Share creation failed:', error);
      setShareError(error.message || 'Failed to create share link');
      throw error;
    } finally {
      setIsSharing(false);
    }
  };
  
  const acceptShare = async (token: string): Promise<void> => {
    try {
      // Validate token format
      if (!token || token.length < 16) {
        throw new Error('Invalid share token');
      }
      
      // Retrieve invitation with retry
      const invitation = await retryOperation(async () => 
        db.shareInvitations.where('token').equals(token).first()
      );
      
      if (!invitation) {
        throw new Error('Share invitation not found or expired');
      }
      
      // Validate invitation
      if (!shareValidator.validateShareToken(invitation)) {
        throw new Error('Share invitation is no longer valid');
      }
      
      // Decrypt and store
      // ... implementation ...
      
      // Mark invitation as used
      await db.shareInvitations
        .where('token').equals(token)
        .modify({ status: 'accepted' });
        
    } catch (error) {
      console.error('Failed to accept share:', error);
      setShareError(error.message);
      throw error;
    }
  };
  
  const revokeShare = async (shareId: string): Promise<void> => {
    try {
      await db.transaction('rw', db.sharedItems, async () => {
        const share = await db.sharedItems.get(shareId);
        if (!share) {
          throw new Error('Share not found');
        }
        
        // Verify ownership
        if (share.sharedBy !== currentUser.id) {
          throw new Error('Unauthorized to revoke this share');
        }
        
        // Delete share
        await db.sharedItems.delete(shareId);
        
        // Log revocation
        console.log(`Share ${shareId} revoked`);
      });
      
      // Reload shares
      await loadShares();
      
    } catch (error) {
      console.error('Failed to revoke share:', error);
      setShareError(error.message);
      throw error;
    }
  };
  
  // Auto-cleanup expired shares
  createEffect(() => {
    const interval = setInterval(() => {
      db.cleanupExpiredShares().catch(console.error);
    }, 60 * 60 * 1000); // Every hour
    
    onCleanup(() => clearInterval(interval));
  });
  
  // Initialize
  createEffect(() => {
    loadShares();
  });
  
  const value: SharingContextType = {
    activeShares,
    pendingInvitations,
    shareItem,
    acceptShare,
    revokeShare,
    createShareLink,
    isSharing,
    shareError,
    clearError: () => setShareError(null)
  };
  
  return (
    <ErrorBoundary fallback={(err) => (
      <div class="text-red-500 p-4">
        Sharing service error: {err.message}
      </div>
    )}>
      <SharingContext.Provider value={value}>
        {props.children}
      </SharingContext.Provider>
    </ErrorBoundary>
  );
};
```

#### **4. UI Components with Accessibility and Error States**
```typescript
// File: src/components/ShareModal.tsx

import { Component, createSignal, Show, createEffect } from 'solid-js';
import { Motion } from '@motionone/solid';
import QRCode from 'qrcode';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  itemId: string;
  itemName: string;
}

export const ShareModal: Component<ShareModalProps> = (props) => {
  const [shareMethod, setShareMethod] = createSignal<'link' | 'qr' | 'peer'>('link');
  const [shareLink, setShareLink] = createSignal('');
  const [qrDataUrl, setQrDataUrl] = createSignal('');
  const [isGenerating, setIsGenerating] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);
  const [copySuccess, setCopySuccess] = createSignal(false);
  const [permissions, setPermissions] = createSignal<SharePermissions>({
    canView: true,
    canEdit: false,
    canReshare: false,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours default
    requiresBiometric: false
  });
  
  // Browser compatibility checks
  const canUseClipboard = () => navigator?.clipboard?.writeText;
  const canUseWebRTC = () => typeof RTCPeerConnection !== 'undefined';
  const canGenerateQR = () => typeof QRCode !== 'undefined';
  
  const generateShareLink = async () => {
    setIsGenerating(true);
    setError(null);
    
    try {
      const link = await sharingContext.createShareLink(props.itemId, permissions());
      setShareLink(link);
      
      // Generate QR if method selected and supported
      if (shareMethod() === 'qr' && canGenerateQR()) {
        try {
          // Check payload size for QR compatibility
          if (link.length > 2953) {
            // Generate chunked QR codes
            const chunks = chunkString(link, 1000);
            // Implementation for multiple QR codes...
            setError('Link too large for single QR code. Use link sharing instead.');
          } else {
            const qr = await QRCode.toDataURL(link, {
              width: 300,
              margin: 2,
              errorCorrectionLevel: 'M',
              color: { dark: '#000000', light: '#ffffff' }
            });
            setQrDataUrl(qr);
          }
        } catch (qrError) {
          console.error('QR generation failed:', qrError);
          setError('Failed to generate QR code');
        }
      }
    } catch (error) {
      setError(error.message || 'Failed to generate share link');
    } finally {
      setIsGenerating(false);
    }
  };
  
  const copyToClipboard = async () => {
    if (!canUseClipboard()) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = shareLink();
      textArea.style.position = 'fixed';
      textArea.style.opacity = '0';
      document.body.appendChild(textArea);
      textArea.select();
      
      try {
        document.execCommand('copy');
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } catch (err) {
        setError('Failed to copy to clipboard');
      } finally {
        document.body.removeChild(textArea);
      }
      return;
    }
    
    try {
      await navigator.clipboard.writeText(shareLink());
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      setError('Failed to copy to clipboard');
    }
  };
  
  // Auto-generate when modal opens
  createEffect(() => {
    if (props.isOpen && !shareLink()) {
      generateShareLink();
    }
  });
  
  // Cleanup on close
  createEffect(() => {
    if (!props.isOpen) {
      setShareLink('');
      setQrDataUrl('');
      setError(null);
      setCopySuccess(false);
    }
  });
  
  return (
    <Show when={props.isOpen}>
      <Motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
        role="dialog"
        aria-modal="true"
        aria-labelledby="share-modal-title"
      >
        <div class="bg-zinc-900 p-6 rounded-none max-w-md w-full max-h-[90vh] overflow-y-auto">
          <h2 id="share-modal-title" class="text-xl font-mono mb-4">
            Share: {props.itemName}
          </h2>
          
          {/* Error Display */}
          <Show when={error()}>
            <div class="bg-red-900/50 border border-red-500 p-3 mb-4 text-sm">
              {error()}
            </div>
          </Show>
          
          {/* Share Method Tabs */}
          <div class="flex gap-2 mb-4" role="tablist">
            <button
              onClick={() => setShareMethod('link')}
              class={`px-4 py-2 ${shareMethod() === 'link' ? 'bg-white text-black' : 'bg-zinc-800'}`}
              role="tab"
              aria-selected={shareMethod() === 'link'}
              aria-controls="share-link-panel"
            >
              Link
            </button>
            <button
              onClick={() => setShareMethod('qr')}
              class={`px-4 py-2 ${shareMethod() === 'qr' ? 'bg-white text-black' : 'bg-zinc-800'}`}
              role="tab"
              aria-selected={shareMethod() === 'qr'}
              aria-controls="share-qr-panel"
              disabled={!canGenerateQR()}
            >
              QR Code
            </button>
            <button
              onClick={() => setShareMethod('peer')}
              class={`px-4 py-2 ${shareMethod() === 'peer' ? 'bg-white text-black' : 'bg-zinc-800'}`}
              role="tab"
              aria-selected={shareMethod() === 'peer'}
              aria-controls="share-peer-panel"
              disabled={!canUseWebRTC()}
            >
              Nearby
            </button>
          </div>
          
          {/* Permissions */}
          <fieldset class="mb-4 space-y-2 border border-zinc-700 p-3">
            <legend class="text-sm px-2">Permissions</legend>
            
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={permissions().canEdit}
                onChange={(e) => setPermissions({...permissions(), canEdit: e.target.checked})}
                aria-describedby="edit-permission-desc"
              />
              <span>Allow editing</span>
            </label>
            <span id="edit-permission-desc" class="sr-only">
              Recipient can modify the shared password
            </span>
            
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={permissions().canReshare}
                onChange={(e) => setPermissions({...permissions(), canReshare: e.target.checked})}
                aria-describedby="reshare-permission-desc"
              />
              <span>Allow resharing</span>
            </label>
            <span id="reshare-permission-desc" class="sr-only">
              Recipient can share with others
            </span>
            
            <label class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={permissions().requiresBiometric}
                onChange={(e) => setPermissions({...permissions(), requiresBiometric: e.target.checked})}
                aria-describedby="biometric-permission-desc"
              />
              <span>Require biometric</span>
            </label>
            <span id="biometric-permission-desc" class="sr-only">
              Recipient must use biometric authentication to access
            </span>
            
            <label class="flex flex-col gap-1">
              <span>Expires in:</span>
              <select
                onChange={(e) => {
                  const hours = parseInt(e.target.value);
                  setPermissions({
                    ...permissions(),
                    expiresAt: hours === 0 ? undefined : Date.now() + hours * 60 * 60 * 1000
                  });
                }}
                aria-label="Expiration time"
              >
                <option value="1">1 hour</option>
                <option value="24" selected>24 hours</option>
                <option value="168">1 week</option>
                <option value="720">30 days</option>
                <option value="0">Never</option>
              </select>
            </label>
            
            <label class="flex flex-col gap-1">
              <span>Max access count:</span>
              <input
                type="number"
                min="1"
                max="1000"
                value={permissions().maxAccessCount || 100}
                onChange={(e) => setPermissions({
                  ...permissions(),
                  maxAccessCount: parseInt(e.target.value) || 100
                })}
                aria-label="Maximum number of times share can be accessed"
              />
            </label>
          </fieldset>
          
          {/* Share Display */}
          <div role="tabpanel" id="share-link-panel" hidden={shareMethod() !== 'link'}>
            <Show when={shareLink()} fallback={
              <div class="text-center py-4">
                <Show when={isGenerating()} fallback="Generate a share link above">
                  Generating secure link...
                </Show>
              </div>
            }>
              <div class="bg-zinc-800 p-3 mb-4 break-all font-mono text-xs">
                {shareLink()}
              </div>
              <button
                onClick={copyToClipboard}
                class="w-full bg-white text-black py-2 disabled:opacity-50"
                disabled={!shareLink() || isGenerating()}
              >
                {copySuccess() ? '✓ Copied!' : 'Copy Link'}
              </button>
            </Show>
          </div>
          
          <div role="tabpanel" id="share-qr-panel" hidden={shareMethod() !== 'qr'}>
            <Show when={qrDataUrl()} fallback={
              <div class="text-center py-4">
                <Show when={isGenerating()} fallback="Generate QR code above">
                  Generating QR code...
                </Show>
              </div>
            }>
              <img 
                src={qrDataUrl()} 
                alt="Share QR Code" 
                class="mx-auto mb-4"
                style="image-rendering: pixelated;"
              />
              <p class="text-xs text-center text-zinc-400">
                Scan this code with the recipient's device
              </p>
            </Show>
          </div>
          
          <div role="tabpanel" id="share-peer-panel" hidden={shareMethod() !== 'peer'}>
            <Show when={canUseWebRTC()} fallback={
              <div class="text-center py-4 text-zinc-400">
                WebRTC not supported in this browser
              </div>
            }>
              <PeerShareComponent 
                itemId={props.itemId} 
                permissions={permissions()} 
                onError={setError}
              />
            </Show>
          </div>
          
          <button
            onClick={() => {
              props.onClose();
              // Reset state
              setShareLink('');
              setQrDataUrl('');
              setError(null);
            }}
            class="w-full mt-4 border border-white py-2"
          >
            Close
          </button>
        </div>
      </Motion.div>
    </Show>
  );
};
```

#### **5. WebRTC Peer Sharing with Fallbacks**
```typescript
// File: src/lib/sharing/peer-sharing.ts

class PeerSharingService {
  private peerConnection: RTCPeerConnection | null = null;
  private dataChannel: RTCDataChannel | null = null;
  private connectionTimeout: number | null = null;
  private readonly CONNECTION_TIMEOUT_MS = 30000; // 30 seconds
  private readonly CHUNK_SIZE = 16384; // 16KB chunks for reliability
  
  // Check WebRTC support
  isSupported(): boolean {
    return !!(
      window.RTCPeerConnection &&
      window.RTCSessionDescription &&
      window.RTCIceCandidate
    );
  }
  
  async initiatePeerShare(
    itemData: EncryptedSharePackage,
    onStateChange?: (state: RTCPeerConnectionState) => void
  ): Promise<string> {
    if (!this.isSupported()) {
      throw new Error('WebRTC not supported');
    }
    
    try {
      // Clean up any existing connection
      this.cleanup();
      
      // Create peer connection with multiple STUN servers for reliability
      this.peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'stun:stun2.l.google.com:19302' },
          { urls: 'stun:stun3.l.google.com:19302' },
          { urls: 'stun:stun4.l.google.com:19302' }
        ],
        iceCandidatePoolSize: 10
      });
      
      // Monitor connection state
      this.peerConnection.onconnectionstatechange = () => {
        const state = this.peerConnection?.connectionState;
        console.log('Connection state:', state);
        onStateChange?.(state);
        
        if (state === 'failed' || state === 'disconnected') {
          this.handleConnectionFailure();
        }
      };
      
      // Create reliable data channel
      this.dataChannel = this.peerConnection.createDataChannel('share', {
        ordered: true,
        maxRetransmits: 10,
        maxPacketLifeTime: 30000 // 30 seconds
      });
      
      // Setup data channel handlers
      this.setupDataChannel(this.dataChannel);
      
      // Create and set local description
      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      
      // Collect ICE candidates
      const iceCandidates: RTCIceCandidateInit[] = [];
      
      return new Promise((resolve, reject) => {
        // Set timeout
        this.connectionTimeout = window.setTimeout(() => {
          reject(new Error('Connection timeout'));
          this.cleanup();
        }, this.CONNECTION_TIMEOUT_MS);
        
        this.peerConnection!.onicecandidate = (event) => {
          if (event.candidate) {
            iceCandidates.push(event.candidate.toJSON());
          } else {
            // ICE gathering complete
            clearTimeout(this.connectionTimeout!);
            
            const connectionData = {
              offer: offer,
              candidates: iceCandidates,
              timestamp: Date.now(),
              version: '1.0.0'
            };
            
            // Compress if needed
            const encoded = this.compressConnectionData(connectionData);
            resolve(encoded);
          }
        };
        
        this.peerConnection!.onicecandidateerror = (event) => {
          console.error('ICE candidate error:', event);
        };
      });
      
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }
  
  async acceptPeerShare(
    offerString: string,
    onDataReceived?: (data: any) => void
  ): Promise<string> {
    if (!this.isSupported()) {
      throw new Error('WebRTC not supported');
    }
    
    try {
      const connectionData = this.decompressConnectionData(offerString);
      
      // Validate connection data
      if (!connectionData.offer || !connectionData.candidates) {
        throw new Error('Invalid connection data');
      }
      
      // Check if connection data is not expired (5 minutes)
      if (Date.now() - connectionData.timestamp > 5 * 60 * 1000) {
        throw new Error('Connection offer expired');
      }
      
      this.cleanup();
      
      this.peerConnection = new RTCPeerConnection({
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' }
        ]
      });
      
      // Handle incoming data channel
      this.peerConnection.ondatachannel = (event) => {
        this.dataChannel = event.channel;
        this.setupDataChannel(this.dataChannel, onDataReceived);
      };
      
      // Set remote description
      await this.peerConnection.setRemoteDescription(connectionData.offer);
      
      // Add ICE candidates
      for (const candidate of connectionData.candidates) {
        await this.peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      }
      
      // Create answer
      const answer = await this.peerConnection.createAnswer();
      await this.peerConnection.setLocalDescription(answer);
      
      const answerCandidates: RTCIceCandidateInit[] = [];
      
      return new Promise((resolve, reject) => {
        this.connectionTimeout = window.setTimeout(() => {
          reject(new Error('Connection timeout'));
          this.cleanup();
        }, this.CONNECTION_TIMEOUT_MS);
        
        this.peerConnection!.onicecandidate = (event) => {
          if (event.candidate) {
            answerCandidates.push(event.candidate.toJSON());
          } else {
            clearTimeout(this.connectionTimeout!);
            
            const answerData = {
              answer: answer,
              candidates: answerCandidates,
              timestamp: Date.now(),
              version: '1.0.0'
            };
            
            resolve(this.compressConnectionData(answerData));
          }
        };
      });
      
    } catch (error) {
      this.cleanup();
      throw error;
    }
  }
  
  private setupDataChannel(
    channel: RTCDataChannel,
    onDataReceived?: (data: any) => void
  ): void {
    const chunks: ArrayBuffer[] = [];
    let expectedChunks = 0;
    
    channel.onopen = () => {
      console.log('Data channel opened');
    };
    
    channel.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        
        if (data.type === 'metadata') {
          expectedChunks = data.totalChunks;
          chunks.length = 0;
        } else if (data.type === 'chunk') {
          chunks[data.index] = data.data;
          
          if (chunks.filter(c => c).length === expectedChunks) {
            // All chunks received, reconstruct data
            const combined = this.combineChunks(chunks);
            onDataReceived?.(combined);
          }
        } else if (data.type === 'complete') {
          // Single message (not chunked)
          onDataReceived?.(data.data);
        }
      } catch (error) {
        console.error('Failed to process received data:', error);
      }
    };
    
    channel.onerror = (error) => {
      console.error('Data channel error:', error);
    };
    
    channel.onclose = () => {
      console.log('Data channel closed');
    };
  }
  
  async sendData(data: any): Promise<void> {
    if (!this.dataChannel || this.dataChannel.readyState !== 'open') {
      throw new Error('Data channel not ready');
    }
    
    const serialized = JSON.stringify(data);
    const size = new Blob([serialized]).size;
    
    if (size > this.CHUNK_SIZE) {
      // Send in chunks
      const chunks = this.chunkData(serialized);
      
      // Send metadata first
      this.dataChannel.send(JSON.stringify({
        type: 'metadata',
        totalChunks: chunks.length,
        totalSize: size
      }));
      
      // Send chunks with delay to avoid overwhelming
      for (let i = 0; i < chunks.length; i++) {
        await this.waitForBufferSpace();
        
        this.dataChannel.send(JSON.stringify({
          type: 'chunk',
          index: i,
          data: chunks[i]
        }));
        
        // Small delay between chunks
        await new Promise(r => setTimeout(r, 10));
      }
    } else {
      // Send as single message
      this.dataChannel.send(JSON.stringify({
        type: 'complete',
        data: data
      }));
    }
  }
  
  private async waitForBufferSpace(): Promise<void> {
    while (this.dataChannel && 
           this.dataChannel.bufferedAmount > 65536) { // 64KB threshold
      await new Promise(r => setTimeout(r, 50));
    }
  }
  
  private chunkData(data: string): string[] {
    const chunks: string[] = [];
    for (let i = 0; i < data.length; i += this.CHUNK_SIZE) {
      chunks.push(data.slice(i, i + this.CHUNK_SIZE));
    }
    return chunks;
  }
  
  private combineChunks(chunks: ArrayBuffer[]): any {
    const combined = chunks.join('');
    return JSON.parse(combined);
  }
  
  private compressConnectionData(data: any): string {
    // Simple compression using base64url encoding
    const json = JSON.stringify(data);
    return base64url.encode(json);
  }
  
  private decompressConnectionData(compressed: string): any {
    const json = base64url.decode(compressed);
    return JSON.parse(json);
  }
  
  private handleConnectionFailure(): void {
    console.error('Peer connection failed');
    this.cleanup();
  }
  
  cleanup(): void {
    if (this.connectionTimeout) {
      clearTimeout(this.connectionTimeout);
      this.connectionTimeout = null;
    }
    
    if (this.dataChannel) {
      this.dataChannel.close();
      this.dataChannel = null;
    }
    
    if (this.peerConnection) {
      this.peerConnection.close();
      this.peerConnection = null;
    }
  }
}
```

### **6. Integration Points with Safety Checks**

#### **Update VaultItemCard.tsx**
```typescript
// Add share button with feature detection
<Show when={window.isSecureContext && db.verno >= 2}>
  <button
    onClick={() => {
      if (!item.id) {
        console.error('Item has no ID');
        return;
      }
      openShareModal(item.id);
    }}
    class="p-2 hover:bg-zinc-800 transition-colors"
    aria-label={`Share ${item.name}`}
    disabled={item.isSharing}
  >
    <Show when={!item.isSharing} fallback={<IconLoader class="w-4 h-4 animate-spin" />}>
      <IconShare class="w-4 h-4" />
    </Show>
  </button>
</Show>
```

#### **Update VaultContext.tsx**
```typescript
// Add sharing status with backward compatibility
interface VaultItem {
  // ... existing fields (DO NOT MODIFY) ...
  
  // New optional fields (backward compatible)
  isShared?: boolean;
  sharedWith?: string[];
  sharePermissions?: SharePermissions;
  isSharing?: boolean; // UI state
}

// Add migration check
const checkDatabaseVersion = async (): Promise<boolean> => {
  try {
    const version = db.verno;
    if (version < 2) {
      console.warn('Sharing features require database migration');
      return false;
    }
    return true;
  } catch (error) {
    console.error('Database version check failed:', error);
    return false;
  }
};
```

### **7. Enhanced Security Validations**

```typescript
// File: src/lib/sharing/share-validator.ts

class ShareValidator {
  private readonly MAX_SHARES_PER_HOUR = 10;
  private readonly MAX_SHARE_SIZE = 100 * 1024; // 100KB
  private readonly MIN_TOKEN_LENGTH = 32;
  
  // Comprehensive token validation
  validateShareToken(token: ShareInvitation): boolean {
    try {
      // Check expiration
      if (token.expiresAt && Date.now() > token.expiresAt) {
        console.warn('Token expired');
        return false;
      }
      
      // Check status
      if (token.status !== 'pending') {
        console.warn(`Token already ${token.status}`);
        return false;
      }
      
      // Check token age (max 30 days)
      if (Date.now() - token.createdAt > 30 * 24 * 60 * 60 * 1000) {
        console.warn('Token too old');
        return false;
      }
      
      // Validate token structure
      if (!token.token || token.token.length < this.MIN_TOKEN_LENGTH) {
        console.warn('Invalid token format');
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('Token validation error:', error);
      return false;
    }
  }
  
  // Enhanced permission validation
  validatePermissions(permissions: SharePermissions): boolean {
    try {
      // Check access count
      if (permissions.maxAccessCount !== undefined) {
        if (permissions.accessCount >= permissions.maxAccessCount) {
          console.warn('Max access count reached');
          return false;
        }
      }
      
      // Check expiration
      if (permissions.expiresAt && Date.now() > permissions.expiresAt) {
        console.warn('Permissions expired');
        return false;
      }
      
      // Validate permission logic
      if (permissions.canReshare && !permissions.canView) {
        console.warn('Invalid permission combination');
        return false;
      }
      
      // Check IP restrictions if present
      if (permissions.ipRestrictions?.length > 0) {
        // Implementation for IP validation...
      }
      
      return true;
    } catch (error) {
      console.error('Permission validation error:', error);
      return false;
    }
  }
  
  // Rate limiting with sliding window
  private shareRateLimit = new Map<string, number[]>();
  
  canCreateShare(userId: string): boolean {
    const now = Date.now();
    const userShares = this.shareRateLimit.get(userId) || [];
    
    // Remove shares older than 1 hour (sliding window)
    const recentShares = userShares.filter(time => now - time < 3600000);
    
    if (recentShares.length >= this.MAX_SHARES_PER_HOUR) {
      console.warn(`Rate limit exceeded for user ${userId}`);
      return false;
    }
    
    recentShares.push(now);
    this.shareRateLimit.set(userId, recentShares);
    
    // Cleanup old entries periodically
    if (Math.random() < 0.1) { // 10% chance
      this.cleanupRateLimits();
    }
    
    return true;
  }
  
  private cleanupRateLimits(): void {
    const now = Date.now();
    this.shareRateLimit.forEach((times, userId) => {
      const recent = times.filter(t => now - t < 3600000);
      if (recent.length === 0) {
        this.shareRateLimit.delete(userId);
      } else {
        this.shareRateLimit.set(userId, recent);
      }
    });
  }
  
  // Validate share size
  validateShareSize(data: any): boolean {
    try {
      const size = new Blob([JSON.stringify(data)]).size;
      return size <= this.MAX_SHARE_SIZE;
    } catch (error) {
      console.error('Size validation error:', error);
      return false;
    }
  }
  
  // Sanitize user input
  sanitizeShareData(data: any): any {
    // Remove potential XSS vectors
    const sanitized = JSON.parse(JSON.stringify(data));
    
    const sanitizeString = (str: string): string => {
      return str
        .replace(/[<>]/g, '') // Remove HTML tags
        .replace(/javascript:/gi, '') // Remove javascript: protocol
        .slice(0, 1000); // Limit string length
    };
    
    const sanitizeObject = (obj: any): any => {
      for (const key in obj) {
        if (typeof obj[key] === 'string') {
          obj[key] = sanitizeString(obj[key]);
        } else if (typeof obj[key] === 'object' && obj[key] !== null) {
          obj[key] = sanitizeObject(obj[key]);
        }
      }
      return obj;
    };
    
    return sanitizeObject(sanitized);
  }
}

// Export singleton instance
export const shareValidator = new ShareValidator();
```

## **📦 DEPLOYMENT STEPS**

1. **Create new branch**: `feature/secure-sharing`
2. **Implement in this order**:
   - Crypto service extensions (with tests)
   - Database migrations (with rollback plan)
   - Sharing context (with error boundaries)
   - UI components (with accessibility)
   - Integration with existing components
   - Browser compatibility layer
3. **Test thoroughly**:
   - Unit tests for all crypto operations
   - Integration tests for sharing flow
   - E2E tests for complete scenarios
   - Cross-browser testing (Chrome, Firefox, Safari, Edge)
   - Mobile device testing (iOS Safari, Chrome Android)
   - Performance testing (memory leaks, CPU usage)
   - Security penetration testing
4. **Progressive rollout**:
   - Local testing with database backup
   - Deploy to staging with feature flag
   - Beta testing with selected users (1 week)
   - Monitor error rates and performance
   - Gradual rollout (10% → 50% → 100%)
   - Full production release with rollback plan

## **⚠️ CRITICAL SAFETY CHECKS**

Before deployment, ensure:
- [ ] Database backup created and tested
- [ ] Rollback procedure documented and tested
- [ ] Existing vault data remains accessible
- [ ] Offline mode works for all core features
- [ ] No regression in encryption security
- [ ] Bundle size increase < 50KB
- [ ] Performance metrics within 10% of baseline
- [ ] All existing tests pass
- [ ] New tests achieve >80% coverage
- [ ] Security audit completed
- [ ] Browser compatibility verified (last 2 versions)
- [ ] Memory leak testing passed
- [ ] Error handling tested for all failure modes
- [ ] Accessibility audit passed (WCAG 2.1 AA)
- [ ] Documentation updated

## **🔧 IMPLEMENTATION NOTES**

1. **DO NOT** modify existing crypto operations for vault items
2. **DO NOT** change the database schema for existing tables
3. **DO NOT** require network access for existing features
4. **DO NOT** use experimental browser APIs without fallbacks
5. **DO** use the same encryption libraries already in the project
6. **DO** maintain the monochromatic design system
7. **DO** follow the existing component patterns
8. **DO** ensure mobile-first responsive design
9. **DO** implement comprehensive error handling
10. **DO** add telemetry for monitoring share feature usage

## **Expected File Structure After Implementation**
```
src/
├── lib/
│   ├── crypto/
│   │   ├── crypto-service.ts (UNCHANGED)
│   │   └── sharing-crypto-service.ts (NEW)
│   ├── sharing/
│   │   ├── peer-sharing.ts (NEW)
│   │   ├── share-validator.ts (NEW)
│   │   ├── share-url-handler.ts (NEW)
│   │   └── browser-compat.ts (NEW)
│   └── db/
│       └── database.ts (EXTENDED with v2 schema + migrations)
├── context/
│   ├── VaultContext.tsx (EXISTING - minor updates)
│   └── SharingContext.tsx (NEW)
├── components/
│   ├── ShareModal.tsx (NEW)
│   ├── SharedItemsList.tsx (NEW)
│   ├── SharePermissionsEditor.tsx (NEW)
│   ├── PeerShareComponent.tsx (NEW)
│   └── VaultItemCard.tsx (UPDATED with share button)
├── pages/
│   ├── Vault.tsx (UPDATED to include sharing UI)
│   └── Share.tsx (NEW - for accepting shares)
└── tests/
    ├── sharing/
    │   ├── crypto.test.ts (NEW)
    │   ├── validator.test.ts (NEW)
    │   ├── peer.test.ts (NEW)
    │   └── integration.test.ts (NEW)
    └── ... (existing tests)
```

## **🔄 Rollback Plan**

If critical issues arise:
1. **Immediate**: Disable sharing UI components via feature flag
2. **Short-term**: Revert to database v1 schema (non-destructive)
3. **Full rollback**: Deploy previous version from backup
4. **Data recovery**: Restore from automated backups
5. **Communication**: Notify affected users via in-app message

This enhanced implementation ensures maximum reliability, compatibility, and safety while maintaining your zero-knowledge architecture and existing codebase integrity.