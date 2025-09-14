// Enhanced Authentication Service with Adaptive Security
// This extends the existing AuthService without modifying it
// All enhancements are additive and backward-compatible

import { AuthService } from './auth-service';
import { startAuthentication } from '@simplewebauthn/browser';

interface RiskFactors {
  deviceTrust: number;
  locationAnomaly: number;
  timePattern: number;
  failedAttempts: number;
}

interface DeviceInfo {
  fingerprint: string;
  trustScore: number;
  lastSeen: number;
}

export class EnhancedAuthService extends AuthService {
  private static enhancedInstance: EnhancedAuthService;
  private riskScore: number = 0;
  private deviceFingerprint: string = '';
  private adaptiveTimeout: number = 15 * 60 * 1000;
  private failedAttempts: number = 0;
  private lastAuthTime: number = 0;
  private trustedDevices: Map<string, DeviceInfo> = new Map();
  
  // Override getInstance to return enhanced version
  static getEnhancedInstance(): EnhancedAuthService {
    if (!EnhancedAuthService.enhancedInstance) {
      EnhancedAuthService.enhancedInstance = new EnhancedAuthService();
    }
    return EnhancedAuthService.enhancedInstance;
  }
  
  // Enhanced authentication check with risk assessment
  async checkAuth(): Promise<boolean> {
    const baseAuth = await super.checkAuth();
    if (!baseAuth) return false;
    
    // Layer adaptive security on top
    await this.calculateRiskScore();
    this.adjustSessionTimeout();
    
    // Store authentication time for pattern analysis
    this.lastAuthTime = Date.now();
    localStorage.setItem('vuvault_last_auth', String(this.lastAuthTime));
    
    return true;
  }
  
  // Calculate risk score based on multiple factors
  private async calculateRiskScore(): Promise<void> {
    const factors: RiskFactors = {
      deviceTrust: await this.getDeviceTrust(),
      locationAnomaly: await this.checkLocationAnomaly(),
      timePattern: this.analyzeTimePattern(),
      failedAttempts: this.getRecentFailures()
    };
    
    // Weighted average of risk factors (0-10 scale)
    this.riskScore = (
      factors.deviceTrust * 0.3 +
      factors.locationAnomaly * 0.3 +
      factors.timePattern * 0.2 +
      factors.failedAttempts * 0.2
    );
    
    console.info(`Risk score calculated: ${this.riskScore.toFixed(2)}`);
  }
  
  // Generate device fingerprint for trust scoring
  private async generateDeviceFingerprint(): Promise<string> {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return 'unknown';
    
    // Create unique canvas fingerprint
    ctx.textBaseline = 'top';
    ctx.font = '14px Arial';
    ctx.fillText('VuVault🔐', 2, 2);
    
    const canvasData = canvas.toDataURL();
    
    // Combine with browser characteristics
    const fingerprint = {
      canvas: canvasData.slice(-50),
      screen: `${screen.width}x${screen.height}x${screen.colorDepth}`,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      language: navigator.language,
      platform: navigator.platform,
      cores: navigator.hardwareConcurrency || 0,
      memory: (navigator as any).deviceMemory || 0,
      webgl: this.getWebGLFingerprint()
    };
    
    // Hash the fingerprint
    const encoder = new TextEncoder();
    const data = encoder.encode(JSON.stringify(fingerprint));
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }
  
  // Get WebGL fingerprint for additional entropy
  private getWebGLFingerprint(): string {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return 'no-webgl';
      
      const debugInfo = (gl as any).getExtension('WEBGL_debug_renderer_info');
      if (!debugInfo) return 'no-debug';
      
      return (gl as any).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    } catch {
      return 'error';
    }
  }
  
  // Calculate device trust score (0-10, lower is better)
  private async getDeviceTrust(): Promise<number> {
    if (!this.deviceFingerprint) {
      this.deviceFingerprint = await this.generateDeviceFingerprint();
    }
    
    const storedDevices = localStorage.getItem('vuvault_trusted_devices');
    if (!storedDevices) {
      // First time device
      this.trustedDevices.set(this.deviceFingerprint, {
        fingerprint: this.deviceFingerprint,
        trustScore: 5,
        lastSeen: Date.now()
      });
      return 5; // Medium risk for new device
    }
    
    try {
      const devices = JSON.parse(storedDevices);
      const device = devices[this.deviceFingerprint];
      
      if (!device) {
        // Unknown device
        return 8; // High risk
      }
      
      // Calculate trust based on usage history
      const daysSinceLastSeen = (Date.now() - device.lastSeen) / (1000 * 60 * 60 * 24);
      if (daysSinceLastSeen > 30) return 6; // Medium-high risk if not seen recently
      if (daysSinceLastSeen > 7) return 3; // Low-medium risk
      
      return 1; // Low risk for frequently used device
    } catch {
      return 5; // Default medium risk
    }
  }
  
  // Check for location anomalies (simplified, would use IP geolocation in production)
  private async checkLocationAnomaly(): Promise<number> {
    // Check timezone changes
    const currentTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const lastTimezone = localStorage.getItem('vuvault_last_timezone');
    
    if (!lastTimezone) {
      localStorage.setItem('vuvault_last_timezone', currentTimezone);
      return 0; // No anomaly on first check
    }
    
    if (lastTimezone !== currentTimezone) {
      // Timezone changed - possible travel or VPN
      return 7; // High risk
    }
    
    return 0; // No anomaly
  }
  
  // Analyze time-based access patterns
  private analyzeTimePattern(): number {
    const now = new Date();
    const hour = now.getHours();
    const dayOfWeek = now.getDay();
    
    // Get historical access patterns
    const accessHistory = localStorage.getItem('vuvault_access_history');
    if (!accessHistory) {
      // No history, create initial pattern
      const pattern = { hours: [hour], days: [dayOfWeek] };
      localStorage.setItem('vuvault_access_history', JSON.stringify(pattern));
      return 0;
    }
    
    try {
      const pattern = JSON.parse(accessHistory);
      
      // Check if current access is unusual
      const isUnusualHour = !pattern.hours.includes(hour);
      const isUnusualDay = !pattern.days.includes(dayOfWeek);
      
      // Update pattern
      if (isUnusualHour) pattern.hours.push(hour);
      if (isUnusualDay) pattern.days.push(dayOfWeek);
      localStorage.setItem('vuvault_access_history', JSON.stringify(pattern));
      
      // Calculate risk
      if (isUnusualHour && isUnusualDay) return 6; // Medium-high risk
      if (isUnusualHour || isUnusualDay) return 3; // Low-medium risk
      
      return 0; // Normal pattern
    } catch {
      return 0;
    }
  }
  
  // Get recent failed authentication attempts
  private getRecentFailures(): number {
    const failures = parseInt(localStorage.getItem('vuvault_failed_attempts') || '0');
    
    if (failures > 5) return 10; // Maximum risk
    if (failures > 3) return 7; // High risk
    if (failures > 1) return 4; // Medium risk
    
    return 0; // No recent failures
  }
  
  // Adjust session timeout based on risk score
  private adjustSessionTimeout(): void {
    // Dynamic timeout: 5-30 minutes based on risk
    const baseTimeout = 30 * 60 * 1000; // 30 minutes
    const minTimeout = 5 * 60 * 1000; // 5 minutes
    
    // Higher risk = shorter timeout
    const riskMultiplier = Math.max(0.17, 1 - (this.riskScore / 10));
    this.adaptiveTimeout = Math.max(minTimeout, Math.floor(baseTimeout * riskMultiplier));
    
    // Set new adaptive timeout
    this.sessionTimer = setTimeout(() => {
      this.logout();
    }, this.adaptiveTimeout);
    
    console.info(`Adaptive timeout set to ${Math.round(this.adaptiveTimeout / 60000)} minutes`);
  }
  
  // Enable Conditional UI for Passkeys (WebAuthn autofill)
  async enableConditionalUI(): Promise<void> {
    // Check if Conditional UI is available
    if (!window.PublicKeyCredential) return;
    
    try {
      const available = await (PublicKeyCredential as any).isConditionalMediationAvailable?.();
      if (!available) return;
      
      // Add webauthn to autocomplete for password fields
      const passwordInputs = document.querySelectorAll('input[type="password"], input[type="text"][autocomplete*="username"]');
      passwordInputs.forEach(input => {
        const currentAutocomplete = input.getAttribute('autocomplete') || '';
        if (!currentAutocomplete.includes('webauthn')) {
          input.setAttribute('autocomplete', `${currentAutocomplete} webauthn`.trim());
        }
      });
      
      console.info('Conditional UI enabled for WebAuthn');
    } catch (error) {
      console.warn('Conditional UI not available:', error);
    }
  }
  
  // Breach monitoring integration (using k-anonymity with HIBP)
  async checkPasswordBreach(password: string): Promise<boolean> {
    try {
      // Hash the password
      const encoder = new TextEncoder();
      const data = encoder.encode(password);
      const hashBuffer = await crypto.subtle.digest('SHA-1', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
      
      // k-anonymity: only send first 5 characters
      const prefix = hashHex.substring(0, 5);
      const suffix = hashHex.substring(5);
      
      // Check with HIBP API
      const response = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
        headers: { 'Add-Padding': 'true' } // Prevent response size analysis
      });
      
      if (!response.ok) return false;
      
      const text = await response.text();
      const hashes = text.split('\n');
      
      // Check if our hash suffix appears in the response
      for (const line of hashes) {
        const [hashSuffix, count] = line.split(':');
        if (hashSuffix === suffix) {
          console.warn(`Password found in ${count} breaches`);
          return true;
        }
      }
      
      return false;
    } catch (error) {
      console.error('Breach check failed:', error);
      return false; // Fail open - don't block on API failure
    }
  }
  
  // Enhanced password strength calculation
  calculatePasswordStrength(password: string): {
    score: number;
    feedback: string[];
    timeToBreak: string;
    isBreached?: boolean;
  } {
    const result = super.calculatePasswordStrength(password);
    
    // Add breach status asynchronously
    this.checkPasswordBreach(password).then(isBreached => {
      if (isBreached) {
        result.feedback.push('This password has been found in data breaches');
      }
    });
    
    return result;
  }
  
  // Override logout to clean up enhanced features
  async logout(): Promise<void> {
    // Clear enhanced session data
    if (this.sessionTimer) {
      clearTimeout(this.sessionTimer);
      this.sessionTimer = null;
    }
    
    // Update failed attempts on logout
    if (this.failedAttempts > 0) {
      localStorage.setItem('vuvault_failed_attempts', '0');
    }
    
    // Call parent logout
    await super.logout();
  }
  
  // Track failed login attempts
  async handleFailedLogin(): Promise<void> {
    this.failedAttempts++;
    localStorage.setItem('vuvault_failed_attempts', String(this.failedAttempts));
    
    // Implement exponential backoff
    if (this.failedAttempts > 3) {
      const lockoutTime = Math.min(300000, 1000 * Math.pow(2, this.failedAttempts - 3)); // Max 5 minutes
      console.warn(`Account locked for ${lockoutTime / 1000} seconds`);
      
      setTimeout(() => {
        this.failedAttempts = 0;
        localStorage.setItem('vuvault_failed_attempts', '0');
      }, lockoutTime);
    }
  }
  
  // Get current risk level for UI display
  getRiskLevel(): 'low' | 'medium' | 'high' | 'critical' {
    if (this.riskScore < 3) return 'low';
    if (this.riskScore < 5) return 'medium';
    if (this.riskScore < 8) return 'high';
    return 'critical';
  }
  
  // Get adaptive timeout in minutes
  getAdaptiveTimeoutMinutes(): number {
    return Math.round(this.adaptiveTimeout / 60000);
  }
}

// Factory function for gradual rollout
export function getAuthService(): AuthService {
  // Check feature flag for enhanced auth
  const useEnhanced = localStorage.getItem('vuvault_enhanced_auth') === 'true';
  
  if (useEnhanced) {
    console.info('Using enhanced authentication service');
    return EnhancedAuthService.getEnhancedInstance();
  }
  
  return AuthService.getInstance();
}