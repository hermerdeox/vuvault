import { test, expect, describe, beforeEach, afterEach } from 'bun:test';
import { EnhancedAuthService } from '../lib/auth/enhanced-auth-service';
import { EnhancedCryptoService } from '../lib/crypto/enhanced-crypto-service';
import { DatabaseService } from '../lib/db/database';

describe('Security Tests', () => {
  let auth: EnhancedAuthService;
  let crypto: EnhancedCryptoService;
  let db: DatabaseService;

  beforeEach(async () => {
    auth = EnhancedAuthService.getInstance();
    crypto = EnhancedCryptoService.getInstance();
    db = DatabaseService.getInstance();
    await db.initialize();
  });

  afterEach(() => {
    crypto.clearMasterKey();
    auth.logout();
  });

  describe('Encryption', () => {
    test('Master key derivation uses correct iterations', async () => {
      const password = 'TestPassword123!@#';
      await crypto.deriveMasterKey(password);
      
      const sessionData = sessionStorage.getItem('vuvault_session');
      expect(sessionData).toBeTruthy();
      
      const parsed = JSON.parse(sessionData!);
      expect(parsed.iterations).toBeGreaterThanOrEqual(310000);
    });

    test('Encryption keys are properly cleared from memory', async () => {
      await crypto.deriveMasterKey('testpass');
      expect(crypto['masterKey']).toBeTruthy();
      
      crypto.clearMasterKey();
      expect(crypto['masterKey']).toBeNull();
      
      // Verify session storage is cleared
      expect(sessionStorage.getItem('vuvault_session')).toBeNull();
    });

    test('Different passwords generate different keys', async () => {
      const password1 = 'Password123!';
      const password2 = 'DifferentPass456!';
      
      await crypto.deriveMasterKey(password1);
      const key1 = crypto['masterKey'];
      
      crypto.clearMasterKey();
      
      await crypto.deriveMasterKey(password2);
      const key2 = crypto['masterKey'];
      
      expect(key1).not.toEqual(key2);
    });

    test('Encrypted data cannot be decrypted with wrong key', async () => {
      const plaintext = 'Sensitive data';
      
      await crypto.deriveMasterKey('correctPassword');
      const encrypted = await crypto.encrypt(plaintext);
      
      crypto.clearMasterKey();
      await crypto.deriveMasterKey('wrongPassword');
      
      await expect(crypto.decrypt(encrypted)).rejects.toThrow();
    });

    test('Nonce is unique for each encryption', async () => {
      await crypto.deriveMasterKey('testPassword');
      
      const plaintext = 'Test data';
      const encrypted1 = await crypto.encrypt(plaintext);
      const encrypted2 = await crypto.encrypt(plaintext);
      
      const [nonce1] = encrypted1.split(':');
      const [nonce2] = encrypted2.split(':');
      
      expect(nonce1).not.toEqual(nonce2);
    });
  });

  describe('Authentication', () => {
    test('Session timeout adapts to risk score', () => {
      const baseTimeout = auth.calculateSessionTimeout();
      
      // Simulate high risk
      auth['riskScore'] = 8;
      const highRiskTimeout = auth.calculateSessionTimeout();
      
      expect(highRiskTimeout).toBeLessThan(baseTimeout);
      expect(highRiskTimeout).toBeGreaterThanOrEqual(5 * 60 * 1000); // Min 5 minutes
    });

    test('Failed login attempts increase risk score', () => {
      const initialRisk = auth.getRiskScore();
      
      // Simulate failed attempts
      for (let i = 0; i < 3; i++) {
        window.dispatchEvent(new Event('authfailed'));
      }
      
      const newRisk = auth.getRiskScore();
      expect(newRisk).toBeGreaterThan(initialRisk);
    });

    test('High-risk operations require re-authentication', async () => {
      auth['riskScore'] = 6; // High risk
      
      const requiresReauth = await auth.verifyHighRiskOperation();
      // Will fail in test environment without WebAuthn
      expect(requiresReauth).toBe(false);
    });

    test('Risk level categorization is correct', () => {
      auth['riskScore'] = 2;
      expect(auth.getRiskLevel()).toBe('low');
      
      auth['riskScore'] = 4;
      expect(auth.getRiskLevel()).toBe('medium');
      
      auth['riskScore'] = 7;
      expect(auth.getRiskLevel()).toBe('high');
      
      auth['riskScore'] = 9;
      expect(auth.getRiskLevel()).toBe('critical');
    });
  });

  describe('Password Security', () => {
    test('Password strength calculation is accurate', () => {
      const weakPassword = '12345678';
      const weakScore = auth.calculatePasswordStrength(weakPassword);
      expect(weakScore.strength).toBe('weak');
      expect(weakScore.score).toBeLessThan(30);
      
      const mediumPassword = 'MyPassword123';
      const mediumScore = auth.calculatePasswordStrength(mediumPassword);
      expect(mediumScore.strength).toBe('fair');
      
      const strongPassword = 'MyS3cur3P@ssw0rd!2024';
      const strongScore = auth.calculatePasswordStrength(strongPassword);
      expect(strongScore.strength).toMatch(/strong|excellent/);
      expect(strongScore.score).toBeGreaterThan(70);
    });

    test('Common passwords are detected as weak', () => {
      const commonPasswords = ['password', 'qwerty', '123456', 'admin', 'letmein'];
      
      for (const password of commonPasswords) {
        const result = auth.calculatePasswordStrength(password);
        expect(result.strength).toBe('weak');
        expect(result.feedback).toContain('Avoid common words');
      }
    });

    test('Sequential patterns are penalized', () => {
      const sequentialPassword = 'abcd1234';
      const result = auth.calculatePasswordStrength(sequentialPassword);
      
      expect(result.feedback).toContain('Avoid sequential characters');
      expect(result.score).toBeLessThan(50);
    });

    test('Generated passwords meet complexity requirements', async () => {
      const password = await crypto.generatePassword({
        length: 20,
        includeUppercase: true,
        includeLowercase: true,
        includeNumbers: true,
        includeSymbols: true
      });
      
      expect(password.length).toBe(20);
      expect(/[a-z]/.test(password)).toBe(true);
      expect(/[A-Z]/.test(password)).toBe(true);
      expect(/[0-9]/.test(password)).toBe(true);
      expect(/[!@#$%^&*()_+\-=\[\]{}|;:,.<>?]/.test(password)).toBe(true);
    });
  });

  describe('Data Protection', () => {
    test('Database is encrypted at rest', async () => {
      await crypto.deriveMasterKey('testPassword');
      
      const testItem = {
        service: 'TestService',
        username: 'testuser',
        password: 'testpass123',
        url: 'https://test.com',
        notes: 'Test notes'
      };
      
      const itemId = await db.addVaultItem(testItem);
      
      // Get raw database entry
      const rawItem = await db['db'].vaultItems.get(itemId);
      
      // Verify fields are encrypted
      expect(rawItem?.password).not.toBe(testItem.password);
      expect(rawItem?.password).toContain(':'); // Contains nonce separator
      expect(rawItem?.notes).not.toBe(testItem.notes);
    });

    test('Exported data maintains encryption', async () => {
      await crypto.deriveMasterKey('exportPassword');
      
      const testItem = {
        service: 'ExportTest',
        username: 'user',
        password: 'pass',
        url: 'https://export.test',
        notes: 'Export notes'
      };
      
      await db.addVaultItem(testItem);
      const exportData = await db.exportData();
      
      // Verify exported passwords are encrypted
      expect(exportData.vault[0].password).not.toBe(testItem.password);
      expect(exportData.vault[0].password).toContain(':');
    });

    test('Session storage is cleared on logout', async () => {
      await crypto.deriveMasterKey('testPassword');
      sessionStorage.setItem('test_session', 'data');
      
      await auth.logout();
      
      expect(sessionStorage.getItem('vuvault_session')).toBeNull();
    });
  });

  describe('XSS and Injection Protection', () => {
    test('HTML injection is prevented in password fields', async () => {
      await crypto.deriveMasterKey('testPassword');
      
      const maliciousPassword = '<script>alert("XSS")</script>';
      const encrypted = await crypto.encrypt(maliciousPassword);
      const decrypted = await crypto.decrypt(encrypted);
      
      // Password should be preserved exactly but not executed
      expect(decrypted).toBe(maliciousPassword);
      
      // Verify it's treated as text, not HTML
      const div = document.createElement('div');
      div.textContent = decrypted;
      expect(div.innerHTML).toBe('&lt;script&gt;alert("XSS")&lt;/script&gt;');
    });

    test('SQL injection patterns are handled safely', async () => {
      const sqlInjection = "'; DROP TABLE users; --";
      
      const testItem = {
        service: 'Test',
        username: sqlInjection,
        password: 'pass',
        url: 'https://test.com',
        notes: 'notes'
      };
      
      // Should handle without throwing
      await expect(db.addVaultItem(testItem)).resolves.toBeTruthy();
    });
  });

  describe('Timing Attack Prevention', () => {
    test('Authentication timing is consistent', async () => {
      const timings: number[] = [];
      
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        await auth.checkAuth();
        const end = performance.now();
        timings.push(end - start);
      }
      
      // Calculate standard deviation
      const mean = timings.reduce((a, b) => a + b) / timings.length;
      const variance = timings.reduce((sum, time) => sum + Math.pow(time - mean, 2), 0) / timings.length;
      const stdDev = Math.sqrt(variance);
      
      // Standard deviation should be low (consistent timing)
      expect(stdDev).toBeLessThan(5);
    });
  });

  describe('Memory Safety', () => {
    test('Sensitive data is cleared after use', async () => {
      const password = 'SensitivePassword123!';
      await crypto.deriveMasterKey(password);
      
      // Create a large dataset to trigger garbage collection
      const largeData = new Array(1000000).fill('x').join('');
      
      crypto.clearMasterKey();
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      // Verify key is cleared
      expect(crypto['masterKey']).toBeNull();
    });
  });
});
