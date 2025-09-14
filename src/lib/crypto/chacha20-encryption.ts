import { chacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from '@noble/hashes/utils';
import { pbkdf2 } from '@noble/hashes/pbkdf2';
import { sha256 } from '@noble/hashes/sha256';

export interface EncryptedData {
  ciphertext: string;
  nonce: string;
  salt: string;
  version: number;
  algorithm: string;
}

export class ChaCha20EncryptionService {
  private static instance: ChaCha20EncryptionService;
  private readonly VERSION = 2;
  private readonly ALGORITHM = 'ChaCha20-Poly1305';
  private readonly SALT_LENGTH = 32; // 256 bits
  private readonly NONCE_LENGTH = 12; // 96 bits for ChaCha20-Poly1305
  private readonly KEY_LENGTH = 32; // 256 bits
  private readonly PBKDF2_ITERATIONS = 100000;

  private constructor() {}

  static getInstance(): ChaCha20EncryptionService {
    if (!ChaCha20EncryptionService.instance) {
      ChaCha20EncryptionService.instance = new ChaCha20EncryptionService();
    }
    return ChaCha20EncryptionService.instance;
  }

  /**
   * Derive a key from a password using PBKDF2
   */
  async deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
    try {
      const encoder = new TextEncoder();
      const passwordBytes = encoder.encode(password);
      
      // Use PBKDF2 with SHA-256 and 100,000 iterations
      const key = await pbkdf2(sha256, passwordBytes, salt, {
        c: this.PBKDF2_ITERATIONS,
        dkLen: this.KEY_LENGTH
      });
      
      return key;
    } catch (error) {
      console.error('Key derivation failed:', error);
      throw new Error('Failed to derive encryption key');
    }
  }

  /**
   * Generate a random salt
   */
  generateSalt(): Uint8Array {
    return randomBytes(this.SALT_LENGTH);
  }

  /**
   * Generate a random nonce
   */
  generateNonce(): Uint8Array {
    return randomBytes(this.NONCE_LENGTH);
  }

  /**
   * Encrypt data using ChaCha20-Poly1305
   */
  async encrypt(plaintext: string, password: string): Promise<EncryptedData> {
    try {
      // Generate salt and nonce
      const salt = this.generateSalt();
      const nonce = this.generateNonce();
      
      // Derive key from password
      const key = await this.deriveKey(password, salt);
      
      // Create cipher
      const cipher = chacha20poly1305(key, nonce);
      
      // Encode plaintext
      const encoder = new TextEncoder();
      const plaintextBytes = encoder.encode(plaintext);
      
      // Encrypt
      const ciphertext = cipher.encrypt(plaintextBytes);
      
      // Convert to base64 for storage
      const result: EncryptedData = {
        ciphertext: this.uint8ArrayToBase64(ciphertext),
        nonce: this.uint8ArrayToBase64(nonce),
        salt: this.uint8ArrayToBase64(salt),
        version: this.VERSION,
        algorithm: this.ALGORITHM
      };
      
      return result;
    } catch (error) {
      console.error('Encryption failed:', error);
      throw new Error('Failed to encrypt data');
    }
  }

  /**
   * Decrypt data using ChaCha20-Poly1305
   */
  async decrypt(encryptedData: EncryptedData, password: string): Promise<string> {
    try {
      // Check version compatibility
      if (encryptedData.version !== this.VERSION) {
        throw new Error(`Unsupported encryption version: ${encryptedData.version}`);
      }
      
      // Convert from base64
      const ciphertext = this.base64ToUint8Array(encryptedData.ciphertext);
      const nonce = this.base64ToUint8Array(encryptedData.nonce);
      const salt = this.base64ToUint8Array(encryptedData.salt);
      
      // Derive key from password
      const key = await this.deriveKey(password, salt);
      
      // Create cipher
      const cipher = chacha20poly1305(key, nonce);
      
      // Decrypt
      const plaintextBytes = cipher.decrypt(ciphertext);
      
      // Decode to string
      const decoder = new TextDecoder();
      const plaintext = decoder.decode(plaintextBytes);
      
      return plaintext;
    } catch (error) {
      console.error('Decryption failed:', error);
      throw new Error('Failed to decrypt data - incorrect password or corrupted data');
    }
  }

  /**
   * Check if data uses old encryption format
   */
  isLegacyFormat(data: any): boolean {
    if (typeof data === 'string' && data.startsWith('ENC:')) {
      return true;
    }
    return !data.version || data.version < this.VERSION;
  }

  /**
   * Migrate from old encryption format
   */
  async migrateLegacyData(oldData: string, oldPassword: string, newPassword: string): Promise<EncryptedData> {
    try {
      let plaintext: string;
      
      // Handle simple base64 format (ENC:prefix:data)
      if (oldData.startsWith('ENC:')) {
        const parts = oldData.split(':');
        if (parts.length >= 3) {
          plaintext = decodeURIComponent(escape(atob(parts[2])));
        } else {
          throw new Error('Invalid legacy format');
        }
      } else {
        // Assume it's already plaintext
        plaintext = oldData;
      }
      
      // Re-encrypt with new algorithm
      return await this.encrypt(plaintext, newPassword);
    } catch (error) {
      console.error('Migration failed:', error);
      throw new Error('Failed to migrate legacy data');
    }
  }

  /**
   * Utility: Convert Uint8Array to base64
   */
  private uint8ArrayToBase64(bytes: Uint8Array): string {
    const binary = String.fromCharCode(...bytes);
    return btoa(binary);
  }

  /**
   * Utility: Convert base64 to Uint8Array
   */
  private base64ToUint8Array(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  /**
   * Generate a secure random password
   */
  generateSecurePassword(length: number = 20): string {
    const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=[]{}|;:,.<>?';
    const randomValues = randomBytes(length);
    let password = '';
    
    for (let i = 0; i < length; i++) {
      password += charset[randomValues[i] % charset.length];
    }
    
    return password;
  }
}
