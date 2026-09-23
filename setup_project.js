const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectDir = 'C:\\Users\\Utente\\Desktop\\documenti elia (appunti)\\fantacalcio\\fanta27\\coach-beard-starter 2\\coach-beard-starter';
const claudeNm = 'C:\\Users\\Utente\\Desktop\\documenti elia (appunti)\\fantacalcio\\fanta27\\Claude Gratis\\node_modules';
const projectNm = path.join(projectDir, 'node_modules');

// Packages we need that are in Claude Gratis but not in project
const neededPackages = ['better-sqlite3', 'xlsx', 'zod'];

let copied = [];
let alreadyThere = [];

for (const pkg of neededPackages) {
  const src = path.join(claudeNm, pkg);
  const dst = path.join(projectNm, pkg);
  if (fs.existsSync(dst)) {
    alreadyThere.push(pkg);
  } else if (fs.existsSync(src)) {
    try {
      // Copy the package directory
      copyDir(src, dst);
      copied.push(pkg);
    } catch(e) {
      console.log(`Error copying ${pkg}:`, e.message?.slice(0,200));
    }
  } else {
    console.log(`Package ${pkg} not found anywhere`);
  }
}

console.log('Already there:', alreadyThere);
console.log('Copied:', copied);

// Also copy .bin from Claude Gratis to project if needed
const srcBin = path.join(claudeNm, '.bin');
const dstBin = path.join(projectNm, '.bin');
if (fs.existsSync(srcBin) && !fs.existsSync(dstBin)) {
  try {
    copyDir(srcBin, dstBin);
    console.log('Copied .bin');
  } catch(e) {
    console.log('Error copying .bin:', e.message?.slice(0,200));
  }
}

function copyDir(src, dst) {
  if (!fs.existsSync(dst)) {
    fs.mkdirSync(dst, { recursive: true });
  }
  const entries = fs.readdirSync(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

// Verify
for (const pkg of neededPackages) {
  const p = path.join(projectNm, pkg);
  console.log(`Project ${pkg} exists:`, fs.existsSync(p));
}
