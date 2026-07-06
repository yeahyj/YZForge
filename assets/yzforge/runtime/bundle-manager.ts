import { assetManager, AssetManager } from 'cc';
import { YZForgeError } from './errors';
import type { Logger } from './logger';

export enum BundleState {
    Empty = 'empty',
    Loading = 'loading',
    Loaded = 'loaded',
    Releasing = 'releasing',
    Failed = 'failed',
    FailedRelease = 'failed-release',
}

interface BundleRecord {
    state: BundleState;
    refCount: number;
    bundle?: AssetManager.Bundle;
    task?: Promise<AssetManager.Bundle>;
}

export interface BundleRecordSnapshot {
    readonly name: string;
    readonly state: BundleState;
    readonly refCount: number;
    readonly loaded: boolean;
    readonly loading: boolean;
}

export interface BundleManagerOptions {
    readonly unload?: 'immediate' | 'manual';
}

export interface LoadBundleOptions {
    readonly acquire?: boolean;
}

export interface ReleaseBundleOptions {
    readonly unload?: boolean;
    readonly force?: boolean;
    readonly count?: number;
}

export class BundleManager {
    private readonly records = new Map<string, BundleRecord>();

    public constructor(
        private readonly logger?: Logger,
        private readonly options: BundleManagerOptions = {},
    ) {}

    public getState(bundleName: string): BundleState {
        return this.records.get(bundleName)?.state ?? BundleState.Empty;
    }

    public getRefCount(bundleName: string): number {
        return this.records.get(bundleName)?.refCount ?? 0;
    }

    public snapshot(bundleName: string): BundleRecordSnapshot {
        const record = this.records.get(bundleName);
        if (!record) {
            return {
                name: bundleName,
                state: BundleState.Empty,
                refCount: 0,
                loaded: Boolean(assetManager.getBundle(bundleName)),
                loading: false,
            };
        }
        return this.snapshotRecord(bundleName, record);
    }

    public snapshots(): BundleRecordSnapshot[] {
        return Array.from(this.records.entries()).map(([name, record]) => this.snapshotRecord(name, record));
    }

    public async preloadBundle(bundleName: string): Promise<AssetManager.Bundle> {
        return this.loadBundle(bundleName, { acquire: false });
    }

    public async loadBundle(
        bundleName: string,
        options: LoadBundleOptions = {},
    ): Promise<AssetManager.Bundle> {
        const acquire = options.acquire !== false;
        let record = this.records.get(bundleName);
        const loaded = assetManager.getBundle(bundleName);
        if (loaded) {
            if (!record) {
                record = { state: BundleState.Loaded, refCount: 0, bundle: loaded };
                this.records.set(bundleName, record);
            }
            record.state = BundleState.Loaded;
            record.bundle = loaded;
            if (acquire) {
                record.refCount += 1;
            }
            return loaded;
        }

        if (record?.task) {
            const bundle = await record.task;
            if (acquire) {
                record.refCount += 1;
            }
            return bundle;
        }

        record = record ?? { state: BundleState.Empty, refCount: 0 };
        record.state = BundleState.Loading;
        record.task = new Promise<AssetManager.Bundle>((resolve, reject) => {
            assetManager.loadBundle(bundleName, (error, bundle) => {
                if (error || !bundle) {
                    reject(error ?? new Error(`Bundle not returned: ${bundleName}`));
                    return;
                }
                resolve(bundle);
            });
        });
        this.records.set(bundleName, record);

        try {
            const bundle = await record.task;
            record.bundle = bundle;
            record.state = BundleState.Loaded;
            record.task = undefined;
            if (acquire) {
                record.refCount += 1;
            }
            this.logger?.debug(`Bundle loaded: ${bundleName}`, { refCount: record.refCount });
            return bundle;
        } catch (error) {
            record.state = BundleState.Failed;
            record.task = undefined;
            throw new YZForgeError(`Failed to load bundle: ${bundleName}`, 'bundle.load_failed', error);
        }
    }

    public async releaseBundle(bundleName: string, options: ReleaseBundleOptions = {}): Promise<void> {
        const record = this.records.get(bundleName);
        if (!record) {
            this.logger?.warn(`Bundle release ignored because it was not managed: ${bundleName}`);
            return;
        }
        const releaseCount = Math.max(1, options.count ?? 1);
        if (!options.force && record.refCount > 0) {
            if (releaseCount > record.refCount) {
                this.logger?.warn(`Bundle release exceeded refCount: ${bundleName}`, {
                    refCount: record.refCount,
                    releaseCount,
                });
            }
            record.refCount = Math.max(0, record.refCount - releaseCount);
        }
        if (record.refCount > 0 || !record.bundle) {
            return;
        }
        const unload = options.unload ?? this.options.unload !== 'manual';
        if (!unload && !options.force) {
            return;
        }
        record.state = BundleState.Releasing;
        try {
            record.bundle.releaseAll();
            assetManager.removeBundle(record.bundle);
            this.records.delete(bundleName);
            this.logger?.debug(`Bundle released: ${bundleName}`);
        } catch (error) {
            record.state = BundleState.FailedRelease;
            throw new YZForgeError(`Failed to release bundle: ${bundleName}`, 'bundle.release_failed', error);
        }
    }

    public async unloadBundle(bundleName: string): Promise<void> {
        await this.releaseBundle(bundleName, { force: true });
    }

    private snapshotRecord(name: string, record: BundleRecord): BundleRecordSnapshot {
        return {
            name,
            state: record.state,
            refCount: record.refCount,
            loaded: Boolean(record.bundle),
            loading: Boolean(record.task),
        };
    }
}
