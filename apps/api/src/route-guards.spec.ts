import 'reflect-metadata';
import { readdirSync, statSync } from 'fs';
import { join } from 'path';
import { IS_PUBLIC_KEY } from './modules/auth/auth.constants';
import {
  HiddenPlatformAdminGuard,
  PlatformAdminGuard,
} from './modules/auth/platform-admin.guard';
import { WorkspaceGuard } from './tenancy/workspace.guard';

/**
 * Route inventory (M7-2). SessionGuard already refuses anything not marked
 * @Public(), but a new route could still be reachable by any logged-in user
 * of any workspace if it forgot @Roles(). This test lists every route and
 * fails on one that is neither workspace-guarded, platform-admin-guarded,
 * nor explicitly allowed below.
 */

/** Open to anyone, no login (SessionGuard skips them). Keep this short. */
const PUBLIC_ROUTES = new Set([
  'AppController.getHello',
  'HealthController.check',
  'AuthController.register',
  'AuthController.login',
  'AuthController.logout',
  'AuthController.forgotPassword',
  'AuthController.resetPassword',
  'AuthController.verifyEmail',
  'PublicChatController.config',
  'PublicChatController.startConversation',
  'PublicChatController.send',
  'PublicChatController.history',
  'PublicChatController.rate',
  'WidgetPageController.page',
  'WidgetPageController.asset',
  'WidgetPageController.loader',
]);

/** Needs a login only: they act on the caller's own user or session. */
const SESSION_ONLY_ROUTES = new Set([
  'AuthController.me',
  'AuthController.resendVerification',
  'WorkspacesController.switch',
]);

const GUARDED = [WorkspaceGuard, HiddenPlatformAdminGuard, PlatformAdminGuard];

function controllerFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === 'generated' || name === 'node_modules') return [];
    if (statSync(path).isDirectory()) return controllerFiles(path);
    return name.endsWith('.controller.ts') ? [path] : [];
  });
}

interface Route {
  id: string;
  isPublic: boolean;
  guards: unknown[];
}

function routes(): Route[] {
  const found: Route[] = [];
  for (const file of controllerFiles(__dirname)) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const exported = require(file) as Record<string, unknown>;
    for (const value of Object.values(exported)) {
      if (
        typeof value !== 'function' ||
        Reflect.getMetadata('path', value) === undefined
      ) {
        continue;
      }
      const proto = (value as { prototype: Record<string, unknown> }).prototype;
      for (const name of Object.getOwnPropertyNames(proto)) {
        const handler = proto[name];
        if (
          name === 'constructor' ||
          typeof handler !== 'function' ||
          Reflect.getMetadata('method', handler) === undefined
        ) {
          continue;
        }
        const classGuards =
          (Reflect.getMetadata('__guards__', value) as unknown[]) ?? [];
        const methodGuards =
          (Reflect.getMetadata('__guards__', handler) as unknown[]) ?? [];
        found.push({
          id: `${(value as { name: string }).name}.${name}`,
          isPublic:
            Reflect.getMetadata(IS_PUBLIC_KEY, handler) === true ||
            Reflect.getMetadata(IS_PUBLIC_KEY, value) === true,
          guards: [...classGuards, ...methodGuards],
        });
      }
    }
  }
  return found;
}

describe('route guards', () => {
  const all = routes();

  it('finds the controllers', () => {
    expect(all.length).toBeGreaterThan(60);
  });

  it('only the listed routes are public', () => {
    const open = all.filter((r) => r.isPublic).map((r) => r.id);
    expect(open.sort()).toEqual([...PUBLIC_ROUTES].sort());
  });

  it('every other route is workspace- or platform-admin-guarded, or login-only by name', () => {
    const unguarded = all
      .filter((r) => !r.isPublic)
      .filter((r) => !r.guards.some((g) => GUARDED.includes(g as never)))
      .map((r) => r.id)
      .sort();
    expect(unguarded).toEqual([...SESSION_ONLY_ROUTES].sort());
  });
});
