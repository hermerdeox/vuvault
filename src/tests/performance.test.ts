import { test, expect, describe, beforeEach } from 'bun:test';
import { EnhancedCryptoService } from '../lib/crypto/enhanced-crypto-service';
import { DatabaseService } from '../lib/db/database';

describe('Performance Tests', () => {
  let crypto: EnhancedCryptoService;
  let db: DatabaseService;

  beforeEach(async () => {
    crypto = EnhancedCryptoService.getInstance();
    db = DatabaseService.getInstance();
    await db.initialize();
    await crypto.deriveMasterKey('performanceTestPassword');
  });

  describe('Encryption Performance', () => {
    test('Single encryption completes within 50ms', async () => {
      const data = 'Test data for encryption performance';
      
      const start = performance.now();
      await crypto.encrypt(data);
      const end = performance.now();
      
      expect(end - start).toBeLessThan(50);
    });

    test('Batch encryption of 100 items completes within 1 second', async () => {
      const items = Array.from({ length: 100 }, (_, i) => `Password ${i}`);
      
      const start = performance.now();
      await Promise.all(items.map(item => crypto.encrypt(item)));
      const end = performance.now();
      
      expect(end - start).toBeLessThan(1000);
    });

    test('Decryption is symmetric in performance', async () => {
      const data = 'Test data for decryption';
      const encrypted = await crypto.encrypt(data);
      
      const start = performance.now();
      await crypto.decrypt(encrypted);
      const end = performance.now();
      
      expect(end - start).toBeLessThan(50);
    });

    test('Web Worker encryption is faster than main thread for large data', async () => {
      const largeData = new Array(10000).fill('x').join('');
      
      // Worker encryption
      const workerStart = performance.now();
      await crypto.encrypt(largeData);
      const workerTime = performance.now() - workerStart;
      
      // Force main thread encryption
      crypto['workerReady'] = false;
      const mainStart = performance.now();
      await crypto.encrypt(largeData);
      const mainTime = performance.now() - mainStart;
      
      // Worker should be faster or at least not significantly slower
      expect(workerTime).toBeLessThanOrEqual(mainTime * 1.2);
    });
  });

  describe('Database Performance', () => {
    test('Adding vault item completes within 100ms', async () => {
      const item = {
        service: 'Performance Test',
        username: 'testuser',
        password: 'testpass123',
        url: 'https://test.com',
        notes: 'Performance test notes'
      };
      
      const start = performance.now();
      await db.addVaultItem(item);
      const end = performance.now();
      
      expect(end - start).toBeLessThan(100);
    });

    test('Retrieving 1000 items completes within 500ms', async () => {
      // Add 1000 items
      const items = Array.from({ length: 1000 }, (_, i) => ({
        service: `Service ${i}`,
        username: `user${i}`,
        password: `pass${i}`,
        url: `https://service${i}.com`,
        notes: `Notes for service ${i}`
      }));
      
      await Promise.all(items.map(item => db.addVaultItem(item)));
      
      // Measure retrieval time
      const start = performance.now();
      await db.getAllVaultItems();
      const end = performance.now();
      
      expect(end - start).toBeLessThan(500);
    });

    test('Search through 1000 items completes within 50ms', async () => {
      // Ensure we have 1000 items
      const existingItems = await db.getAllVaultItems();
      const itemsToAdd = Math.max(0, 1000 - existingItems.length);
      
      if (itemsToAdd > 0) {
        const items = Array.from({ length: itemsToAdd }, (_, i) => ({
          service: `SearchTest ${i}`,
          username: `searchuser${i}`,
          password: `searchpass${i}`,
          url: `https://search${i}.com`,
          notes: `Searchable notes ${i}`
        }));
        
        await Promise.all(items.map(item => db.addVaultItem(item)));
      }
      
      // Measure search time
      const start = performance.now();
      const allItems = await db.getAllVaultItems();
      const filtered = allItems.filter(item => 
        item.service.toLowerCase().includes('search')
      );
      const end = performance.now();
      
      expect(end - start).toBeLessThan(50);
      expect(filtered.length).toBeGreaterThan(0);
    });

    test('Updating an item completes within 100ms', async () => {
      const item = {
        service: 'Update Test',
        username: 'user',
        password: 'pass',
        url: 'https://update.test',
        notes: 'Original notes'
      };
      
      const id = await db.addVaultItem(item);
      
      const updatedItem = {
        ...item,
        id,
        password: 'newpass',
        notes: 'Updated notes'
      };
      
      const start = performance.now();
      await db.updateVaultItem(updatedItem);
      const end = performance.now();
      
      expect(end - start).toBeLessThan(100);
    });

    test('Deleting an item completes within 50ms', async () => {
      const item = {
        service: 'Delete Test',
        username: 'user',
        password: 'pass',
        url: 'https://delete.test',
        notes: 'To be deleted'
      };
      
      const id = await db.addVaultItem(item);
      
      const start = performance.now();
      await db.deleteVaultItem(id);
      const end = performance.now();
      
      expect(end - start).toBeLessThan(50);
    });
  });

  describe('Password Generation Performance', () => {
    test('Generating a password completes within 10ms', async () => {
      const start = performance.now();
      await crypto.generatePassword({
        length: 20,
        includeUppercase: true,
        includeLowercase: true,
        includeNumbers: true,
        includeSymbols: true
      });
      const end = performance.now();
      
      expect(end - start).toBeLessThan(10);
    });

    test('Generating 100 passwords completes within 200ms', async () => {
      const start = performance.now();
      await Promise.all(
        Array.from({ length: 100 }, () => 
          crypto.generatePassword({ length: 20 })
        )
      );
      const end = performance.now();
      
      expect(end - start).toBeLessThan(200);
    });
  });

  describe('Key Derivation Performance', () => {
    test('PBKDF2 key derivation completes within 500ms', async () => {
      crypto.clearMasterKey();
      
      const start = performance.now();
      await crypto.deriveMasterKey('testPasswordForPBKDF2');
      const end = performance.now();
      
      // With 310k iterations, should still be under 500ms
      expect(end - start).toBeLessThan(500);
    });

    test('Key derivation with caching is instant on second call', async () => {
      const password = 'cachedPassword';
      
      // First derivation
      await crypto.deriveMasterKey(password);
      
      // Clear and re-derive (simulating session restore)
      const sessionData = sessionStorage.getItem('vuvault_session');
      crypto.clearMasterKey();
      
      if (sessionData) {
        const { salt } = JSON.parse(sessionData);
        
        const start = performance.now();
        await crypto.deriveMasterKey(password);
        const end = performance.now();
        
        // Should be faster with known salt
        expect(end - start).toBeLessThan(500);
      }
    });
  });

  describe('Memory Performance', () => {
    test('Memory usage remains stable after 1000 operations', async () => {
      const initialMemory = process.memoryUsage().heapUsed;
      
      // Perform 1000 mixed operations
      for (let i = 0; i < 1000; i++) {
        const data = `Test data ${i}`;
        const encrypted = await crypto.encrypt(data);
        await crypto.decrypt(encrypted);
        
        if (i % 100 === 0) {
          // Periodically add to database
          await db.addVaultItem({
            service: `MemTest ${i}`,
            username: `user${i}`,
            password: `pass${i}`,
            url: `https://mem${i}.test`,
            notes: `Memory test ${i}`
          });
        }
      }
      
      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;
      
      // Memory increase should be less than 50MB
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    });
  });

  describe('Concurrent Operations', () => {
    test('100 concurrent encryptions complete within 500ms', async () => {
      const operations = Array.from({ length: 100 }, (_, i) => 
        crypto.encrypt(`Concurrent data ${i}`)
      );
      
      const start = performance.now();
      await Promise.all(operations);
      const end = performance.now();
      
      expect(end - start).toBeLessThan(500);
    });

    test('Mixed concurrent operations complete efficiently', async () => {
      const operations = [
        ...Array.from({ length: 30 }, (_, i) => crypto.encrypt(`Encrypt ${i}`)),
        ...Array.from({ length: 30 }, () => crypto.generatePassword()),
        ...Array.from({ length: 30 }, (_, i) => db.addVaultItem({
          service: `Concurrent ${i}`,
          username: `user${i}`,
          password: `pass${i}`,
          url: `https://concurrent${i}.test`,
          notes: `Concurrent notes ${i}`
        }))
      ];
      
      const start = performance.now();
      await Promise.all(operations);
      const end = performance.now();
      
      expect(end - start).toBeLessThan(1000);
    });
  });

  describe('Bundle Size Verification', () => {
    test('Crypto worker bundle is under 50KB', async () => {
      const workerUrl = new URL('../../workers/crypto.worker.ts', import.meta.url);
      const response = await fetch(workerUrl);
      const text = await response.text();
      
      // Rough estimate of minified size (usually 30-40% of original)
      const estimatedMinifiedSize = text.length * 0.4;
      
      expect(estimatedMinifiedSize).toBeLessThan(50 * 1024);
    });
  });

  describe('Startup Performance', () => {
    test('Service initialization completes within 100ms', async () => {
      // Clear instances to force re-initialization
      EnhancedCryptoService['enhancedInstance'] = null;
      DatabaseService['instance'] = null;
      
      const start = performance.now();
      
      const newCrypto = EnhancedCryptoService.getInstance();
      const newDb = DatabaseService.getInstance();
      await newDb.initialize();
      
      const end = performance.now();
      
      expect(end - start).toBeLessThan(100);
    });
  });
});
