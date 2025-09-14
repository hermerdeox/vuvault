// Enhanced Crypto Service with Web Worker Offloading
// Wraps existing crypto service with worker support for non-blocking operations
// Preserves all existing functionality with performance improvements

import { CryptoService } from './crypto-service';
import { randomBytes } from '@noble/hashes/utils';

interface WorkerRequest {
  id: string;
  type: string;
  payload: any;
}

interface WorkerResponse {
  id: string;
  type: 'SUCCESS' | 'ERROR' | 'PROGRESS';
  data?: any;
  error?: string;
  progress?: number;
}

export class EnhancedCryptoService extends CryptoService {
  private static enhancedInstance: EnhancedCryptoService;
  private worker?: Worker;
  private pendingRequests = new Map<string, {
    resolve: (value: any) => void;
    reject: (reason: any) => void;
    timeout: NodeJS.Timeout;
  }>();
  private workerReady = false;
  private messageQueue: WorkerRequest[] = [];
  
  private constructor() {
    super();
    this.initializeWorker();
  }
  
  static getEnhancedInstance(): EnhancedCryptoService {
    if (!EnhancedCryptoService.enhancedInstance) {
      EnhancedCryptoService.enhancedInstance = new EnhancedCryptoService();
    }
    return EnhancedCryptoService.enhancedInstance;
  }
  
  private async initializeWorker(): Promise<void> {
    try {
      // Check if Web Workers are supported
      if (typeof Worker === 'undefined') {
        console.info('Web Workers not supported, using main thread crypto');
        return;
      }
      
      // Create worker with proper module type
      this.worker = new Worker(
        new URL('../../workers/crypto.worker.ts', import.meta.url),
        { type: 'module' }
      );
      
      // Set up message handler
      this.worker.addEventListener('message', (event: MessageEvent<WorkerResponse>) => {
        this.handleWorkerMessage(event.data);
      });
      
      // Set up error handler
      this.worker.addEventListener('error', (error) => {
        console.error('Worker error:', error);
        this.fallbackToMainThread();
      });
      
      // Test worker with a simple operation
      await this.testWorker();
      this.workerReady = true;
      
      // Process any queued messages
      this.processMessageQueue();
      
      console.info('Crypto worker initialized successfully');
    } catch (error) {
      console.warn('Failed to initialize crypto worker, falling back to main thread:', error);
      this.fallbackToMainThread();
    }
  }
  
  private async testWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      const testId = this.generateRequestId();
      const timeout = setTimeout(() => {
        reject(new Error('Worker test timeout'));
      }, 5000);
      
      this.pendingRequests.set(testId, {
        resolve: () => {
          clearTimeout(timeout);
          resolve();
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        timeout
      });
      
      this.worker?.postMessage({
        id: testId,
        type: 'HASH',
        payload: { data: 'test', algorithm: 'SHA-256' }
      });
    });
  }
  
  private handleWorkerMessage(response: WorkerResponse): void {
    const pending = this.pendingRequests.get(response.id);
    if (!pending) return;
    
    clearTimeout(pending.timeout);
    this.pendingRequests.delete(response.id);
    
    if (response.type === 'SUCCESS') {
      pending.resolve(response.data);
    } else if (response.type === 'ERROR') {
      pending.reject(new Error(response.error || 'Worker operation failed'));
    } else if (response.type === 'PROGRESS') {
      // Handle progress updates for batch operations
      console.info(`Operation ${response.id}: ${response.progress}% complete`);
    }
  }
  
  private fallbackToMainThread(): void {
    // Clear worker and pending requests
    this.worker?.terminate();
    this.worker = undefined;
    this.workerReady = false;
    
    // Reject all pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Worker unavailable, please retry'));
    }
    this.pendingRequests.clear();
  }
  
  private generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  
  private processMessageQueue(): void {
    while (this.messageQueue.length > 0 && this.workerReady) {
      const message = this.messageQueue.shift();
      if (message) {
        this.worker?.postMessage(message);
      }
    }
  }
  
  private async sendToWorker<T>(type: string, payload: any, timeoutMs = 10000): Promise<T> {
    // If no worker, fall back to main thread
    if (!this.worker) {
      return this.fallbackOperation(type, payload);
    }
    
    return new Promise((resolve, reject) => {
      const id = this.generateRequestId();
      
      // Set timeout for worker response
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Worker operation timeout: ${type}`));
      }, timeoutMs);
      
      // Store pending request
      this.pendingRequests.set(id, { resolve, reject, timeout });
      
      const message: WorkerRequest = { id, type, payload };
      
      // Queue or send message
      if (this.workerReady) {
        this.worker.postMessage(message);
      } else {
        this.messageQueue.push(message);
      }
    });
  }
  
  private async fallbackOperation(type: string, payload: any): Promise<any> {
    // Fallback to main thread operations
    switch (type) {
      case 'DERIVE_KEY':
        return super.deriveMasterKey(payload.password, payload.salt);
        
      case 'ENCRYPT':
        return super.encryptData(payload.data, payload.key);
        
      case 'DECRYPT':
        return super.decryptData(payload.encrypted, payload.nonce, payload.key);
        
      case 'GENERATE_PASSWORD':
        return super.generatePassword(payload.length, payload);
        
      case 'HASH':
        const encoder = new TextEncoder();
        const data = encoder.encode(payload.data);
        const hashBuffer = await crypto.subtle.digest(payload.algorithm || 'SHA-256', data);
        return new Uint8Array(hashBuffer);
        
      default:
        throw new Error(`Unknown operation: ${type}`);
    }
  }
  
  // Override parent methods to use worker when available
  
  async deriveMasterKey(password: string, salt?: Uint8Array): Promise<{ key: Uint8Array; salt: Uint8Array }> {
    try {
      if (this.worker) {
        const result = await this.sendToWorker<any>('DERIVE_KEY', {
          password,
          salt: salt ? Array.from(salt) : undefined
        }, 30000); // 30 second timeout for key derivation
        
        return {
          key: new Uint8Array(result.key),
          salt: new Uint8Array(result.salt)
        };
      }
    } catch (error) {
      console.warn('Worker key derivation failed, using main thread:', error);
    }
    
    // Fallback to parent implementation
    return super.deriveMasterKey(password, salt);
  }
  
  async encryptData(data: string, key?: Uint8Array): Promise<{ encrypted: Uint8Array; nonce: Uint8Array }> {
    try {
      if (this.worker) {
        const result = await this.sendToWorker<any>('ENCRYPT', {
          data,
          key: key ? Array.from(key) : undefined
        });
        
        return {
          encrypted: new Uint8Array(result.encrypted),
          nonce: new Uint8Array(result.nonce)
        };
      }
    } catch (error) {
      console.warn('Worker encryption failed, using main thread:', error);
    }
    
    // Fallback to parent implementation
    return super.encryptData(data, key);
  }
  
  async decryptData(encrypted: Uint8Array, nonce: Uint8Array, key?: Uint8Array): Promise<string> {
    try {
      if (this.worker) {
        return await this.sendToWorker<string>('DECRYPT', {
          encrypted: Array.from(encrypted),
          nonce: Array.from(nonce),
          key: key ? Array.from(key) : undefined
        });
      }
    } catch (error) {
      console.warn('Worker decryption failed, using main thread:', error);
    }
    
    // Fallback to parent implementation
    return super.decryptData(encrypted, nonce, key);
  }
  
  generatePassword(length: number = 20, options: any = {}): string {
    // Password generation is fast enough for main thread
    // But we can still offload if worker is available
    if (this.worker && this.workerReady) {
      // Fire and forget for instant response
      this.sendToWorker('GENERATE_PASSWORD', { length, ...options })
        .then(password => {
          // Could cache this for future use
          console.debug('Password generated in worker');
        })
        .catch(() => {
          // Ignore errors for async generation
        });
    }
    
    // Always return immediately from main thread
    return super.generatePassword(length, options);
  }
  
  // New method for batch operations
  async batchEncrypt(items: string[], key?: Uint8Array): Promise<Array<{ encrypted: Uint8Array; nonce: Uint8Array }>> {
    if (this.worker && items.length > 10) {
      // Use worker for large batches
      try {
        const result = await this.sendToWorker<any[]>('BATCH_ENCRYPT', {
          items,
          key: key ? Array.from(key) : undefined
        }, 60000); // 60 second timeout for batch operations
        
        return result.map(item => ({
          encrypted: new Uint8Array(item.encrypted),
          nonce: new Uint8Array(item.nonce)
        }));
      } catch (error) {
        console.warn('Batch encryption failed in worker, using main thread:', error);
      }
    }
    
    // Fallback to sequential encryption
    const results = [];
    for (const item of items) {
      results.push(await this.encryptData(item, key));
    }
    return results;
  }
  
  async batchDecrypt(
    items: Array<{ encrypted: Uint8Array; nonce: Uint8Array }>,
    key?: Uint8Array
  ): Promise<string[]> {
    if (this.worker && items.length > 10) {
      // Use worker for large batches
      try {
        return await this.sendToWorker<string[]>('BATCH_DECRYPT', {
          items: items.map(item => ({
            encrypted: Array.from(item.encrypted),
            nonce: Array.from(item.nonce)
          })),
          key: key ? Array.from(key) : undefined
        }, 60000);
      } catch (error) {
        console.warn('Batch decryption failed in worker, using main thread:', error);
      }
    }
    
    // Fallback to sequential decryption
    const results = [];
    for (const item of items) {
      results.push(await this.decryptData(item.encrypted, item.nonce, key));
    }
    return results;
  }
  
  // Hash function for breach checking
  async hashPassword(password: string, algorithm = 'SHA-1'): Promise<{ prefix: string; suffix: string; full: string }> {
    try {
      if (this.worker) {
        const result = await this.sendToWorker<any>('HASH', {
          password,
          algorithm
        });
        
        return result;
      }
    } catch (error) {
      console.warn('Worker hashing failed, using main thread:', error);
    }
    
    // Fallback to main thread
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest(algorithm, data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
    
    return {
      full: hashHex,
      prefix: hashHex.substring(0, 5),
      suffix: hashHex.substring(5)
    };
  }
  
  // Clean up worker when service is destroyed
  destroy(): void {
    // Clear pending requests
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error('Service destroyed'));
    }
    this.pendingRequests.clear();
    
    // Terminate worker
    this.worker?.terminate();
    this.worker = undefined;
    
    // Clear master key
    this.clearMasterKey();
  }
  
  // Get worker status for monitoring
  getWorkerStatus(): {
    available: boolean;
    ready: boolean;
    pendingRequests: number;
    queuedMessages: number;
  } {
    return {
      available: !!this.worker,
      ready: this.workerReady,
      pendingRequests: this.pendingRequests.size,
      queuedMessages: this.messageQueue.length
    };
  }
}

// Factory function for gradual rollout
export function getCryptoService(): CryptoService {
  // Check feature flag for enhanced crypto
  const useEnhanced = localStorage.getItem('vuvault_web_workers') === 'true';
  
  if (useEnhanced) {
    console.info('Using enhanced crypto service with Web Workers');
    return EnhancedCryptoService.getEnhancedInstance();
  }
  
  return CryptoService.getInstance();
}