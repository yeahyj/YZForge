export class FrameworkError extends Error {
  readonly code: string;
  readonly details: Readonly<Record<string, unknown>>;
  constructor(code: string, message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = 'FrameworkError';
    this.code = code;
    this.details = details;
  }
}
export class OperationCancelled extends FrameworkError {
  constructor(message = 'The owner has ended') { super('OPERATION_CANCELLED', message); }
}
export function invariant(condition: unknown, code: string, message: string): asserts condition {
  if (!condition) throw new FrameworkError(code, message);
}
export type ErrorReporter = (error: unknown) => void;
export const reportError: ErrorReporter = error => console.error('[YZForge]', error);
