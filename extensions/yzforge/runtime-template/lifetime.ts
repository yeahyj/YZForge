import type { MaybePromise } from './types';
import { YZForgeError } from './errors';

export type ReleaseReason = unknown;

export type ReleaseTask = (reason: ReleaseReason) => MaybePromise<void>;

export interface OwnerIdentity {
    readonly id: string;
    readonly path: string;
    readonly generation: number;
}

export interface ReleaseScopeSnapshot extends OwnerIdentity {
    readonly kind: string;
    readonly key: string;
    readonly released: boolean;
    readonly releasing: boolean;
    readonly actionCount: number;
    readonly lastFailure?: ReleaseScopeFailureSnapshot;
    readonly children: readonly ReleaseScopeSnapshot[];
}

export interface ReleaseScopeFailureSnapshot {
    readonly code: 'release.scope_failed';
    readonly message: string;
    readonly errors: readonly unknown[];
}

export type OwnershipKind = 'bundle' | 'asset' | 'library' | 'content-pack' | 'view' | 'node' | 'lease' | 'custom';

export interface OwnershipRecordSnapshot {
    readonly ownerId: string;
    readonly ownerPath: string;
    readonly kind: OwnershipKind;
    readonly key: string;
    readonly count: number;
    readonly detail?: Record<string, unknown>;
}

export interface OwnershipScopeSnapshot extends OwnerIdentity {
    readonly kind: string;
    readonly key: string;
    readonly released: boolean;
    readonly lastFailure?: ReleaseScopeFailureSnapshot;
}

export interface OwnershipLedgerSnapshot {
    readonly scopes: readonly OwnershipScopeSnapshot[];
    readonly holdings: readonly OwnershipRecordSnapshot[];
    readonly leaks: readonly OwnershipRecordSnapshot[];
}

interface ReleaseAction {
    readonly label: string;
    readonly task: ReleaseTask;
    active: boolean;
}

interface OwnershipRecord {
    readonly ownerId: string;
    readonly ownerPath: string;
    readonly kind: OwnershipKind;
    readonly key: string;
    count: number;
    detail?: Record<string, unknown>;
}

const fallbackGenerations = new Map<string, number>();
let fallbackIdentitySerial = 0;

export class OwnershipLedger {
    private readonly scopes = new Map<string, OwnershipScopeSnapshot>();
    private readonly holdings = new Map<string, Map<string, OwnershipRecord>>();
    private readonly generations = new Map<string, number>();
    private identitySerial = 0;

    public createIdentity(path: string): OwnerIdentity {
        const generation = (this.generations.get(path) ?? 0) + 1;
        this.generations.set(path, generation);
        this.identitySerial += 1;
        return {
            id: `owner-${this.identitySerial}:${path}#${generation}`,
            path,
            generation,
        };
    }

    public registerScope(scope: ReleaseScope): void {
        this.scopes.set(scope.ownerId, this.scopeSnapshot(scope, false));
    }

    public markScopeReleased(scope: ReleaseScope): void {
        this.scopes.set(scope.ownerId, this.scopeSnapshot(scope, true));
    }

    public acquire(
        owner: OwnerRef,
        kind: OwnershipKind,
        key: string,
        detail?: Record<string, unknown>,
        count = 1,
    ): void {
        const identity = ownerIdentityOf(owner);
        let records = this.holdings.get(identity.id);
        if (!records) {
            records = new Map();
            this.holdings.set(identity.id, records);
        }
        const recordKey = this.recordKey(kind, key);
        const existing = records.get(recordKey);
        if (existing) {
            existing.count += Math.max(1, count);
            existing.detail = detail ?? existing.detail;
            return;
        }
        records.set(recordKey, {
            ownerId: identity.id,
            ownerPath: identity.path,
            kind,
            key,
            count: Math.max(1, count),
            detail,
        });
    }

    public release(owner: OwnerRef, kind: OwnershipKind, key: string, count = 1): void {
        const identity = ownerIdentityOf(owner);
        const records = this.holdings.get(identity.id);
        if (!records) {
            return;
        }
        const recordKey = this.recordKey(kind, key);
        const existing = records.get(recordKey);
        if (!existing) {
            return;
        }
        existing.count = Math.max(0, existing.count - Math.max(1, count));
        if (existing.count === 0) {
            records.delete(recordKey);
        }
        if (records.size === 0) {
            this.holdings.delete(identity.id);
        }
    }

    public snapshot(): OwnershipLedgerSnapshot {
        const records: OwnershipRecord[] = [];
        for (const ownerRecords of this.holdings.values()) {
            records.push(...ownerRecords.values());
        }
        const holdings = records
            .map((record): OwnershipRecordSnapshot => ({
                ownerId: record.ownerId,
                ownerPath: record.ownerPath,
                kind: record.kind,
                key: record.key,
                count: record.count,
                ...(record.detail ? { detail: record.detail } : {}),
            }))
            .sort((left, right) => {
                return `${left.ownerId}:${left.kind}:${left.key}`.localeCompare(`${right.ownerId}:${right.kind}:${right.key}`);
            });
        const scopes = Array.from(this.scopes.values()).sort((left, right) => left.id.localeCompare(right.id));
        const releasedScopes = new Set(scopes.filter((scope) => scope.released).map((scope) => scope.id));
        return {
            scopes,
            holdings,
            leaks: holdings.filter((record) => releasedScopes.has(record.ownerId)),
        };
    }

    private scopeSnapshot(scope: ReleaseScope, released: boolean): OwnershipScopeSnapshot {
        return {
            id: scope.ownerId,
            path: scope.ownerPath,
            generation: scope.generation,
            kind: scope.kind,
            key: scope.key,
            released,
            ...(scope.lastFailure ? { lastFailure: scope.lastFailure } : {}),
        };
    }

    private recordKey(kind: OwnershipKind, key: string): string {
        return `${kind}:${key}`;
    }
}

export type OwnerRef = OwnerIdentity | ReleaseScope;

export function ownerIdentityOf(owner: OwnerRef): OwnerIdentity {
    return owner instanceof ReleaseScope
        ? { id: owner.ownerId, path: owner.ownerPath, generation: owner.generation }
        : owner;
}

export function ownerIdOf(owner: OwnerRef): string {
    return ownerIdentityOf(owner).id;
}

export class ReleaseScope {
    private readonly actions: ReleaseAction[] = [];
    private readonly activeChildren = new Map<string, ReleaseScope>();
    private releaseTask?: Promise<void>;
    private readonly identity: OwnerIdentity;

    public released = false;
    public releasing = false;
    public lastFailure?: ReleaseScopeFailureSnapshot;

    public constructor(
        public readonly kind: string,
        public readonly key: string,
        private readonly ledger?: OwnershipLedger,
        private readonly parent?: ReleaseScope,
    ) {
        const path = parent ? `${parent.ownerPath}/${kind}:${key}` : `${kind}:${key}`;
        this.identity = ledger?.createIdentity(path) ?? createFallbackIdentity(path);
        this.ledger?.registerScope(this);
    }

    public get ownerId(): string {
        return this.identity.id;
    }

    public get ownerPath(): string {
        return this.identity.path;
    }

    public get generation(): number {
        return this.identity.generation;
    }

    public get active(): boolean {
        return !this.released && !this.releasing;
    }

    public child(kind: string, key: string): ReleaseScope {
        this.assertAccepting('create child scope');
        const scope = new ReleaseScope(kind, key, this.ledger, this);
        this.activeChildren.set(scope.ownerId, scope);
        return scope;
    }

    public defer(label: string, task: ReleaseTask): () => void {
        this.assertAccepting(`register release action '${label}'`);
        const action: ReleaseAction = { label, task, active: true };
        this.actions.push(action);
        return () => {
            action.active = false;
        };
    }

    public async release(reason: ReleaseReason = { type: 'release_scope' }): Promise<void> {
        if (this.released) {
            return;
        }
        if (this.releaseTask) {
            return await this.releaseTask;
        }
        this.releaseTask = this.releaseNow(reason);
        return await this.releaseTask;
    }

    public snapshot(): ReleaseScopeSnapshot {
        return {
            id: this.ownerId,
            path: this.ownerPath,
            generation: this.generation,
            kind: this.kind,
            key: this.key,
            released: this.released,
            releasing: this.releasing,
            actionCount: this.actions.filter((action) => action.active).length,
            ...(this.lastFailure ? { lastFailure: this.lastFailure } : {}),
            children: Array.from(this.activeChildren.values()).map((scope) => scope.snapshot()),
        };
    }

    private async releaseNow(reason: ReleaseReason): Promise<void> {
        this.releasing = true;
        const errors: unknown[] = [];
        try {
            for (const child of Array.from(this.activeChildren.values()).reverse()) {
                try {
                    await child.release(reason);
                } catch (error) {
                    errors.push(error);
                }
            }
            for (const action of Array.from(this.actions).reverse()) {
                if (!action.active) {
                    continue;
                }
                action.active = false;
                try {
                    await action.task(reason);
                } catch (error) {
                    errors.push(error);
                }
            }
        } finally {
            this.activeChildren.clear();
            this.actions.length = 0;
            this.releasing = false;
            this.released = true;
            this.parent?.detachChild(this);
        }
        if (errors.length > 0) {
            this.lastFailure = {
                code: 'release.scope_failed',
                message: `ReleaseScope completed with errors: ${this.ownerPath} (${this.ownerId})`,
                errors: errors.map((error) => describeError(error)),
            };
            this.ledger?.markScopeReleased(this);
            throw new YZForgeError(this.lastFailure.message, this.lastFailure.code, {
                ownerId: this.ownerId,
                ownerPath: this.ownerPath,
                errors: this.lastFailure.errors,
            });
        }
        this.lastFailure = undefined;
        this.ledger?.markScopeReleased(this);
    }

    private detachChild(scope: ReleaseScope): void {
        this.activeChildren.delete(scope.ownerId);
    }

    private assertAccepting(operation: string): void {
        if (this.active) {
            return;
        }
        throw new YZForgeError(
            `ReleaseScope cannot ${operation} after release has started: ${this.ownerPath}`,
            'release.scope_closed',
            { ownerId: this.ownerId, ownerPath: this.ownerPath, operation },
        );
    }
}

function createFallbackIdentity(path: string): OwnerIdentity {
    const generation = (fallbackGenerations.get(path) ?? 0) + 1;
    fallbackGenerations.set(path, generation);
    fallbackIdentitySerial += 1;
    return {
        id: `owner-fallback-${fallbackIdentitySerial}:${path}#${generation}`,
        path,
        generation,
    };
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
