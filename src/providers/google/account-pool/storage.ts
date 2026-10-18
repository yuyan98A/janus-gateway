import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { GoogleAccount, GoogleAccountsFile } from './types.ts';

export class AccountStorage {
  private filePath: string;
  private watchCallback: (() => void) | null = null;
  private fileWatcher: fs.FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(filePath?: string) {
    this.filePath = this.resolvePath(filePath || './data/google-accounts.json');
  }

  public getFilePath(): string {
    return this.filePath;
  }

  private resolvePath(p: string): string {
    if (p.startsWith('~')) {
      return path.join(os.homedir(), p.slice(1));
    }
    return path.resolve(p);
  }

  /**
   * Load accounts file. If the file does not exist, attempt to import
   * from legacy ~/.config/antigravity-proxy/accounts.json as a smooth bootstrap.
   */
  public load(): GoogleAccountsFile {
    if (!fs.existsSync(this.filePath)) {
      // Check legacy path as bootstrap
      const legacyPath = path.join(os.homedir(), '.config', 'antigravity-proxy', 'accounts.json');
      if (fs.existsSync(legacyPath)) {
        try {
          const legacyData = this.readLegacyFile(legacyPath);
          if (legacyData.accounts.length > 0) {
            this.save(legacyData);
            return legacyData;
          }
        } catch (err: any) {
          console.warn(`[AccountStorage] Failed to read legacy accounts from ${legacyPath}:`, err.message);
        }
      }

      // Default empty structure
      const initial: GoogleAccountsFile = {
        accounts: [],
        settings: { activeIndex: 0 }
      };
      this.save(initial);
      return initial;
    }

    try {
      const content = fs.readFileSync(this.filePath, 'utf8');
      const parsed = JSON.parse(content);

      if (Array.isArray(parsed)) {
        return {
          accounts: this.normalizeAccounts(parsed),
          settings: { activeIndex: 0 }
        };
      }

      return {
        accounts: this.normalizeAccounts(parsed.accounts || []),
        settings: { activeIndex: parsed.settings?.activeIndex ?? 0 }
      };
    } catch (err: any) {
      console.error(`[AccountStorage] Failed to parse ${this.filePath}:`, err.message);
      return { accounts: [], settings: { activeIndex: 0 } };
    }
  }

  /**
   * Atomic save to disk with temporary file rename
   */
  public save(data: GoogleAccountsFile): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const tempPath = `${this.filePath}.tmp.${Date.now()}`;
    const serialized = JSON.stringify(data, null, 2);

    fs.writeFileSync(tempPath, serialized, 'utf8');
    fs.renameSync(tempPath, this.filePath);
  }

  /**
   * Enable watching for external modifications
   */
  public watch(onChange: () => void): void {
    this.watchCallback = onChange;
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    try {
      this.fileWatcher = fs.watch(dir, (eventType, filename) => {
        if (filename && path.basename(this.filePath) === filename) {
          if (this.debounceTimer) clearTimeout(this.debounceTimer);
          this.debounceTimer = setTimeout(() => {
            if (this.watchCallback) {
              this.watchCallback();
            }
          }, 300);
        }
      });
    } catch (err: any) {
      console.warn(`[AccountStorage] Could not watch ${dir}:`, err.message);
    }
  }

  public unwatch(): void {
    if (this.fileWatcher) {
      this.fileWatcher.close();
      this.fileWatcher = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private normalizeAccounts(rawList: any[]): GoogleAccount[] {
    return rawList.map((item, idx) => {
      let refreshToken = item.refreshToken || '';
      let projectId = item.projectId;

      // Handle legacy composite token "token|project-id"
      if (refreshToken.includes('|')) {
        const [tok, proj] = refreshToken.split('|');
        refreshToken = tok;
        if (!projectId && proj) projectId = proj;
      }

      return {
        id: item.id || `acc_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
        email: item.email || `account_${idx + 1}@gmail.com`,
        refreshToken,
        projectId: projectId || undefined,
        enabled: item.enabled !== false,
        label: item.label || item.email || `Account ${idx + 1}`,
        addedAt: item.addedAt || new Date().toISOString(),
        lastUsed: item.lastUsed,
        isInvalid: !!item.isInvalid,
        invalidReason: item.invalidReason
      };
    });
  }

  private readLegacyFile(legacyPath: string): GoogleAccountsFile {
    const raw = fs.readFileSync(legacyPath, 'utf8');
    const parsed = JSON.parse(raw);
    const list = Array.isArray(parsed) ? parsed : parsed.accounts || [];
    return {
      accounts: this.normalizeAccounts(list),
      settings: { activeIndex: 0 }
    };
  }
}
