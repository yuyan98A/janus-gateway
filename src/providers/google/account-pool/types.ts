export interface GoogleAccount {
  id: string;
  email: string;
  refreshToken: string;
  projectId?: string;
  enabled: boolean;
  label?: string;
  addedAt: string;
  lastUsed?: number;
  isInvalid?: boolean;
  invalidReason?: string;
}

export interface GoogleAccountsSettings {
  activeIndex?: number;
}

export interface GoogleAccountsFile {
  accounts: GoogleAccount[];
  settings?: GoogleAccountsSettings;
}

export interface AccountTokenEntry {
  accessToken: string;
  expiresAt: number;
  projectId: string;
}

export interface AccountPoolConfig {
  accountsPath?: string;
  autoReload?: boolean;
}

export interface AccountSelectionResult {
  account: GoogleAccount | null;
}
