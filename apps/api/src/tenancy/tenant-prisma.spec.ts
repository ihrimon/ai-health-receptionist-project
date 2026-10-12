import { scopeArgs } from './tenant-prisma';

const A = 'ws-a';

describe('scopeArgs (tenant query rewriting)', () => {
  describe('tenant models', () => {
    it.each(['findMany', 'findFirst', 'count', 'updateMany', 'deleteMany'])(
      '%s ANDs the workspace onto the existing filter',
      (operation) => {
        expect(
          scopeArgs('Chatbot', operation, { where: { status: 'ENABLED' } }, A),
        ).toEqual({
          where: { AND: [{ status: 'ENABLED' }, { workspaceId: A }] },
        });
      },
    );

    it('scopes a query with no filter at all', () => {
      expect(scopeArgs('Chatbot', 'findMany', undefined, A)).toEqual({
        where: { AND: [{}, { workspaceId: A }] },
      });
    });

    it.each(['findUnique', 'update', 'delete'])(
      '%s adds the workspace to the unique filter',
      (operation) => {
        expect(
          scopeArgs('Chatbot', operation, { where: { id: 'bot-b' } }, A),
        ).toEqual({ where: { id: 'bot-b', workspaceId: A } });
      },
    );

    it('overrides a caller-supplied workspaceId instead of trusting it', () => {
      expect(
        scopeArgs(
          'Chatbot',
          'findUnique',
          { where: { workspaceId: 'ws-b' } },
          A,
        ),
      ).toEqual({ where: { workspaceId: A } });
    });

    it('create sets (and overrides) workspaceId', () => {
      expect(
        scopeArgs(
          'Chatbot',
          'create',
          { data: { publicId: 'cb_1', workspaceId: 'ws-b' } },
          A,
        ),
      ).toEqual({ data: { publicId: 'cb_1', workspaceId: A } });
    });

    it('createMany sets workspaceId on every row', () => {
      expect(
        scopeArgs(
          'Chatbot',
          'createMany',
          { data: [{ publicId: '1' }, { publicId: '2' }] },
          A,
        ),
      ).toEqual({
        data: [
          { publicId: '1', workspaceId: A },
          { publicId: '2', workspaceId: A },
        ],
      });
    });

    it('refuses a create through the workspace relation', () => {
      expect(() =>
        scopeArgs(
          'Chatbot',
          'create',
          { data: { workspace: { connect: { id: 'ws-b' } } } },
          A,
        ),
      ).toThrow('not a workspace relation');
    });

    it.each([
      ['update', { where: { id: '1' }, data: { workspaceId: 'ws-b' } }],
      ['updateMany', { data: { workspace: { connect: { id: 'ws-b' } } } }],
      [
        'upsert',
        { where: { id: '1' }, update: { workspaceId: 'ws-b' }, create: {} },
      ],
    ])(
      'refuses to move a row to another workspace with %s',
      (operation, args) => {
        expect(() => scopeArgs('Chatbot', operation, args, A)).toThrow(
          "workspace can't be changed",
        );
      },
    );

    it('upsert scopes both the lookup and the create', () => {
      expect(
        scopeArgs(
          'Chatbot',
          'upsert',
          { where: { id: '1' }, update: {}, create: { publicId: 'x' } },
          A,
        ),
      ).toEqual({
        where: { id: '1', workspaceId: A },
        update: {},
        create: { publicId: 'x', workspaceId: A },
      });
    });

    it('refuses operations it does not know how to scope', () => {
      expect(() => scopeArgs('Chatbot', 'somethingNew', {}, A)).toThrow(
        'Unsupported tenant operation',
      );
    });
  });

  describe('the Workspace model', () => {
    it('limits unique lookups and updates to your own workspace (B finds nothing)', () => {
      expect(
        scopeArgs(
          'Workspace',
          'update',
          { where: { id: 'ws-b' }, data: { name: 'x' } },
          A,
        ),
      ).toEqual({
        where: { id: 'ws-b', AND: [{ id: A }] },
        data: { name: 'x' },
      });
    });

    it('limits lists to your own workspace', () => {
      expect(scopeArgs('Workspace', 'findMany', {}, A)).toEqual({
        where: { AND: [{}, { id: A }] },
      });
    });

    it('cannot create workspaces', () => {
      expect(() => scopeArgs('Workspace', 'create', { data: {} }, A)).toThrow(
        'created by WorkspacesService',
      );
    });
  });
});
