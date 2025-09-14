export interface ValidationRule {
  test: (value: string) => boolean;
  message: string;
}

export interface FieldValidationRules {
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  pattern?: RegExp;
  custom?: ValidationRule[];
}

export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

export class FieldValidator {
  private static instance: FieldValidator;

  // Validation rules for different field types
  private readonly rules = {
    password: {
      minLength: 8,
      maxLength: 128,
      requireUppercase: true,
      requireLowercase: true,
      requireNumber: true,
      requireSpecial: true,
      specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?'
    },
    username: {
      minLength: 3,
      maxLength: 255,
      pattern: /^[a-zA-Z0-9._@+-]+$/
    },
    url: {
      pattern: /^(https?:\/\/)?([\da-z.-]+)\.([a-z.]{2,6})([\/\w .-]*)*\/?$/i
    },
    service: {
      minLength: 1,
      maxLength: 100
    }
  };

  private constructor() {}

  static getInstance(): FieldValidator {
    if (!FieldValidator.instance) {
      FieldValidator.instance = new FieldValidator();
    }
    return FieldValidator.instance;
  }

  /**
   * Validate a password field
   */
  validatePassword(value: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Required check
      if (!value) {
        errors.push('Password is required');
        return { isValid: false, errors, warnings };
      }

      // Length checks
      if (value.length < this.rules.password.minLength) {
        errors.push(`Minimum ${this.rules.password.minLength} characters required`);
      }
      if (value.length > this.rules.password.maxLength) {
        errors.push(`Maximum ${this.rules.password.maxLength} characters allowed`);
      }

      // Complexity checks
      if (this.rules.password.requireUppercase && !/[A-Z]/.test(value)) {
        warnings.push('Include at least one uppercase letter');
      }
      if (this.rules.password.requireLowercase && !/[a-z]/.test(value)) {
        warnings.push('Include at least one lowercase letter');
      }
      if (this.rules.password.requireNumber && !/\d/.test(value)) {
        warnings.push('Include at least one number');
      }
      if (this.rules.password.requireSpecial && !new RegExp(`[${this.escapeRegExp(this.rules.password.specialChars)}]`).test(value)) {
        warnings.push('Include at least one special character');
      }

      // Check for common weak passwords
      const weakPasswords = ['password', '123456', 'qwerty', 'admin', 'letmein', 'welcome'];
      if (weakPasswords.some(weak => value.toLowerCase().includes(weak))) {
        warnings.push('Password contains common weak patterns');
      }

      // Check for repeated characters
      if (/(.)\1{3,}/.test(value)) {
        warnings.push('Avoid repeated characters');
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings
      };
    } catch (error) {
      console.error('Password validation error:', error);
      return { isValid: true, errors: [], warnings: [] };
    }
  }

  /**
   * Validate a username field
   */
  validateUsername(value: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Required check
      if (!value) {
        errors.push('Username is required');
        return { isValid: false, errors, warnings };
      }

      // Length checks
      if (value.length < this.rules.username.minLength) {
        errors.push(`Minimum ${this.rules.username.minLength} characters required`);
      }
      if (value.length > this.rules.username.maxLength) {
        errors.push(`Maximum ${this.rules.username.maxLength} characters allowed`);
      }

      // Pattern check
      if (!this.rules.username.pattern.test(value)) {
        errors.push('Only letters, numbers, and ._@+- allowed');
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings
      };
    } catch (error) {
      console.error('Username validation error:', error);
      return { isValid: true, errors: [], warnings: [] };
    }
  }

  /**
   * Validate a URL field
   */
  validateUrl(value: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // URL is optional, so empty is valid
      if (!value) {
        return { isValid: true, errors: [], warnings: [] };
      }

      // Pattern check
      if (!this.rules.url.pattern.test(value)) {
        errors.push('Invalid URL format');
      }

      // Security warnings
      if (value.startsWith('http://')) {
        warnings.push('Consider using HTTPS for better security');
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings
      };
    } catch (error) {
      console.error('URL validation error:', error);
      return { isValid: true, errors: [], warnings: [] };
    }
  }

  /**
   * Validate a service name field
   */
  validateService(value: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    try {
      // Required check
      if (!value) {
        errors.push('Service name is required');
        return { isValid: false, errors, warnings };
      }

      // Length checks
      if (value.length < this.rules.service.minLength) {
        errors.push(`Service name cannot be empty`);
      }
      if (value.length > this.rules.service.maxLength) {
        errors.push(`Maximum ${this.rules.service.maxLength} characters allowed`);
      }

      return {
        isValid: errors.length === 0,
        errors,
        warnings
      };
    } catch (error) {
      console.error('Service validation error:', error);
      return { isValid: true, errors: [], warnings: [] };
    }
  }

  /**
   * Generic field validation
   */
  validateField(fieldName: string, value: string): ValidationResult {
    switch (fieldName.toLowerCase()) {
      case 'password':
        return this.validatePassword(value);
      case 'username':
      case 'email':
        return this.validateUsername(value);
      case 'url':
      case 'website':
        return this.validateUrl(value);
      case 'service':
      case 'name':
        return this.validateService(value);
      default:
        return { isValid: true, errors: [], warnings: [] };
    }
  }

  /**
   * Calculate password strength (0-100)
   */
  calculatePasswordStrength(password: string): number {
    if (!password) return 0;

    let strength = 0;
    
    // Length bonus
    strength += Math.min(password.length * 4, 40);
    
    // Complexity bonus
    if (/[a-z]/.test(password)) strength += 10;
    if (/[A-Z]/.test(password)) strength += 10;
    if (/\d/.test(password)) strength += 10;
    if (/[^a-zA-Z0-9]/.test(password)) strength += 20;
    
    // Variety bonus
    const uniqueChars = new Set(password).size;
    strength += Math.min(uniqueChars * 2, 20);
    
    // Penalties
    if (/(.)\1{3,}/.test(password)) strength -= 20; // Repeated characters
    if (password.length < 8) strength -= 20; // Too short
    
    return Math.max(0, Math.min(100, strength));
  }

  /**
   * Get strength label for password
   */
  getPasswordStrengthLabel(strength: number): { label: string; color: string } {
    if (strength >= 80) return { label: 'STRONG', color: 'text-green-500' };
    if (strength >= 60) return { label: 'GOOD', color: 'text-blue-500' };
    if (strength >= 40) return { label: 'FAIR', color: 'text-yellow-500' };
    if (strength >= 20) return { label: 'WEAK', color: 'text-orange-500' };
    return { label: 'VERY WEAK', color: 'text-red-500' };
  }

  /**
   * Utility: Escape special regex characters
   */
  private escapeRegExp(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  /**
   * Debounce function for input validation
   */
  debounce<T extends (...args: any[]) => any>(
    func: T,
    wait: number
  ): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout | null = null;
    
    return (...args: Parameters<T>) => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        func(...args);
      }, wait);
    };
  }
}
