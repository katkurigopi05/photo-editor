export interface ManualSyncResult {
  required: boolean;
  missing: string[];
}

export function evaluateManualSync(changedFiles: string[]): ManualSyncResult;
