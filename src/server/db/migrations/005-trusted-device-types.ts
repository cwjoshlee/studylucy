import type Database from "better-sqlite3";

export const trustedDeviceTypesMigration = {
  version: 5,
  up(db: Database.Database): void {
    db.exec(`
      ALTER TABLE trusted_devices ADD COLUMN device_type TEXT CHECK (
        device_type IS NULL OR device_type IN ('tablet', 'phone', 'mac', 'windows')
      );
      CREATE INDEX trusted_devices_active_type_idx
        ON trusted_devices(device_type)
        WHERE revoked_at IS NULL AND device_type IS NOT NULL;
    `);
  }
} as const;
