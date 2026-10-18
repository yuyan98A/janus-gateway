import { GoogleAccountPool } from './pool.ts';
import { GoogleAccountOnboarding } from './onboarding.ts';
import { GoogleProviderClient } from '../client.ts';
import { loadConfig } from '../../../config.ts';

async function runCli() {
  const config = loadConfig();
  const pool = new GoogleAccountPool({
    accountsPath: config.providers.google?.accountsPath || './data/google-accounts.json',
    autoReload: false
  });

  const args = process.argv.slice(2);
  const command = args[0] || 'list';

  switch (command.toLowerCase()) {
    case 'list':
    case 'ls': {
      const accounts = pool.listAccounts();
      console.log('\n' + '='.repeat(80));
      console.log(`📋 Google Account Pool (${accounts.length} accounts, sticky selection)`);
      console.log(`   Path: ${pool.getAccountsPath()}`);
      console.log('='.repeat(80));

      if (accounts.length === 0) {
        console.log('No accounts configured yet. Run "npm run account:add" or "npm run account:login" to add one.');
        return;
      }

      accounts.forEach((acc, i) => {
        const status = acc.isInvalid
          ? '❌ INVALID'
          : !acc.enabled
          ? '⏸ DISABLED'
          : '✅ ACTIVE';

        console.log(`\n[${i + 1}] ${acc.email} (${acc.label || 'No Label'})`);
        console.log(`    Status:    ${status}`);
        console.log(`    Project:   ${acc.projectId || '尚未获取'}`);
        console.log(`    ID:        ${acc.id}`);
        console.log(`    Added:     ${acc.addedAt}`);
      });
      console.log('\n' + '='.repeat(80) + '\n');
      break;
    }

    case 'add': {
      const token = args[1];
      if (!token) {
        console.error('Usage: npm run account:add -- <refresh_token> [label] [projectId]');
        process.exit(1);
      }
      const label = args[2] || undefined;
      const project = args[3] || undefined;
      console.log(`Validating refresh token with Google...`);
      try {
        const account = await pool.addAccount(token, label, project);
        console.log(`✅ Successfully added account: ${account.email} (Project: ${account.projectId})`);
      } catch (err: any) {
        console.error(`❌ Failed to add account: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'remove':
    case 'rm': {
      const target = args[1];
      if (!target) {
        console.error('Usage: npm run account:remove -- <email_or_id>');
        process.exit(1);
      }
      const ok = pool.removeAccount(target);
      if (ok) {
        console.log(`✅ Removed account: ${target}`);
      } else {
        console.error(`❌ Account not found: ${target}`);
        process.exit(1);
      }
      break;
    }

    case 'toggle': {
      const target = args[1];
      if (!target) {
        console.error('Usage: npm run account:toggle -- <email_or_id>');
        process.exit(1);
      }
      const ok = pool.toggleAccount(target);
      if (ok) {
        const acc = pool.getAccount(target);
        console.log(`✅ Account ${target} is now: ${acc?.enabled ? 'ENABLED' : 'DISABLED'}`);
      } else {
        console.error(`❌ Account not found: ${target}`);
        process.exit(1);
      }
      break;
    }

    case 'login': {
      console.log('Initiating Google OAuth 2.0 Web Login...');
      try {
        const result = await GoogleAccountOnboarding.loginWithBrowser(pool, config.server.port);
        console.log(`✅ Logged in successfully: ${result.email} (Project: ${result.projectId})`);
      } catch (err: any) {
        console.error(`❌ Login failed: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    case 'quota': {
      const target = args[1];
      console.log('\n' + '='.repeat(80));
      console.log(`📊 Querying Google Antigravity Quota...`);
      console.log('='.repeat(80));

      const client = new GoogleProviderClient(pool);
      try {
        const report = await client.fetchQuota(target);
        if (report.accounts.length === 0) {
          console.log('No eligible accounts available for quota query.');
          break;
        }

        report.accounts.forEach((acc, i) => {
          console.log(`\n[${i + 1}] ${acc.email} (${acc.label || acc.id}) - Project: ${acc.projectId || 'N/A'}`);
          if (acc.status === 'error') {
            console.log(`    ❌ Status: Error - ${acc.error}`);
            return;
          }

          console.log(`    ✅ Status: OK (Checked: ${acc.checkedAt})`);
          const models = Object.values(acc.models);
          if (models.length === 0) {
            console.log(`    ℹ️ No model quota info returned.`);
            return;
          }

          console.log(`    📋 Model Quotas:`);
          const priority = ['claude-sonnet-4-6', 'claude-opus-4-6-thinking', 'gemini-3.8-flash', 'gemini-2.5-pro', 'gemini-2.5-flash'];
          const sorted = [...models].sort((a, b) => {
            const pa = priority.indexOf(a.model);
            const pb = priority.indexOf(b.model);
            if (pa !== -1 && pb !== -1) return pa - pb;
            if (pa !== -1) return -1;
            if (pb !== -1) return 1;
            return a.model.localeCompare(b.model);
          });

          sorted.slice(0, 10).forEach(m => {
            const filled = Math.round(m.remainingPercent / 10);
            const bar = '█'.repeat(Math.max(0, Math.min(10, filled))) + '░'.repeat(Math.max(0, 10 - filled));
            const resetInfo = m.resetTime ? ` (Reset: ${m.resetTime})` : '';
            console.log(`      • ${m.model.padEnd(28)} [${bar}] ${m.remainingPercent.toFixed(1).padStart(5)}%${resetInfo}`);
          });
          if (sorted.length > 10) {
            console.log(`      ... and ${sorted.length - 10} more models`);
          }
        });

        if (report.summary.primaryModelQuota) {
          const pm = report.summary.primaryModelQuota;
          console.log('\n' + '-'.repeat(80));
          console.log(`💡 Primary Model Quota (${pm.model}): ${pm.remainingPercent.toFixed(1)}% remaining via ${pm.sourceAccount}`);
        }
        console.log('\n' + '='.repeat(80) + '\n');
      } catch (err: any) {
        console.error(`❌ Failed to query quota: ${err.message}`);
        process.exit(1);
      }
      break;
    }

    default:
      console.log(`Unknown command: ${command}`);
      console.log('Available commands: list, add, remove, toggle, login, quota');
  }
  pool.close();
}

if (process.argv[1]?.includes('cli.ts') || process.argv[1]?.includes('cli')) {
  runCli().catch(err => {
    console.error(err);
    process.exit(1);
  });
}
