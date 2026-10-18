import { parseProcessRole, runsWorkers } from './process-role';

describe('process role (M7-7)', () => {
  it('defaults to all when unset or blank', () => {
    expect(parseProcessRole(undefined)).toBe('all');
    expect(parseProcessRole('  ')).toBe('all');
  });

  it('accepts all, api and worker (any case)', () => {
    expect(parseProcessRole('api')).toBe('api');
    expect(parseProcessRole('WORKER')).toBe('worker');
    expect(parseProcessRole('all')).toBe('all');
  });

  it('rejects an unknown role instead of silently running everything', () => {
    expect(() => parseProcessRole('workers')).toThrow(/Invalid PROCESS_ROLE/);
  });

  it('runs workers unless the config says false', () => {
    expect(runsWorkers({ get: () => undefined })).toBe(true);
    expect(runsWorkers({ get: () => true })).toBe(true);
    expect(runsWorkers({ get: () => false })).toBe(false);
  });
});
