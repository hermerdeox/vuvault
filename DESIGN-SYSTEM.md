# EOXVAULT ZERO - DESIGN SYSTEM DOCUMENTATION
## Mobile-First, Offline-First Password Manager

---

## 🎨 DESIGN PHILOSOPHY

### Core Principles
- **Ultra-Minimalist**: Every pixel serves a purpose
- **Monochromatic**: Pure black (#000000) background with white text variations
- **Zero-Friction**: No unnecessary animations or decorative elements
- **Typography-First**: Font weight and opacity create visual hierarchy
- **Brutalist Geometry**: Sharp edges, no border radius, geometric precision
- **Mobile-First**: Designed for touch interaction and small screens
- **Offline-First**: All functionality works without network connection

### Color Palette

```css
/* Primary Colors */
--black-pure: #000000;
--white-pure: #FFFFFF;

/* White Opacity Scale */
--white-90: rgba(255, 255, 255, 0.9);   /* Primary text */
--white-80: rgba(255, 255, 255, 0.8);   /* Headers */
--white-60: rgba(255, 255, 255, 0.6);   /* Secondary text */
--white-40: rgba(255, 255, 255, 0.4);   /* Muted text */
--white-30: rgba(255, 255, 255, 0.3);   /* Placeholders */
--white-20: rgba(255, 255, 255, 0.2);   /* Borders */
--white-10: rgba(255, 255, 255, 0.1);   /* Subtle borders */
--white-5:  rgba(255, 255, 255, 0.05);  /* Hover states */
--white-2:  rgba(255, 255, 255, 0.02);  /* Subtle backgrounds */

/* Semantic Colors */
--success: rgba(16, 185, 129, 0.6);     /* #10b981 at 60% */
--warning: rgba(245, 158, 11, 0.6);     /* #f59e0b at 60% */
--danger:  rgba(239, 68, 68, 0.6);      /* #ef4444 at 60% */
```

### Typography

```css
/* Font Stack */
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen', 
             'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', 
             sans-serif;

/* Font Weights */
--font-thin: 100;      /* Hero headlines */
--font-light: 300;     /* Body text, buttons */
--font-regular: 400;   /* Rarely used */
--font-medium: 500;    /* Never used */
--font-semibold: 600;  /* Never used */

/* Tracking (Letter Spacing) */
--tracking-tighter: -0.05em;  /* Large headlines */
--tracking-tight: -0.025em;   /* Headlines */
--tracking-normal: 0;         /* Body text */
--tracking-wide: 0.025em;     /* Buttons */
--tracking-wider: 0.05em;     /* Labels */
--tracking-widest: 0.1em;     /* Small caps */
```

---

## 📱 HOMEPAGE / LANDING PAGE

### Mobile Viewport (320px - 767px)

#### Layout Structure
```
┌─────────────────────────────┐
│  Header (64px)              │
│  ┌───────────────────────┐  │
│  │ Logo | EOXVAULT       │  │
│  └───────────────────────┘  │
├─────────────────────────────┤
│                             │
│  Main Content (flex-1)      │
│  ┌───────────────────────┐  │
│  │    Lock Icon (80px)   │  │
│  │                       │  │
│  │    Secure.            │  │
│  │    Simple.            │  │
│  │                       │  │
│  │  Tagline paragraph    │  │
│  │                       │  │
│  │  [ENTER VAULT]        │  │
│  │                       │  │
│  │  • CHACHA20           │  │
│  │  • WEBAUTHN           │  │
│  │  • OFFLINE-FIRST      │  │
│  └───────────────────────┘  │
│                             │
├─────────────────────────────┤
│  Footer (64px)              │
│  © 2024 EOXVAULT ZERO      │
└─────────────────────────────┘
```

#### Component Specifications

##### Header
- **Height**: 64px (fixed)
- **Position**: Absolute, top: 0
- **Padding**: 32px horizontal, 32px vertical
- **Z-index**: 50
- **Background**: Transparent

###### Logo Mark
- **Size**: 32x32px
- **Border**: 1px solid white/20
- **Content**: "V" centered
- **Font**: 14px, light (300), white/80
- **Letter spacing**: Normal

###### Brand Name
- **Font**: 14px, light (300)
- **Color**: white/80
- **Letter spacing**: 0.05em (wider)
- **Margin-left**: 12px

##### Hero Section
- **Padding**: 24px horizontal
- **Alignment**: Center

###### Lock Icon Container
- **Size**: 80x80px
- **Border**: 1px solid white/10
- **Border-radius**: 50% (circle)
- **Margin-bottom**: 48px
- **Icon size**: 32x32px
- **Icon color**: white/40
- **Icon stroke-width**: 1px

###### Headlines
- **Font-size**: 48px (3rem)
- **Line-height**: 1
- **Font-weight**: 100 (thin)
- **Letter-spacing**: -0.025em (tight)
- **Margin-bottom**: 24px
- **"Simple" color**: white/40

###### Tagline
- **Font-size**: 16px
- **Font-weight**: 300 (light)
- **Color**: white/60
- **Line-height**: 1.75 (relaxed)
- **Max-width**: 280px
- **Margin**: 0 auto, 48px bottom

###### CTA Button
- **Width**: Full width (max 280px)
- **Height**: 56px
- **Border**: 1px solid white/20
- **Background**: Transparent
- **Font-size**: 12px
- **Font-weight**: 300 (light)
- **Letter-spacing**: 0.05em (wider)
- **Text-transform**: Uppercase
- **Hover border**: white/40
- **Hover background**: white/5 (animated scale-x)
- **Transition**: all 500ms

###### Feature Indicators
- **Margin-top**: 64px
- **Font-size**: 10px
- **Color**: white/30
- **Letter-spacing**: 0.1em (widest)
- **Dot size**: 4x4px
- **Dot color**: white/30
- **Gap between items**: 32px

##### Footer
- **Height**: 64px
- **Padding**: 32px
- **Font-size**: 10px
- **Color**: white/20
- **Letter-spacing**: 0.05em

#### Touch Interactions
- **Tap target minimum**: 44x44px
- **Touch feedback**: opacity 0.7 on active
- **Swipe**: None
- **Pinch/Zoom**: Disabled (user-scalable=no)

### Tablet Viewport (768px - 1023px)

#### Layout Adjustments
- **Header padding**: 32px → 32px
- **Main padding**: 24px → 48px
- **Max-width container**: 768px

#### Component Changes

##### Hero Section
- **Lock icon**: 80x80px (unchanged)
- **Headlines font-size**: 56px (3.5rem)
- **Tagline max-width**: 448px
- **CTA button width**: 200px (fixed)
- **Feature indicators gap**: 48px

### Desktop Viewport (1024px+)

#### Layout Structure
```
┌───────────────────────────────────────────────┐
│  Header (80px)                                │
│  ┌─────────────────────────────────────────┐  │
│  │ [Logo] EOXVAULT                         │  │
│  └─────────────────────────────────────────┘  │
├───────────────────────────────────────────────┤
│                                               │
│           Main Content (centered)             │
│  ┌─────────────────────────────────────────┐  │
│  │         Lock Icon (80x80)               │  │
│  │                                         │  │
│  │      Secure. Simple.                    │  │
│  │         (96px text)                     │  │
│  │                                         │  │
│  │    Zero-knowledge password...           │  │
│  │                                         │  │
│  │       [ENTER VAULT]                     │  │
│  │                                         │  │
│  │  • CHACHA20  • WEBAUTHN  • OFFLINE      │  │
│  └─────────────────────────────────────────┘  │
│                                               │
├───────────────────────────────────────────────┤
│  Footer                                       │
└───────────────────────────────────────────────┘
```

#### Component Specifications

##### Container
- **Max-width**: 1280px (7xl)
- **Margin**: 0 auto
- **Padding**: 32px horizontal

##### Hero Section
- **Lock icon**: 80x80px
- **Icon inner**: 32x32px
- **Headlines**:
  - Font-size: 96px (6rem) on XL screens
  - Font-size: 112px (7rem) on 2XL screens
  - Line-height: 0.9
- **Tagline**:
  - Font-size: 18px
  - Max-width: 448px
- **CTA Button**:
  - Width: 192px
  - Padding: 48px horizontal, 16px vertical
  - Hover effects enhanced with transform

##### Hover States
- **All interactive elements**: Smooth color transitions (200ms)
- **Button hover**: Border white/40, background scale animation
- **Link hover**: Color white/60 → white/80

---

## 🔐 LOGIN PAGE

### Mobile Viewport (320px - 767px)

#### Layout Structure
```
┌─────────────────────────────┐
│  Back Button (44x44)        │
├─────────────────────────────┤
│                             │
│    Lock Icon (64x64)        │
│                             │
│    Access Vault             │
│    or Create Vault          │
│                             │
│    Subtitle text            │
│                             │
│    [Username Input]         │  (if registering)
│                             │
│    [Error Message]          │  (if error)
│                             │
│    [AUTHENTICATE]           │
│    or [CREATE VAULT]        │
│                             │
│    Toggle Link              │
│                             │
│    Privacy Notice           │
│                             │
└─────────────────────────────┘
```

#### Component Specifications

##### Back Button
- **Position**: Fixed, top: 32px, left: 32px
- **Size**: 24x24px icon
- **Color**: white/40
- **Hover**: white/60
- **Transition**: 300ms

##### Lock Icon
- **Size**: 64x64px container
- **Border**: 1px solid white/10
- **Border-radius**: 50%
- **Icon**: 24x24px
- **Icon color**: white/40
- **Margin-bottom**: 48px

##### Typography
- **Main heading**: 
  - Font-size: 24px
  - Font-weight: 100 (thin)
  - Margin-bottom: 8px
- **Subtitle**:
  - Font-size: 14px
  - Font-weight: 300 (light)
  - Color: white/40
  - Margin-bottom: 48px

##### Input Field (Registration only)
- **Width**: 100%
- **Height**: 48px
- **Padding**: 16px horizontal, 12px vertical
- **Border**: 1px solid white/10
- **Background**: Transparent
- **Font-size**: 16px (prevents zoom on iOS)
- **Font-weight**: 300 (light)
- **Placeholder color**: white/30
- **Focus border**: white/30
- **Transition**: 300ms
- **Margin-bottom**: 32px

##### Error Message
- **Padding**: 12px
- **Border**: 1px solid red-500/20
- **Background**: red-500/10
- **Color**: red-400
- **Font-size**: 14px
- **Font-weight**: 300 (light)
- **Margin-bottom**: 24px

##### Primary Button
- **Width**: 100%
- **Height**: 56px
- **Padding**: 16px vertical, 32px horizontal
- **Border**: 1px solid white/20
- **Font-size**: 12px
- **Letter-spacing**: 0.05em (wider)
- **Text-transform**: Uppercase
- **Loading state**: Spinner (16x16px) + text
- **Disabled opacity**: 0.5

##### Toggle Link
- **Margin-top**: 32px
- **Font-size**: 10px
- **Color**: white/40
- **Hover**: white/60
- **Letter-spacing**: 0.05em (wider)
- **Text-transform**: Uppercase

##### Privacy Notice
- **Margin-top**: 48px
- **Padding-top**: 32px
- **Border-top**: 1px solid white/5
- **Font-size**: 10px
- **Color**: white/20
- **Font-weight**: 300 (light)

### Tablet Viewport (768px - 1023px)

#### Layout Adjustments
- **Container max-width**: 384px (sm)
- **Padding**: 32px

#### Component Changes
- **Lock icon**: 64x64px (unchanged)
- **Main heading**: 30px
- **Input height**: 48px (unchanged)
- **Button height**: 56px (unchanged)

### Desktop Viewport (1024px+)

#### Layout Structure
- **Container**: Centered, max-width 384px
- **Viewport**: Full height centering with flexbox

#### Component Specifications

##### Hover Enhancements
- **Input field**: Border animates to white/30 on focus
- **Button**: 
  - Border transitions to white/40
  - Background overlay scales from left (white/5)
  - Duration: 500ms
- **Links**: Color transitions over 300ms

##### Keyboard Navigation
- **Tab order**: Logical flow through form
- **Enter key**: Submits form
- **Escape key**: Closes password display modal

---

## 📱 RESPONSIVE BREAKPOINTS

```css
/* Mobile First Approach */
/* Base: 320px - 767px */
@media (min-width: 768px) { /* Tablet */ }
@media (min-width: 1024px) { /* Desktop */ }
@media (min-width: 1280px) { /* Large Desktop */ }
@media (min-width: 1536px) { /* Extra Large */ }
```

### Critical Breakpoint Behaviors

#### 320px - 375px (Small Mobile)
- Font sizes reduced by 10%
- Padding reduced to 16px
- Button height: 48px

#### 376px - 767px (Standard Mobile)
- Base specifications apply
- Full padding: 24px
- Button height: 56px

#### 768px - 1023px (Tablet)
- Increased spacing
- Centered containers
- Enhanced hover states

#### 1024px+ (Desktop)
- Maximum readability widths
- Full hover interactions
- Smooth transitions enabled

---

## 🎯 INTERACTION STATES

### Button States

#### Default
```css
border: 1px solid rgba(255, 255, 255, 0.2);
background: transparent;
color: rgba(255, 255, 255, 0.8);
```

#### Hover (Desktop only)
```css
border: 1px solid rgba(255, 255, 255, 0.4);
background: rgba(255, 255, 255, 0.05);
transform: translateX(0);
```

#### Active/Pressed
```css
opacity: 0.7;
transform: scale(0.98);
```

#### Disabled
```css
opacity: 0.5;
cursor: not-allowed;
```

### Input States

#### Default
```css
border: 1px solid rgba(255, 255, 255, 0.1);
background: transparent;
```

#### Focus
```css
border: 1px solid rgba(255, 255, 255, 0.3);
outline: none;
```

#### Error
```css
border: 1px solid rgba(239, 68, 68, 0.4);
```

---

## 🔄 ANIMATIONS & TRANSITIONS

### Global Transition Settings
```css
/* Desktop only - disabled on mobile for performance */
@media (min-width: 768px) {
  transition-property: color, background-color, border-color, opacity;
  transition-duration: 200ms;
  transition-timing-function: ease-out;
}
```

### Specific Animations

#### Button Hover Fill
```css
.button::before {
  content: '';
  position: absolute;
  inset: 0;
  background: rgba(255, 255, 255, 0.05);
  transform: scaleX(0);
  transform-origin: left;
  transition: transform 500ms ease-out;
}

.button:hover::before {
  transform: scaleX(1);
}
```

#### Loading Spinner
```css
@keyframes spin {
  to { transform: rotate(360deg); }
}

.spinner {
  animation: spin 1s linear infinite;
}
```

#### Fade In
```css
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.animate-in {
  animation: fadeIn 300ms ease-out;
}
```

---

## 📐 SPACING SYSTEM

### Base Unit: 8px

```css
/* Spacing Scale */
--space-0: 0;
--space-1: 4px;   /* 0.5 unit */
--space-2: 8px;   /* 1 unit */
--space-3: 12px;  /* 1.5 units */
--space-4: 16px;  /* 2 units */
--space-6: 24px;  /* 3 units */
--space-8: 32px;  /* 4 units */
--space-12: 48px; /* 6 units */
--space-16: 64px; /* 8 units */
--space-20: 80px; /* 10 units */
--space-24: 96px; /* 12 units */
```

### Component Spacing

#### Mobile (320px - 767px)
- **Page padding**: 24px (space-6)
- **Section spacing**: 48px (space-12)
- **Element spacing**: 16px (space-4)
- **Inline spacing**: 8px (space-2)

#### Tablet (768px - 1023px)
- **Page padding**: 32px (space-8)
- **Section spacing**: 64px (space-16)
- **Element spacing**: 24px (space-6)
- **Inline spacing**: 12px (space-3)

#### Desktop (1024px+)
- **Page padding**: 32px (space-8)
- **Section spacing**: 96px (space-24)
- **Element spacing**: 32px (space-8)
- **Inline spacing**: 16px (space-4)

---

## 🌐 ACCESSIBILITY

### WCAG 2.1 AA Compliance

#### Color Contrast
- **Large text (24px+)**: 3:1 minimum
- **Normal text**: 4.5:1 minimum
- **All text on black**: Meets AA standards

#### Touch Targets
- **Minimum size**: 44x44px (WCAG 2.5.5)
- **Spacing**: 8px minimum between targets
- **Error prevention**: Confirmation for destructive actions

#### Keyboard Navigation
- **Tab order**: Logical and predictable
- **Focus indicators**: Visible (border change)
- **Skip links**: Not required (minimal navigation)

#### Screen Reader Support
- **Semantic HTML**: Proper heading hierarchy
- **ARIA labels**: On icon buttons
- **Form labels**: Associated with inputs
- **Error messages**: Announced immediately

---

## 🔒 SECURITY INDICATORS

### Visual Security Cues

#### Encryption Status
```css
.encrypted {
  color: rgba(16, 185, 129, 0.6); /* Green */
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 0.1em;
}
```

#### Password Strength
- **Weak**: red-500/60
- **Medium**: yellow-500/60
- **Strong**: green-500/60

#### Authentication State
- **Locked**: white/20 borders
- **Unlocked**: white/40 borders
- **Active**: green-500/20 glow

---

## 📱 PWA SPECIFICATIONS

### Mobile App Behavior

#### Status Bar
```html
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="theme-color" content="#000000">
```

#### Viewport Settings
```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover, user-scalable=no">
```

#### Safe Area Handling
```css
.safe-top { padding-top: env(safe-area-inset-top); }
.safe-bottom { padding-bottom: env(safe-area-inset-bottom); }
.safe-left { padding-left: env(safe-area-inset-left); }
.safe-right { padding-right: env(safe-area-inset-right); }
```

#### Overscroll Behavior
```css
body {
  overscroll-behavior: none;
  -webkit-overflow-scrolling: touch;
}
```

---

## 🎨 COMPONENT LIBRARY

### Reusable Patterns

#### Minimal Card
```css
.minimal-card {
  background: black;
  border: 1px solid rgba(255, 255, 255, 0.1);
  padding: 24px;
}
```

#### Ghost Button
```css
.ghost-button {
  border: 1px solid rgba(255, 255, 255, 0.2);
  background: transparent;
  padding: 16px 32px;
  font-size: 12px;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  transition: all 500ms;
}
```

#### Subtle Divider
```css
.divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.05);
  margin: 48px 0;
}
```

---

## 🚀 PERFORMANCE OPTIMIZATIONS

### Critical CSS
- Inline critical styles in HTML head
- Font declarations prioritized
- Above-the-fold styles extracted

### Font Loading
```css
font-display: swap; /* Prevent FOIT */
```

### Animation Performance
- Use `transform` and `opacity` only
- Enable hardware acceleration
- Disable on mobile for battery life

### Touch Performance
```css
* {
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation; /* Disable double-tap zoom */
}
```

---

## 📋 IMPLEMENTATION CHECKLIST

### Mobile-First Development
- [ ] Start with 320px width
- [ ] Progressive enhancement to tablet
- [ ] Desktop as final enhancement
- [ ] Test on real devices

### Offline-First Features
- [ ] Service Worker implementation
- [ ] IndexedDB for data storage
- [ ] Cache-first strategy
- [ ] Sync when online

### Performance Metrics
- [ ] First Contentful Paint < 1.8s
- [ ] Time to Interactive < 3.8s
- [ ] Cumulative Layout Shift < 0.1
- [ ] Lighthouse score > 95

### Browser Support
- [ ] iOS Safari 14+
- [ ] Chrome 90+
- [ ] Firefox 88+
- [ ] Edge 90+
- [ ] Samsung Internet 14+

---

## 🔧 DEVELOPMENT NOTES

### CSS Architecture
- **Methodology**: Utility-first with UnoCSS
- **Naming**: Semantic, lowercase, hyphenated
- **Organization**: Component-based structure
- **Optimization**: PurgeCSS in production

### State Management
- **Framework**: SolidJS (reactive, performant)
- **Router**: @solidjs/router
- **Context**: VaultContext for global state
- **Storage**: IndexedDB with Dexie

### Build Tools
- **Bundler**: Bun (replacing Vite)
- **CSS**: UnoCSS
- **PWA**: VitePWA plugin
- **Deployment**: Cloudflare Workers

---

## 📝 VERSION HISTORY

### v1.0.0 (Current)
- Initial design system
- Homepage and Login page specifications
- Mobile-first responsive design
- Offline-first architecture
- Pure black minimalist aesthetic

---

*Last Updated: September 2024*
*Design System Version: 1.0.0*
*EOXVAULT ZERO - Ultra-Secure Password Manager*
