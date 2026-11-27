// Regression test for Batch 14 Enterprise Command Palette (Ctrl+K) role-filtering and accessibility
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const paletteSrc = fs.readFileSync(path.join(root, 'src/components/layout/EnterpriseCommandPalette.tsx'), 'utf8');
const navbarSrc = fs.readFileSync(path.join(root, 'src/components/layout/Navbar.tsx'), 'utf8');

test('Command Palette is mounted in Navbar with Ctrl+K keyboard accessibility and RTICore palette', () => {
  assert.match(navbarSrc, /import\s*\{EnterpriseCommandPalette\}\s*from\s*'@\/components\/layout\/EnterpriseCommandPalette'/);
  assert.match(navbarSrc, /<EnterpriseCommandPalette role=\{role\}\s*\/>/);
  assert.match(paletteSrc, /e\.ctrlKey \|\| e\.metaKey/);
  assert.match(paletteSrc, /role="dialog"/);
  assert.match(paletteSrc, /aria-modal="true"/);
  assert.match(paletteSrc, /#2B124C/);
});

test('Command Palette registers all V4 Enterprise Workspaces and RTI Finance with strict role filters', () => {
  const requiredRoutes = [
    '/erp/executive-command',
    '/finance',
    '/erp/service-catalog',
    '/erp/pricing-simulator',
    '/erp/flexguard-enterprise',
    '/portal/flexguard',
    '/erp/cyber-grc-cti',
    '/erp/operations-center',
  ];
  for (const route of requiredRoutes) {
    assert.ok(paletteSrc.includes(`'${route}'`), `Missing V4 route in Command Palette: ${route}`);
    const pagePath = path.join(root, 'src/app', route.slice(1), 'page.tsx');
    assert.ok(fs.existsSync(pagePath), `Missing page.tsx for ${route}`);
  }
  // Ensure Executive Command Center, Finance, and Operations Center are NOT exposed to sales/viewer
  const execBlock = paletteSrc.slice(paletteSrc.indexOf('/erp/executive-command'), paletteSrc.indexOf('/finance'));
  assert.ok(!execBlock.includes("'sales'") && !execBlock.includes("'viewer'"));
  const opsBlock = paletteSrc.slice(paletteSrc.indexOf('/erp/operations-center'));
  assert.ok(!opsBlock.slice(0, 300).includes("'sales'") && !opsBlock.slice(0, 300).includes("'viewer'"));
});
