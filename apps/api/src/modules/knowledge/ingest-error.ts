/**
 * An indexing failure the company can act on (an unreadable or empty file).
 * The message is shown in the dashboard as the source's `error`, and the
 * job isn't retried: the same file would fail the same way.
 */
export class IngestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IngestError';
  }
}
