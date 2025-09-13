#!/usr/bin/env bun
// diagnostic.js - Comprehensive EOXVault Zero Diagnostic

import fs from 'fs';
import path from 'path';

console.log('🔍 EOXVAULT ZERO COMPREHENSIVE DIAGNOSTIC\n');

// 1. Check package.json scripts
try {
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    console.log('📦 Package.json Scripts:');
    
    const requiredScripts = ['dev', 'build', 'preview', 'type-check'];
    requiredScripts.forEach(script => {
        if (pkg.scripts && pkg.scripts[script]) {
            console.log(`  ✅ ${script}: ${pkg.scripts[script]}`);
        } else {
            console.log(`  ❌ ${script}: MISSING`);
        }
    });
    
    console.log('\n📊 Dependencies Status:');
    const criticalDeps = [
        'solid-js',
        'vite', 
        '@solidjs/router',
        'dexie',
        '@noble/ciphers',
        '@noble/hashes',
        'vite-plugin-solid',
        'unocss'
    ];
    
    criticalDeps.forEach(dep => {
        const hasDep = pkg.dependencies?.[dep] || pkg.devDependencies?.[dep];
        if (hasDep) {
            console.log(`  ✅ ${dep}: ${hasDep}`);
        } else {
            console.log(`  ❌ ${dep}: MISSING`);
        }
    });
    
} catch (e) {
    console.error('❌ Failed to parse package.json:', e.message);
}

// 2. Check TypeScript config
try {
    const tsconfig = JSON.parse(fs.readFileSync('tsconfig.json', 'utf8'));
    console.log('\n📘 TypeScript Configuration:');
    
    const required = {
        'compilerOptions.jsx': 'preserve',
        'compilerOptions.jsxImportSource': 'solid-js',
        'compilerOptions.strict': true,
        'compilerOptions.moduleResolution': 'bundler'
    };
    
    Object.entries(required).forEach(([key, value]) => {
        const keys = key.split('.');
        let current = tsconfig;
        keys.forEach(k => current = current?.[k]);
        
        if (current === value) {
            console.log(`  ✅ ${key}: ${value}`);
        } else {
            console.log(`  ❌ ${key}: ${current} (expected: ${value})`);
        }
    });
} catch (e) {
    console.error('❌ Failed to parse tsconfig.json:', e.message);
}

// 3. Check Vite config
try {
    const viteConfig = fs.readFileSync('vite.config.ts', 'utf8');
    console.log('\n⚡ Vite Configuration:');
    
    const checks = [
        ['solid plugin', 'solid()'],
        ['UnoCSS', 'UnoCSS()'],
        ['PWA plugin', 'VitePWA'],
        ['port 3005', 'port: 3005'],
        ['host enabled', 'host: true']
    ];
    
    checks.forEach(([name, pattern]) => {
        if (viteConfig.includes(pattern)) {
            console.log(`  ✅ ${name} configured`);
        } else {
            console.log(`  ❌ ${name} not found`);
        }
    });
} catch (e) {
    console.error('❌ Failed to read vite.config.ts:', e.message);
}

// 4. Check critical files
console.log('\n📁 Critical Files Check:');
const criticalFiles = [
    'src/index.tsx',
    'src/App.tsx', 
    'src/pages/Landing.tsx',
    'src/pages/Login.tsx',
    'src/pages/Vault.tsx',
    'src/pages/Settings.tsx',
    'src/lib/auth/auth-service.ts',
    'src/lib/crypto/crypto-service.ts',
    'src/lib/db/database.ts',
    'src/components/VaultItemCard.tsx',
    'src/components/AddPasswordModal.tsx',
    'src/components/SearchBar.tsx',
    'src/context/VaultContext.tsx',
    'src/styles/global.css',
    'index.html',
    'uno.config.ts'
];

criticalFiles.forEach(file => {
    if (fs.existsSync(file)) {
        const stats = fs.statSync(file);
        const lines = fs.readFileSync(file, 'utf8').split('\n').length;
        console.log(`  ✅ ${file} (${lines} lines, ${(stats.size / 1024).toFixed(1)}KB)`);
    } else {
        console.log(`  ❌ ${file} MISSING`);
    }
});

// 5. Check node_modules critical packages
console.log('\n📦 Node Modules Check:');
const criticalPackages = [
    'solid-js',
    'vite',
    '@solidjs/router',
    'dexie',
    '@noble/ciphers',
    'unocss'
];

criticalPackages.forEach(pkg => {
    const pkgPath = path.join('node_modules', pkg);
    if (fs.existsSync(pkgPath)) {
        console.log(`  ✅ ${pkg} installed`);
    } else {
        console.log(`  ❌ ${pkg} not found in node_modules`);
    }
});

console.log('\n🎯 DIAGNOSTIC COMPLETE');
console.log('\n💡 RECOMMENDED ACTIONS:');
console.log('1. Ensure you are in the eoxvault-zero directory');
console.log('2. Run: bun install');
console.log('3. Run: bun run dev');
console.log('4. Open: http://localhost:3005');
console.log('\nIf issues persist, run: bun run build to check for compilation errors');
