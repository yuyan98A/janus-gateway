import { GoogleAccountPool } from './pool.ts';
import { GoogleAccountOnboarding } from './onboarding.ts';
import { GoogleProviderClient } from '../client.ts';
import { loadConfig } from '../../../config.ts';

function formatRemainingTime(resetTime?: string, offsetMs = 0): string {
  if (!resetTime) return 'Reset time unknown';
  const diffMs = Date.parse(resetTime) - (Date.now() + offsetMs);
  if (diffMs <= 0) return 'Reset due; refresh quota';
  const totalMins = Math.ceil(diffMs / 60000);
  return `Resets in ${Math.floor(totalMins / 60)}h ${totalMins % 60}m`;
}

function formatProgressBar(fraction: number, width = 20): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(clamped * width);
  return '[' + '█'.repeat(filled) + '░'.repeat(width - filled) + ']';
}

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
      console.log(`📊 Google Antigravity 各账号算力池额度窗口`);
      console.log('='.repeat(80));

      const client = new GoogleProviderClient(pool);
      try {
        const report = await client.fetchQuota(target);
        if (report.accounts.length === 0) {
          console.log('\n未找到可用于查询配额的有效 Google 账号。\n');
          break;
        }

        report.accounts.forEach((acc, i) => {
          const planTag = acc.subscription?.tierName
            ? ` [${acc.subscription.tierName}]`
            : (acc.subscription?.plan ? ` [${acc.subscription.plan.toUpperCase()}]` : '');
          console.log(`\n[${i + 1}] ${acc.email}${planTag} (${acc.label || acc.id}) - Project: ${acc.projectId || 'N/A'}`);
          if (acc.status === 'error') {
            console.log(`    ❌ 状态: 查询异常 - ${acc.error}`);
            return;
          }

          const offsetStr = acc.serverTimeOffsetMs !== undefined ? ` (时钟差: ${acc.serverTimeOffsetMs > 0 ? '+' : ''}${Math.round(acc.serverTimeOffsetMs / 1000)}s)` : '';
          console.log(`    ✅ 状态: 正常 (同步于 ${acc.checkedAt}${offsetStr})`);
          if (!acc.groups?.length) console.log('    ℹ️ 上游未提供有效算力池窗口，配额未知');

          for (const group of acc.groups || []) {
            console.log(`    ▶ ${group.displayName}`);
            for (const bucket of group.buckets) {
              const percent = bucket.remainingPercent;
              const bar = bucket.remainingFraction === null ? '[Unknown quota]' : formatProgressBar(bucket.remainingFraction, 20);
              const percentStr = percent === null ? 'unknown' : percent.toFixed(2).padStart(6) + '%';
              const reset = formatRemainingTime(bucket.resetTime, acc.serverTimeOffsetMs);
              const blocked = bucket.available === false && (bucket.remainingFraction ?? 0) > 0 ? ' · 周额度已耗尽' : '';
              const label = bucket.window === 'weekly' ? '周额度' : bucket.window === '5h' ? '5 小时额度' : bucket.displayName;
              console.log(`      • ${label.padEnd(20)} ${bar} ${percentStr}  ${reset}${blocked}`);
            }
          }
        });

        console.log('\n' + '='.repeat(80) + '\n');
      } catch (err: any) {
        console.error(`❌ 查询专线配额失败: ${err.message}`);
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
