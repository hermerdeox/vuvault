import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from '@noble/hashes/utils';
import { sha256 } from '@noble/hashes/sha2';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha512 } from '@noble/hashes/sha2';

export class CryptoService {
  private static instance: CryptoService;
  private masterKey: Uint8Array | null = null;

  private constructor() {}

  static getInstance(): CryptoService {
    if (!CryptoService.instance) {
      CryptoService.instance = new CryptoService();
    }
    return CryptoService.instance;
  }

  async initialize(): Promise<void> {
    // Check if WebCrypto is available
    if (!window.crypto || !window.crypto.subtle) {
      throw new Error('WebCrypto API not available');
    }
  }

  async deriveMasterKey(password: string, salt?: Uint8Array): Promise<{ key: Uint8Array; salt: Uint8Array }> {
    try {
      const usedSalt = salt || randomBytes(32);
      const encoder = new TextEncoder();
      const passwordBytes = encoder.encode(password);

      // Use PBKDF2 for key derivation with high iteration count
      const key = await pbkdf2(sha512, passwordBytes, usedSalt, { 
        c: 210000, // High iteration count for security
        dkLen: 32  // 256-bit key
      });

      this.masterKey = key;
      return { key, salt: usedSalt };
    } catch (error) {
      console.error('Key derivation failed:', error);
      throw new Error('Failed to derive master key');
    }
  }

  async encryptData(data: string, key?: Uint8Array): Promise<{ encrypted: Uint8Array; nonce: Uint8Array }> {
    try {
      const keyToUse = key || this.masterKey;
      if (!keyToUse) throw new Error('No encryption key available');

      const encoder = new TextEncoder();
      const dataBytes = encoder.encode(data);
      const nonce = randomBytes(12); // 96-bit nonce for ChaCha20-Poly1305

      const cipher = chacha20poly1305(keyToUse, nonce);
      const encrypted = cipher.encrypt(dataBytes);

      return { encrypted, nonce };
    } catch (error) {
      console.error('Encryption failed:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  async decryptData(encrypted: Uint8Array, nonce: Uint8Array, key?: Uint8Array): Promise<string> {
    try {
      const keyToUse = key || this.masterKey;
      if (!keyToUse) throw new Error('No decryption key available');

      const cipher = chacha20poly1305(keyToUse, nonce);
      const decrypted = cipher.decrypt(encrypted);

      const decoder = new TextDecoder();
      return decoder.decode(decrypted);
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data');
    }
  }

  generatePassword(length: number = 20, options: {
    uppercase?: boolean;
    lowercase?: boolean;
    numbers?: boolean;
    symbols?: boolean;
  } = { uppercase: true, lowercase: true, numbers: true, symbols: true }): string {
    let charset = '';
    if (options.lowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
    if (options.uppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (options.numbers) charset += '0123456789';
    if (options.symbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';

    if (!charset) charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    const randomValues = randomBytes(length);
    let password = '';

    for (let i = 0; i < length; i++) {
      password += charset[randomValues[i] % charset.length];
    }

    return password;
  }

  async hashPassword(password: string): Promise<string> {
    try {
      const salt = randomBytes(16);
      const hash = await pbkdf2(sha512, password, salt, { c: 100000, dkLen: 32 });
      
      // Combine salt and hash for storage
      const combined = new Uint8Array(salt.length + hash.length);
      combined.set(salt);
      combined.set(hash, salt.length);
      
      return btoa(String.fromCharCode(...combined));
    } catch (error) {
      console.error('Password hashing failed:', error);
      throw new Error('Failed to hash password');
    }
  }

  async verifyPassword(password: string, storedHash: string): Promise<boolean> {
    try {
      const combined = new Uint8Array(atob(storedHash).split('').map(c => c.charCodeAt(0)));
      const salt = combined.slice(0, 16);
      const hash = combined.slice(16);
      
      const testHash = await pbkdf2(sha512, password, salt, { c: 100000, dkLen: 32 });
      
      // Constant-time comparison
      if (hash.length !== testHash.length) return false;
      
      let result = 0;
      for (let i = 0; i < hash.length; i++) {
        result |= hash[i] ^ testHash[i];
      }
      
      return result === 0;
    } catch (error) {
      console.error('Password verification failed:', error);
      return false;
    }
  }

  clearMasterKey(): void {
    if (this.masterKey) {
      // Overwrite the key in memory
      this.masterKey.fill(0);
      this.masterKey = null;
    }
  }

  calculatePasswordStrength(password: string): {
    score: number;
    feedback: string[];
    timeToBreak: string;
  } {
    const feedback: string[] = [];
    let score = 0;
    let charsetSize = 0;
    
    // Calculate charset size for entropy calculation
    if (/[a-z]/.test(password)) charsetSize += 26;
    if (/[A-Z]/.test(password)) charsetSize += 26;
    if (/[0-9]/.test(password)) charsetSize += 10;
    if (/[^a-zA-Z0-9]/.test(password)) charsetSize += 32; // Common special chars

    // Length check
    if (password.length >= 12) score += 25;
    else if (password.length >= 8) score += 10;
    else feedback.push('Use at least 12 characters');

    // Character variety
    if (/[a-z]/.test(password)) score += 15;
    else feedback.push('Add lowercase letters');

    if (/[A-Z]/.test(password)) score += 15;
    else feedback.push('Add uppercase letters');

    if (/[0-9]/.test(password)) score += 15;
    else feedback.push('Add numbers');

    if (/[^a-zA-Z0-9]/.test(password)) score += 20;
    else feedback.push('Add special characters');

    // Common patterns
    if (!/(.)\1{2,}/.test(password)) score += 10;
    else feedback.push('Avoid repeated characters');

    // Dictionary check (simplified)
    const commonPasswords = ['password', '123456', 'qwerty', 'admin', 'letmein'];
    if (!commonPasswords.some(common => password.toLowerCase().includes(common))) {
      score += 10;
    } else {
      feedback.push('Avoid common passwords');
      score = Math.max(0, score - 20);
    }

    // Calculate entropy and time to break
    const entropy = password.length * Math.log2(charsetSize || 1);
    let timeToBreak: string;
    
    // Assuming 1 trillion (10^12) guesses per second with modern GPUs
    const guessesPerSecond = 1e12;
    const totalCombinations = Math.pow(2, entropy);
    const secondsToBreak = totalCombinations / (2 * guessesPerSecond); // Average case
    
    if (secondsToBreak < 1) {
      timeToBreak = "INSTANT";
    } else if (secondsToBreak < 60) {
      timeToBreak = `${Math.round(secondsToBreak)} SECONDS`;
    } else if (secondsToBreak < 3600) {
      timeToBreak = `${Math.round(secondsToBreak / 60)} MINUTES`;
    } else if (secondsToBreak < 86400) {
      timeToBreak = `${Math.round(secondsToBreak / 3600)} HOURS`;
    } else if (secondsToBreak < 2592000) {
      timeToBreak = `${Math.round(secondsToBreak / 86400)} DAYS`;
    } else if (secondsToBreak < 31536000) {
      timeToBreak = `${Math.round(secondsToBreak / 2592000)} MONTHS`;
    } else if (secondsToBreak < 31536000 * 100) {
      timeToBreak = `${Math.round(secondsToBreak / 31536000)} YEARS`;
    } else if (secondsToBreak < 31536000 * 1000000) {
      const centuries = Math.round(secondsToBreak / (31536000 * 100));
      timeToBreak = `${centuries} CENTURIES`;
    } else if (secondsToBreak < 31536000 * 1000000000) {
      const millennia = Math.round(secondsToBreak / (31536000 * 1000));
      timeToBreak = `${millennia} MILLENNIA`;
    } else {
      timeToBreak = "HEAT DEATH OF UNIVERSE";
    }

    return { score: Math.min(100, score), feedback, timeToBreak };
  }
}
