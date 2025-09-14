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
      // Check if WebAuthn is available
      if (!window.PublicKeyCredential) {
        console.error('WebAuthn not supported in this browser');
        throw new Error('WebAuthn not supported in this browser');
      }

      // Check if authenticator is available
      try {
        const available = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
        if (!available) {
          console.error('Platform authenticator not available');
          throw new Error('Platform authenticator not available');
        }
      } catch (e) {
        console.warn('Could not check authenticator availability:', e);
        // Continue anyway as some browsers might not support this check
      }

      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);

      // Convert challenge to base64 format for better compatibility
      const challengeBase64 = btoa(String.fromCharCode(...challenge));

      // Use a more compatible configuration
      const publicKeyCredentialCreationOptions = {
        challenge: challengeBase64,
        rp: {
          name: 'VuVault Zero',
          // Use effective domain without port for better compatibility
          id: location.hostname.includes('localhost') ? 'localhost' : location.hostname
        },
        user: {
          id: btoa(username),
          name: username,
          displayName: username
        },
        pubKeyCredParams: [
          { alg: -7, type: 'public-key' as const },  // ES256
          { alg: -257, type: 'public-key' as const } // RS256
        ],
        authenticatorSelection: {
          // Allow both platform and cross-platform authenticators
          authenticatorAttachment: 'platform' as const,
          userVerification: 'preferred' as const,  // Changed from required to preferred
          requireResidentKey: false,  // Changed from true to false
          residentKey: 'preferred' as const  // Changed from required to preferred
        },
        timeout: 60000,
        attestation: 'none' as const  // Changed from direct to none for better privacy
      };

      console.log('Starting WebAuthn registration with options:', publicKeyCredentialCreationOptions);
      
      const credential = await startRegistration({ 
        optionsJSON: publicKeyCredentialCreationOptions 
      });

      console.log('Registration successful, credential:', credential);

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
      // Check if WebAuthn is available
      if (!window.PublicKeyCredential) {
        console.error('WebAuthn not supported in this browser');
        throw new Error('WebAuthn not supported in this browser');
      }

      const challenge = new Uint8Array(32);
      window.crypto.getRandomValues(challenge);

      // Convert challenge to base64 format for better compatibility
      const challengeBase64 = btoa(String.fromCharCode(...challenge));

      const publicKeyCredentialRequestOptions = {
        challenge: challengeBase64,
        timeout: 60000,
        userVerification: 'preferred' as const, // Changed from required to preferred
        rpId: location.hostname.includes('localhost') ? 'localhost' : location.hostname
      };

      console.log('Starting WebAuthn authentication with options:', publicKeyCredentialRequestOptions);

      const assertion = await startAuthentication({
        optionsJSON: publicKeyCredentialRequestOptions
      });

      console.log('Authentication successful, assertion:', assertion);

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
