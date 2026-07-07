import type { MaybePromise } from './types';

export type ReleaseReason = unknown;

export type ReleaseTask = (reason: ReleaseReason) => MaybePromise<void>;

export interface ReleaseScopeSnapshot {
    readonly ownerKey: string;
    readonly kind: string;
    readonly key: string;
    readonly released: boolean;
    readonly releasing: boolean;
    readonly actionCount: number;
    readonly children: readonly ReleaseScopeSnapshot[];
}

export type OwnershipKind = 'bundle' | 'asset' | 'library' | 'content-pack' | 'view' | 'node' | 'custom';

export interface OwnershipRecordSnapshot {
    readonly ownerKey: string;
    readonly kind: OwnershipKind;
    readonly key: string;
    readonly count: number;
    readonly detail?: Record<string, unknown>;
}

export interface OwnershipScopeSnapshot {
    readonly ownerKey: string;
    readonly kind: string;
    readonly key: string;
    readonly released: boolean;
}

export interface OwnershipLedgerSnapshot {
    readonly scopes: readonly OwnershipScopeSnapshot[];
    readonly holdings: readonly OwnershipRecordSnapshot[];
}

interface ReleaseAction {
    readonly label: string;
    readonly task: ReleaseTask;
    active: boolean;
}

interface OwnershipRecord {
    readonly ownerKey: string;
    readonly kind: OwnershipKind;
    readonly key: string;
    count: number;
    detail?: Record<string, unknown>;
}

export class OwnershipLedger {
    private readonly scopes = new Map<string, OwnershipScopeSnapshot>();
    private readonly holdings = new Map<string, Map<string, OwnershipRecord>>();

    public registerScope(scope: ReleaseScope): void {
        this.scopes.set(scope.ownerKey, {
            ownerKey: scope.ownerKey,
            kind: scope.kind,
            key: scope.key,
            released: scope.released,
        });
    }

    public markScopeReleased(scope: ReleaseScope): void {
        this.scopes.set(scope.ownerKey, {
            ownerKey: scope.ownerKey,
            kind: scope.kind,
            key: scope.key,
            released: true,
        });
    }

    public acquire(
        owner: OwnerRef,
        kind: OwnershipKind,
        key: string,
        detail?: Record<string, unknown>,
        count = 1,
    ): void {
        const ownerKey = ownerKeyOf(owner);
        let records = this.holdings.get(ownerKey);
        if (!records) {
            records = new Map();
            this.holdings.set(ownerKey, records);
        }
        const recordKey = this.recordKey(kind, key);
        const existing = records.get(recordKey);
        if (existing) {
            existing.count += Math.max(1, count);
            existing.detail = detail ?? existing.detail;
            return;
        }
        records.set(recordKey, {
            ownerKey,
            kind,
            key,
            count: Math.max(1, count),
            detail,
        });
    }

    public release(owner: OwnerRef, kind: OwnershipKind, key: string, count = 1): void {
        const ownerKey = ownerKeyOf(owner);
        const records = this.holdings.get(ownerKey);
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
            this.holdings.delete(ownerKey);
        }
    }

    public snapshot(): OwnershipLedgerSnapshot {
        const records: OwnershipRecord[] = [];
        for (const ownerRecords of this.holdings.values()) {
            records.push(...ownerRecords.values());
        }
        const holdings = records
            .map((record): OwnershipRecordSnapshot => ({
                ownerKey: record.ownerKey,
                kind: record.kind,
                key: record.key,
                count: record.count,
                ...(record.detail ? { detail: record.detail } : {}),
            }))
            .sort((a: OwnershipRecordSnapshot, b: OwnershipRecordSnapshot) => {
                return `${a.ownerKey}:${a.kind}:${a.key}`.localeCompare(`${b.ownerKey}:${b.kind}:${b.key}`);
            });
        const scopes = Array.from(this.scopes.values())
            .sort((a, b) => a.ownerKey.localeCompare(b.ownerKey));
        return {
            scopes,
            holdings,
        };
    }

    private recordKey(kind: OwnershipKind, key: string): string {
        return `${kind}:${key}`;
    }
}

export type OwnerRef = string | ReleaseScope;

export function ownerKeyOf(owner: OwnerRef): string {
    return typeof owner === 'string' ? owner : owner.ownerKey;
}

export class ReleaseScope {
    private readonly actions: ReleaseAction[] = [];
    private readonly childScopes: ReleaseScope[] = [];
    private releaseTask?: Promise<void>;

    public readonly ownerKey: string;
    public released = false;
    public releasing = false;

    public constructor(
        public readonly kind: string,
        public readonly key: string,
        private readonly ledger?: OwnershipLedger,
        private readonly parent?: ReleaseScope,
    ) {
        this.ownerKey = parent ? `${parent.ownerKey}/${kind}:${key}` : `${kind}:${key}`;
        this.ledger?.registerScope(this);
    }

    public child(kind: string, key: string): ReleaseScope {
        const scope = new ReleaseScope(kind, key, this.ledger, this);
        this.childScopes.push(scope);
        return scope;
    }

    public defer(label: string, task: ReleaseTask): () => void {
        const action: ReleaseAction = {
            label,
            task,
            active: true,
        };
        if (this.released || this.releasing) {
            action.active = false;
            void Promise.resolve(task({ type: 'scope_already_released', scope: this.ownerKey })).catch(() => {});
            return () => {};
        }
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
            return this.releaseTask;
        }
        this.releaseTask = this.releaseNow(reason);
        try {
            await this.releaseTask;
        } finally {
            if (this.released) {
                this.releaseTask = undefined;
            }
        }
    }

    public snapshot(): ReleaseScopeSnapshot {
        return {
            ownerKey: this.ownerKey,
            kind: this.kind,
            key: this.key,
            released: this.released,
            releasing: this.releasing,
            actionCount: this.actions.filter((action) => action.active).length,
            children: this.childScopes.map((scope) => scope.snapshot()),
        };
    }

    private async releaseNow(reason: ReleaseReason): Promise<void> {
        if (this.released) {
            return;
        }
        this.releasing = true;
        const errors: unknown[] = [];
        for (const child of Array.from(this.childScopes).reverse()) {
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
        this.childScopes.length = 0;
        this.actions.length = 0;
        this.releasing = false;
        this.released = true;
        this.ledger?.markScopeReleased(this);
        if (errors.length > 0) {
            throw errors[0];
        }
    }
}
