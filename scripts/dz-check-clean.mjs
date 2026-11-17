// Fails (exit 1) if any trace of the old upstream service is left: its API and
// CDN hosts, its promo partner, or the service name itself in our code.
// Usage: node scripts/dz-check-clean.mjs [dir ...]   (default: source dirs)
import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DIRS = ['README.md', 'docs', 'deploy', '.env.example', 'app', 'components', 'packages/studio/src', 'gateway/src', 'public', 'docker-compose.yml', 'Dockerfile', 'next.config.mjs', 'package.json', 'jsconfig.json', 'tailwind.config.js'];
const PATTERN = /muapi|d3adwkbyhxyrtq\.cloudfront\.net|vadoo/i;
const TEXT = /\.(m?js|jsx|json|css|html|txt|md|ya?ml|svg|map)$|Dockerfile$|\.env\.example$/i;

const dirs = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_DIRS;
const hits = [];
function scan(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.statSync(target);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(target)) {
      if (name === 'node_modules' || name === '.git' || name === 'cache') continue;
      scan(path.join(target, name));
    }
    return;
  }
  if (!TEXT.test(target) || stat.size > 50 * 1024 * 1024) return;
  const lines = fs.readFileSync(target, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (target.endsWith('dz-check-clean.mjs')) return;
    if (PATTERN.test(line)) hits.push(`${target}:${i + 1}: ${line.trim().slice(0, 140)}`);
  });
}
dirs.forEach(scan);
if (hits.length) {
  console.error(`Clean check failed: ${hits.length} trace(s) of the old upstream service:\n${hits.slice(0, 50).join('\n')}`);
  process.exit(1);
}
console.log(`Clean check passed (${dirs.join(', ')}).`);
