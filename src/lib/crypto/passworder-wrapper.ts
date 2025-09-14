// Wrapper to handle the problematic @metamask/browser-passworder library
import type { VaultItem } from '../db/database';

// Use dynamic import with proper error handling
let browserPassworder: any = null;

export async function initPassworder() {
  if (!browserPassworder) {
    try {
      // Dynamic import to avoid build-time issues
      const module = await import('@metamask/browser-passworder');
      browserPassworder = module.default || module;
    } catch (error) {
      console.warn('Failed to load @metamask/browser-passworder, using fallback');
      // Fallback to native crypto implementation
      browserPassworder = {
        encrypt: async (password: string, data: any) => {
          // Use your existing ChaCha20-Poly1305 implementation
          const { encryptData } = await import('./enhanced-crypto-service');
          const encrypted = await encryptData(JSON.stringify(data), password);
          return encrypted;
        },
        decrypt: async (password: string, encryptedData: string) => {
          const { decryptData } = await import('./enhanced-crypto-service');
          const decrypted = await decryptData(encryptedData, password);
          return JSON.parse(decrypted);
        }
      };
    }
  }
  return browserPassworder;
}

export async function encryptWithPassworder(password: string, data: any): Promise<string> {
  const passworder = await initPassworder();
  return passworder.encrypt(password, data);
}

export async function decryptWithPassworder(password: string, encryptedData: string): Promise<any> {
  const passworder = await initPassworder();
  return passworder.decrypt(password, encryptedData);
}
