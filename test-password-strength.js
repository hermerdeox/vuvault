// Simulating the password strength calculation
function calculatePasswordStrength(password) {
    const feedback = [];
    let score = 0;

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

    return { score: Math.min(100, score), feedback };
}

// Test with a generated password sample
const testPassword = "Kj9#mP2$nL5@wQ8&xR3!";
const result = calculatePasswordStrength(testPassword);
console.log("Password:", testPassword);
console.log("Length:", testPassword.length);
console.log("Score:", result.score);
console.log("Feedback:", result.feedback);
console.log("Strength:", result.score >= 80 ? 'STRONG' : result.score >= 50 ? 'MEDIUM' : 'WEAK');

// Breaking down the score
console.log("\nScore breakdown:");
console.log("- Length (20 chars, >=12):", 25);
console.log("- Has lowercase:", 15);
console.log("- Has uppercase:", 15);
console.log("- Has numbers:", 15);
console.log("- Has special chars:", 20);
console.log("- No repeated chars:", 10);
console.log("- Not common password:", 10);
console.log("Total (max 100):", 25+15+15+15+20+10+10);
