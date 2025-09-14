import { startAuthentication, startRegistration } from '@simplewebauthn/browser';
import { DatabaseService } from '../db/database';
import { CryptoService } from '../crypto/crypto-service';

export interface Credential {
  id: string;
  publicKey: string;
  counter: number;
  createdAt: number;
}

export class AuthService {
  private static instance: AuthService;
  private isAuthenticated: boolean = false;
  private sessionTimeout: number = 15 * 60 * 1000; // 15 minutes
  private lastActivity: number = Date.now();
  private sessionTimer: number | null = null;

  private constructor() {}

  static getInstance(): AuthService {
    if (!AuthService.instance) {
      AuthService.instance = new AuthService();
    }
    return AuthService.instance;
  }

  async checkAuth(): Promise<boolean> {
    // Check if WebAuthn is available
    if (!window.PublicKeyCredential) {
      console.warn('WebAuthn not supported');
      return false;
    }

    // Check session validity
    if (this.isAuthenticated) {
      const now = Date.now();
      if (now - this.lastActivity > this.sessionTimeout) {
        await this.logout();
        return false;
      }
      this.updateActivity();
    }

    return this.isAuthenticated;
  }

  async register(username: string): Promise<boolean> {
    try {
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);

      const publicKeyCredentialCreationOptions = {
        challenge: Array.from(challenge, byte => byte.toString(16).padStart(2, '0')).join(''),
        rp: {
          name: 'VuVault Zero',
          id: location.hostname
        },
        user: {
          id: btoa(username),
          name: username,
          displayName: username
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' as const },
          { alg: -257, type: 'public-key' as const }
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform' as const,
          userVerification: 'required' as const,
          requireResidentKey: true,
          residentKey: 'required' as const
        },
        timeout: 60000,
        attestation: 'direct' as const
      };

      const credential = await startRegistration({ 
        optionsJSON: publicKeyCredentialCreationOptions 
      });

      // Store credential
      const db = DatabaseService.getInstance();
      await db.setMasterKey(credential.id);

      // Generate and store master key
      const crypto = CryptoService.getInstance();
      const password = crypto.generatePassword(32);
      await crypto.deriveMasterKey(password);

      this.isAuthenticated = true;
      this.startSessionTimer();
      
      return true;
    } catch (error) {
      console.error('Registration failed:', error);
      return false;
    }
  }

  async login(): Promise<boolean> {
    try {
      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);

      const publicKeyCredentialRequestOptions = {
        challenge: Array.from(challenge, byte => byte.toString(16).padStart(2, '0')).join(''),
        timeout: 60000,
        userVerification: 'required' as const,
        rpId: location.hostname
      };

      const assertion = await startAuthentication({
        optionsJSON: publicKeyCredentialRequestOptions
      });

      // Verify credential
      if (assertion) {
        this.isAuthenticated = true;
        this.updateActivity();
        this.startSessionTimer();
        
        // Restore master key
        const crypto = CryptoService.getInstance();
        const password = crypto.generatePassword(32);
        await crypto.deriveMasterKey(password);
        
        return true;
      }

      return false;
    } catch (error) {
      console.error('Login failed:', error);
      return false;
    }
  }

  async logout(): Promise<void> {
    this.isAuthenticated = false;
    this.stopSessionTimer();
    
    // Clear master key from memory
    const crypto = CryptoService.getInstance();
    crypto.clearMasterKey();
    
    // Clear session data
    sessionStorage.clear();
  }

  private updateActivity(): void {
    this.lastActivity = Date.now();
  }

  private startSessionTimer(): void {
    this.stopSessionTimer();
    
    this.sessionTimer = window.setInterval(() => {
      const now = Date.now();
      if (now - this.lastActivity > this.sessionTimeout) {
        this.logout();
        window.location.href = '/login';
      }
    }, 60000); // Check every minute
  }

  private stopSessionTimer(): void {
    if (this.sessionTimer) {
      clearInterval(this.sessionTimer);
      this.sessionTimer = null;
    }
  }

  getAuthStatus(): boolean {
    return this.isAuthenticated;
  }
}
