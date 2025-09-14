// Test the cryptanalytic time calculation
function calculatePasswordStrength(password) {
    const feedback = [];
    let score = 0;
    let charsetSize = 0;
    
    // Calculate charset size for entropy calculation
    if (/[a-z]/.test(password)) charsetSize += 26;
    if (/[A-Z]/.test(password)) charsetSize += 26;
    if (/[0-9]/.test(password)) charsetSize += 10;
    if (/[^a-zA-Z0-9]/.test(password)) charsetSize += 32;

    // Score calculation (same as before)
    if (password.length >= 12) score += 25;
    else if (password.length >= 8) score += 10;
    if (/[a-z]/.test(password)) score += 15;
    if (/[A-Z]/.test(password)) score += 15;
    if (/[0-9]/.test(password)) score += 15;
    if (/[^a-zA-Z0-9]/.test(password)) score += 20;
    if (!/(.)\1{2,}/.test(password)) score += 10;
    const commonPasswords = ['password', '123456', 'qwerty', 'admin', 'letmein'];
    if (!commonPasswords.some(common => password.toLowerCase().includes(common))) {
      score += 10;
    } else {
      score = Math.max(0, score - 20);
    }

    // Calculate entropy and time to break
    const entropy = password.length * Math.log2(charsetSize || 1);
    let timeToBreak;
    
    // Assuming 1 trillion (10^12) guesses per second with modern GPUs
    const guessesPerSecond = 1e12;
    const totalCombinations = Math.pow(2, entropy);
    const secondsToBreak = totalCombinations / (2 * guessesPerSecond);
    
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

// Test various passwords
const testPasswords = [
    "password",           // Weak
    "Password1",          // Medium
    "P@ssw0rd123!",      // Better
    "Kj9#mP2$nL5@wQ8&xR3!", // Strong (20 chars)
];

console.log("Password Strength Analysis with Cryptanalytic Time:\n");
testPasswords.forEach(pwd => {
    const result = calculatePasswordStrength(pwd);
    const charsetSize = 
        (/[a-z]/.test(pwd) ? 26 : 0) +
        (/[A-Z]/.test(pwd) ? 26 : 0) +
        (/[0-9]/.test(pwd) ? 10 : 0) +
        (/[^a-zA-Z0-9]/.test(pwd) ? 32 : 0);
    const entropy = pwd.length * Math.log2(charsetSize || 1);
    
    console.log(`Password: "${pwd}"`);
    console.log(`  Length: ${pwd.length} chars`);
    console.log(`  Charset Size: ${charsetSize}`);
    console.log(`  Entropy: ${entropy.toFixed(1)} bits`);
    console.log(`  Score: ${result.score}/100`);
    console.log(`  Cryptanalytic Time: ${result.timeToBreak}`);
    console.log("");
});
