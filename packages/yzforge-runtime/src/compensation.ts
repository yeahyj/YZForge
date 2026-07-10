import { YZForgeError } from './errors';
import type { MaybePromise } from './types';

export interface CompensationFailure {
    readonly step: string;
    readonly error: unknown;
}

export type CompensationTask = (reason: unknown) => MaybePromise<void>;

interface CompensationAction {
    readonly step: string;
    readonly task: CompensationTask;
    active: boolean;
}

export class CompensationStack {
    private readonly actions: CompensationAction[] = [];
    private finished = false;

    public constructor(public readonly operation: string) {}

    public defer(step: string, task: CompensationTask): () => void {
        if (this.finished) {
            throw new YZForgeError(`Compensation transaction is already finished: ${this.operation}`, 'compensation.closed', {
                operation: this.operation,
                step,
            });
        }
        const action: CompensationAction = { step, task, active: true };
        this.actions.push(action);
        return () => {
            action.active = false;
        };
    }

    public commit(): void {
        this.finished = true;
        this.actions.length = 0;
    }

    public async rollback(reason: unknown): Promise<CompensationFailure[]> {
        if (this.finished) {
            return [];
        }
        this.finished = true;
        const failures: CompensationFailure[] = [];
        for (const action of Array.from(this.actions).reverse()) {
            if (!action.active) {
                continue;
            }
            action.active = false;
            try {
                await action.task(reason);
            } catch (error) {
                failures.push({ step: action.step, error });
            }
        }
        this.actions.length = 0;
        return failures;
    }

    public async fail(primary: unknown, reason: unknown = { type: 'compensation_rollback' }): Promise<never> {
        const rollbackFailures = await this.rollback(reason);
        if (rollbackFailures.length === 0) {
            throw primary;
        }
        throw new YZForgeError(`${this.operation} failed and compensation reported errors.`, 'compensation.failed', {
            operation: this.operation,
            primary: describeError(primary),
            rollbackFailures: rollbackFailures.map((failure) => ({
                step: failure.step,
                error: describeError(failure.error),
            })),
        });
    }
}

export async function runCleanupSteps(
    operation: string,
    steps: readonly { readonly step: string; readonly task: () => MaybePromise<void> }[],
): Promise<void> {
    const failures: CompensationFailure[] = [];
    for (const item of steps) {
        try {
            await item.task();
        } catch (error) {
            failures.push({ step: item.step, error });
        }
    }
    if (failures.length > 0) {
        throw new YZForgeError(`${operation} completed with errors.`, 'cleanup.failed', {
            operation,
            failures: failures.map((failure) => ({ step: failure.step, error: describeError(failure.error) })),
        });
    }
}

function describeError(error: unknown): unknown {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
            ...(error instanceof YZForgeError ? { code: error.code, details: error.details } : {}),
        };
    }
    return error;
}
