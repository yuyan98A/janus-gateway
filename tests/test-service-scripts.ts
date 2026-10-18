import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

async function testServiceScriptsExist() {
  console.log('• Checking existence of service management scripts...');
  const requiredFiles = [
    'scripts/service-start.ps1',
    'scripts/service-stop.ps1',
    'scripts/service-status.ps1',
    'scripts/install-autostart.ps1',
    'scripts/uninstall-autostart.ps1',
    'scripts/start-hidden.vbs'
  ];

  for (const relPath of requiredFiles) {
    const fullPath = path.join(rootDir, relPath);
    assert.equal(fs.existsSync(fullPath), true, `Missing required service file: ${relPath}`);
    const stat = fs.statSync(fullPath);
    assert.equal(stat.size > 0, true, `Service file is empty: ${relPath}`);
    console.log(`  ✔ Found ${relPath} (${stat.size} bytes)`);
  }
}

async function testPowerShellCompatibility() {
  console.log('• Checking PowerShell 5.1 backwards compatibility...');
  const psFiles = [
    'scripts/service-start.ps1',
    'scripts/service-stop.ps1',
    'scripts/service-status.ps1',
    'scripts/install-autostart.ps1',
    'scripts/uninstall-autostart.ps1'
  ];

  // Regex to check for PS7-only operators that fail in Windows PowerShell 5.1
  const forbiddenRegex = /(\|\||&&|\?\?)/;

  for (const relPath of psFiles) {
    const fullPath = path.join(rootDir, relPath);
    const content = fs.readFileSync(fullPath, 'utf8');
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip comments
      if (line.trim().startsWith('#')) continue;
      assert.equal(
        forbiddenRegex.test(line),
        false,
        `Found PS7-only operator in ${relPath} at line ${i + 1}: ${line}`
      );
    }
    console.log(`  ✔ ${relPath} passed PowerShell 5.1 syntax compatibility`);
  }
}

async function testPackageJsonScripts() {
  console.log('• Checking package.json service script definitions...');
  const pkgPath = path.join(rootDir, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  const expectedScripts = [
    'service:start',
    'service:stop',
    'service:status',
    'service:restart',
    'service:install',
    'service:uninstall'
  ];

  for (const name of expectedScripts) {
    assert.equal(typeof pkg.scripts[name], 'string', `package.json is missing script: ${name}`);
    console.log(`  ✔ npm run ${name} -> ${pkg.scripts[name]}`);
  }
}

async function testServiceStatusScriptExecution() {
  console.log('• Testing execution of scripts/service-status.ps1...');
  const statusScript = path.join(rootDir, 'scripts', 'service-status.ps1');
  const result = execSync(`powershell.exe -ExecutionPolicy Bypass -NoProfile -File "${statusScript}"`, {
    encoding: 'utf8',
    timeout: 10000
  });

  assert(result.includes('Agent Model Gateway Service Status Report'), 'Output should contain header');
  assert(result.includes('Process Status'), 'Output should report Process Status');
  assert(result.includes('Gateway Health'), 'Output should report Gateway Health');
  assert(result.includes('Autostart State'), 'Output should report Autostart State');
  console.log('  ✔ service-status.ps1 executed cleanly with valid report structure');
}

async function main() {
  console.log('='.repeat(70));
  console.log('🧪 Starting Windows Service & Daemon Script Verification Suite');
  console.log('='.repeat(70));

  await testServiceScriptsExist();
  await testPowerShellCompatibility();
  await testPackageJsonScripts();
  await testServiceStatusScriptExecution();

  console.log('\nAll Windows Service & Daemon tests completed successfully!');
}

main().catch(err => {
  console.error('[Service Test Failed]:', err);
  process.exit(1);
});
