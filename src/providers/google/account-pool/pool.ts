import type {
  GoogleAccount,
  AccountTokenEntry,
  AccountPoolConfig,
  AccountSelectionResult
} from './types.ts';
import { AccountStorage } from './storage.ts';
import { AccountValidator } from './validator.ts';
import { randomUUID } from 'node:crypto';

export class GoogleAccountPool {
  private storage: AccountStorage;
  private activeIndex: number = 0;
  private accounts: GoogleAccount[] = [];

  constructor(config?: AccountPoolConfig) {
    this.storage = new AccountStorage(config?.accountsPath);
    this.loadFromStorage();

    if (config?.autoReload !== false) {
      this.storage.watch(() => {
        console.log('[GoogleAccountPool] Accounts file modified, reloading...');
        this.loadFromStorage();
      });
    }
  }

  public getAccountsPath(): string {
    return this.storage.getFilePath();
  }

  public close(): void {
    this.storage.unwatch();
  }

  public loadFromStorage(): void {
    const data = this.storage.load();
    this.accounts = data.accounts;
    if (data.settings?.activeIndex !== undefined) {
      this.activeIndex = Math.max(0, Math.min(data.settings.activeIndex, this.accounts.length - 1));
    }
  }

  private persist(): void {
    this.storage.save({
      accounts: this.accounts,
      settings: {
        activeIndex: this.activeIndex
      }
    });
  }

  /**
   * Stick to the active account while it is enabled and valid.
   * An administratively unavailable account is replaced before sending a request.
   */
  public selectAccount(eligibleAccountIds?: ReadonlySet<string>): AccountSelectionResult {
    for (let offset = 0; offset < this.accounts.length; offset++) {
      const index = (this.activeIndex + offset) % this.accounts.length;
      const account = this.accounts[index];
      if (account.enabled === false || account.isInvalid || !account.refreshToken ||
          (eligibleAccountIds && !eligibleAccountIds.has(account.id))) continue;
      this.activeIndex = index;
      account.lastUsed = Date.now();
      return { account };
    }
    return { account: null };
  }

  /**
   * Exchange this account's refresh token for an access token.
   */
  public async getAccessToken(account: GoogleAccount): Promise<AccountTokenEntry> {
    try {
      const storedProject = account.projectId === 'aicode-consumers' ? undefined : account.projectId;
      const validated = await AccountValidator.validate(account.refreshToken, storedProject);
      const entry: AccountTokenEntry = {
        accessToken: validated.accessToken,
        expiresAt: validated.expiresAt,
        projectId: validated.projectId
      };
      if (account.isInvalid || account.projectId !== entry.projectId) {
        account.isInvalid = false;
        account.invalidReason = undefined;
        account.projectId = entry.projectId;
        this.persist();
      }
      return entry;
    } catch (err: any) {
      if (err.message.includes('invalid_grant') || err.message.includes('revoked')) {
        account.isInvalid = true;
        account.invalidReason = err.message;
        this.persist();
      }
      throw err;
    }
  }

  public listAccounts(): GoogleAccount[] {
    return [...this.accounts];
  }

  public getAccount(emailOrId: string): GoogleAccount | undefined {
    const query = emailOrId.toLowerCase().trim();
    return this.accounts.find(a => a.id.toLowerCase() === query || a.email.toLowerCase() === query);
  }

  /**
   * Add a new account manually with validation
   */
  public async addAccount(
    refreshToken: string,
    label?: string,
    explicitProjectId?: string
  ): Promise<GoogleAccount> {
    const validated = await AccountValidator.validate(refreshToken, explicitProjectId);

    // Check if account with email already exists
    const existing = this.accounts.find(a => a.email.toLowerCase() === validated.email.toLowerCase());
    if (existing) {
      existing.refreshToken = refreshToken.trim();
      existing.projectId = validated.projectId;
      existing.enabled = true;
      existing.isInvalid = false;
      existing.invalidReason = undefined;
      if (label) existing.label = label;
      this.persist();
      return existing;
    }

    const newAccount: GoogleAccount = {
      id: `acc_${randomUUID().replace(/-/g, '').slice(0, 12)}`,
      email: validated.email,
      refreshToken: refreshToken.trim(),
      projectId: validated.projectId,
      enabled: true,
      label: label || validated.email,
      addedAt: new Date().toISOString()
    };

    this.accounts.push(newAccount);
    this.persist();
    return newAccount;
  }

  /**
   * Remove an account
   */
  public removeAccount(emailOrId: string): boolean {
    const idx = this.accounts.findIndex(
      a => a.id.toLowerCase() === emailOrId.toLowerCase() || a.email.toLowerCase() === emailOrId.toLowerCase()
    );
    if (idx === -1) return false;

    this.accounts.splice(idx, 1);
    if (this.activeIndex >= this.accounts.length) {
      this.activeIndex = Math.max(0, this.accounts.length - 1);
    }
    this.persist();
    return true;
  }

  /**
   * Toggle enabled status
   */
  public toggleAccount(emailOrId: string, enabled?: boolean): boolean {
    const acc = this.getAccount(emailOrId);
    if (!acc) return false;

    acc.enabled = enabled !== undefined ? enabled : !acc.enabled;
    this.persist();
    return true;
  }
}
