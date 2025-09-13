#!/usr/bin/env bun
// quickstart.js - One-command fix for EOXVault Zero

import { execSync } from 'child_process';
import fs from 'fs';

console.log('🚀 EOXVAULT ZERO QUICKSTART\n');

// Check if we're in the right directory
const currentDir = process.cwd();
const projectName = currentDir.split('/').pop();

console.log(`📍 Current directory: ${currentDir}`);
console.log(`📁 Project folder: ${projectName}`);

if (projectName !== 'eoxvault-zero') {
    console.log('\n❌ ERROR: You are not in the eoxvault-zero directory!');
    console.log('\n🔧 SOLUTION:');
    console.log('1. Navigate to the project directory:');
    console.log('   cd eoxvault-zero');
    console.log('2. Then run:');
    console.log('   bun run dev');
    process.exit(1);
}

// Verify package.json exists
if (!fs.existsSync('package.json')) {
    console.log('❌ package.json not found in current directory');
    process.exit(1);
}

console.log('✅ In correct directory');

// Check if node_modules exists
if (!fs.existsSync('node_modules')) {
    console.log('📦 Installing dependencies...');
    execSync('bun install', { stdio: 'inherit' });
}

console.log('✅ Dependencies ready');

// Run type check
console.log('🔍 Running type check...');
try {
    execSync('bun run type-check', { stdio: 'inherit' });
    console.log('✅ TypeScript compilation successful');
} catch (e) {
    console.log('⚠️ TypeScript errors found, but continuing...');
}

// Test build
console.log('🏗️ Testing build...');
try {
    execSync('bun run build', { stdio: 'inherit' });
    console.log('✅ Build successful');
} catch (e) {
    console.log('❌ Build failed');
    process.exit(1);
}

console.log('\n🎉 PROJECT IS READY!');
console.log('\n🚀 STARTING DEVELOPMENT SERVER...');
console.log('📱 Your app will be available at: http://localhost:3005');
console.log('\n⚡ Starting server now...\n');

// Start dev server
execSync('bun run dev', { stdio: 'inherit' });
