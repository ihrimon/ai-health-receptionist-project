import { runAsSystem, runWithTenant } from '../tenancy/tenant-context';
import { rlsSettingsQuery } from './rls-adapter';

const WS = '123e4567-e89b-42d3-a456-426614174000';
const tenant = (workspaceId: string) => ({
  workspaceId,
  userId: 'u',
  role: 'OWNER' as const,
});

describe('rlsSettingsQuery', () => {
  it('sets nothing outside a tenant or system context (fail closed)', () => {
    expect(rlsSettingsQuery()).toBeNull();
  });

  it("sets the tenant's workspace and keeps the bypass off", () => {
    runWithTenant(tenant(WS), () => {
      expect(rlsSettingsQuery()?.args).toEqual([WS, 'off']);
    });
  });

  it('turns the bypass on inside runAsSystem, with no workspace', async () => {
    await runAsSystem('test', async () => {
      expect(rlsSettingsQuery()?.args).toEqual(['', 'on']);
      await Promise.resolve();
      expect(rlsSettingsQuery()?.args).toEqual(['', 'on']);
    });
    expect(rlsSettingsQuery()).toBeNull();
  });

  it('uses only transaction-local settings (the third argument is true)', () => {
    runWithTenant(tenant(WS), () => {
      const sql = rlsSettingsQuery()?.sql ?? '';
      expect(sql.match(/set_config\([^)]*\)/g)).toEqual([
        "set_config('app.workspace_id', $1, true)",
        "set_config('app.rls_bypass', $2, true)",
      ]);
    });
  });

  it('refuses a workspace id that is not a uuid', () => {
    runWithTenant(tenant("x'; --"), () => {
      expect(() => rlsSettingsQuery()).toThrow(/Invalid workspace id/);
    });
  });
});
