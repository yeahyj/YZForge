import { JsonAsset } from 'cc';
import { ContentPackAssetScope, type AssetScopeSnapshot } from './assets';
import type { BundleLease } from './bundle-manager';
import type { ConfigScope } from './config';
import { YZForgeError } from './errors';
import type { AppKernel } from './kernel';
import { ownerIdentityOf, type OwnerIdentity, type ReleaseScope } from './lifetime';
import {
    assetRef,
    type ContentPackAssetContract,
    type ContentPackAssetRef,
    type ContentPackConfigContract,
    type ContentPackConfigRef,
    type ContentPackManifest,
    type ContentPackManifestRef,
    type ContentPackRef,
    type MaterializedContentPackRefs,
} from './refs';
import { CompensationStack, runCleanupSteps } from './compensation';
import { YZFORGE_RUNTIME_ABI } from './runtime-version';

export interface ContentPackLoadPlan {
    readonly id: string;
    readonly owner: string;
    readonly name: string;
    readonly bundleName: string;
    readonly dependencies: readonly string[];
    readonly contractKeys: readonly string[];
}

export interface ContentPackLease<TContract = unknown, TConfig = unknown> {
    readonly leaseId: string;
    readonly ref: ContentPackRef<TContract, TConfig>;
    readonly bundleName: string;
    readonly refs: MaterializedContentPackRefs<TContract>;
    readonly manifest: ContentPackManifest;
    readonly assets: ContentPackAssetScope;
    readonly config: ConfigScope<TConfig>;
    readonly released: boolean;
    release(reason?: unknown): Promise<void>;
}

export interface ContentPackRecordSnapshot {
    readonly id: string;
    readonly owner: string;
    readonly name: string;
    readonly bundleName: string;
    readonly leaseCount: number;
    readonly dependencies: readonly string[];
    readonly contentHash: string;
    readonly manifest: ContentPackManifest;
    readonly assets: AssetScopeSnapshot;
}

interface ContentPackRecord {
    readonly ref: ContentPackRef;
    readonly bundle: BundleLease;
    readonly scope: ReleaseScope;
    readonly assets: ContentPackAssetScope;
    readonly refs: Record<string, ContentPackAssetRef | ContentPackConfigRef>;
    readonly manifest: ContentPackManifest;
    readonly config: ConfigScope<unknown>;
    readonly leases: Map<string, ContentPackLeaseImpl>;
}

class ContentPackLeaseImpl implements ContentPackLease<Record<string, unknown>, unknown> {
    private leaseReleased = false;
    private detachOwnerRelease?: () => void;

    public constructor(
        private readonly manager: ContentPackManager,
        private readonly record: ContentPackRecord,
        public readonly leaseId: string,
        public readonly owner: OwnerIdentity,
    ) {}

    public get ref(): ContentPackRef<Record<string, unknown>, unknown> {
        return this.record.ref as ContentPackRef<Record<string, unknown>, unknown>;
    }

    public get bundleName(): string {
        return this.record.ref.bundle;
    }

    public get refs(): MaterializedContentPackRefs<Record<string, unknown>> {
        this.assertActive();
        return this.record.refs as MaterializedContentPackRefs<Record<string, unknown>>;
    }

    public get manifest(): ContentPackManifest {
        return this.record.manifest;
    }

    public get assets(): ContentPackAssetScope {
        this.assertActive();
        return this.record.assets;
    }

    public get config(): ConfigScope<unknown> {
        this.assertActive();
        return this.record.config;
    }

    public get released(): boolean {
        return this.leaseReleased;
    }

    public async release(reason: unknown = { type: 'content_pack_lease_release' }): Promise<void> {
        if (this.leaseReleased) {
            return;
        }
        this.leaseReleased = true;
        this.detachOwnerRelease?.();
        this.detachOwnerRelease = undefined;
        await this.manager.releaseLease(this.record, this, reason);
    }

    public attachOwnerRelease(detach: () => void): void {
        this.detachOwnerRelease = detach;
    }

    private assertActive(): void {
        if (!this.leaseReleased) {
            return;
        }
        throw new YZForgeError(`ContentPack lease is released: ${this.ref.id}/${this.leaseId}`, 'content_pack.lease_released', {
            contentPack: this.ref.id,
            leaseId: this.leaseId,
            ownerId: this.owner.id,
        });
    }
}

export class ContentPackManager {
    private readonly records = new Map<string, ContentPackRecord>();
    private readonly inFlight = new Map<string, Promise<ContentPackRecord>>();
    private readonly leases = new Set<ContentPackLease>();
    private nextLeaseId = 0;

    public constructor(
        private readonly kernel: AppKernel,
        private readonly ownerModuleName: string,
        private readonly ownerScope: ReleaseScope,
    ) {}

    public async load<TContract, TConfig>(
        ref: ContentPackRef<TContract, TConfig>,
    ): Promise<ContentPackLease<TContract, TConfig>> {
        this.assertOwner(ref);
        if (!this.ownerScope.active) {
            throw this.acquireCancelled(ref);
        }
        let record = this.records.get(ref.id);
        if (!record) {
            let task = this.inFlight.get(ref.id);
            if (!task) {
                task = this.createRecord(ref);
                this.inFlight.set(ref.id, task);
            }
            try {
                record = await task;
            } finally {
                if (this.inFlight.get(ref.id) === task) {
                    this.inFlight.delete(ref.id);
                }
            }
        }
        if (!this.ownerScope.active) {
            await this.releaseRecordIfUnused(record, { type: 'content_pack_acquire_cancelled' });
            throw this.acquireCancelled(ref);
        }
        const lease = await this.createLease<TContract, TConfig>(record);
        this.leases.add(lease);
        return lease;
    }

    public explain<TContract, TConfig>(ref: ContentPackRef<TContract, TConfig>): ContentPackLoadPlan {
        this.assertOwner(ref);
        return explainContentPack(ref);
    }

    public snapshot(id: string): ContentPackRecordSnapshot | undefined {
        const record = this.records.get(id);
        return record ? this.snapshotRecord(record) : undefined;
    }

    public snapshots(): ContentPackRecordSnapshot[] {
        return Array.from(this.records.values()).map((record) => this.snapshotRecord(record));
    }

    public async releaseAll(reason: unknown = { type: 'content_pack_release_all' }): Promise<void> {
        const leases = Array.from(this.leases).reverse();
        this.leases.clear();
        await runCleanupSteps('contentPack.releaseAll', leases.map((lease) => ({
            step: `release content pack lease:${lease.ref.id}/${lease.leaseId}`,
            task: () => lease.release(reason),
        })));
    }

    public async releaseLease(record: ContentPackRecord, lease: ContentPackLeaseImpl, reason: unknown): Promise<void> {
        this.leases.delete(lease);
        if (!record.leases.delete(lease.leaseId)) {
            return;
        }
        this.kernel.ownership.release(lease.owner, 'content-pack', record.ref.id);
        await this.releaseRecordIfUnused(record, reason);
    }

    private async createRecord<TContract, TConfig>(ref: ContentPackRef<TContract, TConfig>): Promise<ContentPackRecord> {
        const transaction = new CompensationStack(`contentPack.load:${ref.id}`);
        const scope = this.ownerScope.child('content-pack-record', ref.id);
        transaction.defer('release content pack record scope', (reason) => scope.release(reason));
        try {
            for (const library of ref.libraries) {
                await this.kernel.libraries.acquire(library, scope);
            }
            const bundle = await this.kernel.bundles.loadBundle(ref.bundle, scope);
            const assets = new ContentPackAssetScope(
                ref.id,
                bundle,
                this.kernel.logger.child(`content-pack:${ref.id}`),
                scope.child('assets', ref.id),
                this.kernel.ownership,
            );
            const manifestAsset = await assets.load(assetRef(JsonAsset, 'manifest.generated'));
            const manifest = readContentPackManifest(ref, manifestAsset);
            const refs = materializeContentPackRefs(ref.contract, manifest);
            const config = await this.kernel.configs.loadContentPackScope<TConfig>(refs, assets);
            const record: ContentPackRecord = {
                ref,
                bundle,
                scope,
                assets,
                refs,
                manifest,
                config,
                leases: new Map(),
            };
            this.records.set(ref.id, record);
            transaction.commit();
            return record;
        } catch (error) {
            return await transaction.fail(error, { type: 'content_pack_load_failed', contentPack: ref.id });
        }
    }

    private async createLease<TContract, TConfig>(record: ContentPackRecord): Promise<ContentPackLease<TContract, TConfig>> {
        const identity = ownerIdentityOf(this.ownerScope);
        const leaseId = `content-pack-lease-${++this.nextLeaseId}`;
        const lease = new ContentPackLeaseImpl(this, record, leaseId, identity);
        record.leases.set(leaseId, lease);
        this.kernel.ownership.acquire(identity, 'content-pack', record.ref.id, {
            bundleName: record.ref.bundle,
            leaseId,
        });
        try {
            lease.attachOwnerRelease(this.ownerScope.defer(`content-pack-lease:${record.ref.id}:${leaseId}`, (reason) => lease.release(reason)));
        } catch (error) {
            record.leases.delete(leaseId);
            this.kernel.ownership.release(identity, 'content-pack', record.ref.id);
            try {
                await this.releaseRecordIfUnused(record, { type: 'content_pack_lease_attach_failed' });
            } catch (rollbackError) {
                throw new YZForgeError(`ContentPack lease attach and rollback failed: ${record.ref.id}`, 'compensation.failed', {
                    operation: `contentPack.lease.attach:${record.ref.id}`,
                    primary: error,
                    rollbackFailures: [{ step: 'release unused content pack record', error: rollbackError }],
                });
            }
            throw error;
        }
        return lease as unknown as ContentPackLease<TContract, TConfig>;
    }

    private async releaseRecordIfUnused(record: ContentPackRecord, reason: unknown): Promise<void> {
        if (record.leases.size > 0 || this.records.get(record.ref.id) !== record) {
            return;
        }
        this.records.delete(record.ref.id);
        await record.scope.release(reason);
    }

    private assertOwner(ref: ContentPackRef): void {
        if (ref.abi !== YZFORGE_RUNTIME_ABI) {
            throw new YZForgeError(`ContentPack runtime ABI mismatch: ${ref.id}`, 'content_pack.abi_mismatch', {
                expected: YZFORGE_RUNTIME_ABI,
                actual: ref.abi,
            });
        }
        if (ref.owner !== this.ownerModuleName) {
            throw new YZForgeError(`ContentPack owner mismatch: ${ref.id}`, 'content_pack.owner_mismatch', {
                expected: this.ownerModuleName,
                actual: ref.owner,
            });
        }
    }

    private snapshotRecord(record: ContentPackRecord): ContentPackRecordSnapshot {
        return {
            id: record.ref.id,
            owner: record.ref.owner,
            name: record.ref.name,
            bundleName: record.ref.bundle,
            leaseCount: record.leases.size,
            dependencies: record.manifest.dependencies,
            contentHash: record.manifest.contentHash,
            manifest: record.manifest,
            assets: record.assets.snapshot(),
        };
    }

    private acquireCancelled(ref: ContentPackRef): YZForgeError {
        return new YZForgeError(`ContentPack acquire was cancelled because owner scope is closing: ${ref.id}`, 'content_pack.acquire_cancelled', {
            contentPack: ref.id,
            ownerId: this.ownerScope.ownerId,
            ownerPath: this.ownerScope.ownerPath,
        });
    }
}

function readContentPackManifest(ref: ContentPackRef, asset: JsonAsset): ContentPackManifest {
    const manifest = asset.json as Partial<ContentPackManifest> | undefined;
    if (!manifest || typeof manifest !== 'object') {
        throw new YZForgeError(`ContentPack manifest is invalid: ${ref.id}`, 'content_pack.manifest_invalid', { id: ref.id });
    }
    const mismatches: string[] = [];
    if (manifest.schemaVersion !== 1) mismatches.push('schemaVersion');
    if (manifest.id !== ref.id) mismatches.push('id');
    if (manifest.owner !== ref.owner) mismatches.push('owner');
    if (manifest.name !== ref.name) mismatches.push('name');
    if (manifest.bundle !== ref.bundle) mismatches.push('bundle');
    if (!sameNames(manifest.dependencies, ref.libraries.map((library) => library.name))) mismatches.push('dependencies');
    if (!manifest.refs || typeof manifest.refs !== 'object') mismatches.push('refs');
    if (typeof manifest.contentHash !== 'string' || !manifest.contentHash) mismatches.push('contentHash');
    if (mismatches.length > 0) {
        throw new YZForgeError(`ContentPack manifest mismatch: ${ref.id} (${mismatches.join(', ')})`, 'content_pack.manifest_mismatch', {
            id: ref.id,
            mismatches,
        });
    }
    const expectedHash = contentHash(manifest.dependencies ?? [], manifest.refs ?? {});
    if (manifest.contentHash !== expectedHash) {
        throw new YZForgeError(`ContentPack manifest content hash mismatch: ${ref.id}`, 'content_pack.manifest_hash_mismatch', {
            id: ref.id,
            expected: expectedHash,
            actual: manifest.contentHash,
        });
    }
    return manifest as ContentPackManifest;
}

function materializeContentPackRefs(
    contractValue: unknown,
    manifest: ContentPackManifest,
): Record<string, ContentPackAssetRef | ContentPackConfigRef> {
    const contract = contractValue && typeof contractValue === 'object'
        ? contractValue as Record<string, ContentPackAssetContract | ContentPackConfigContract>
        : {};
    const contractKeys = Object.keys(contract).sort();
    const manifestKeys = Object.keys(manifest.refs).sort();
    if (!sameNames(contractKeys, manifestKeys)) {
        throw new YZForgeError('ContentPack manifest keys do not match the TypeScript contract.', 'content_pack.contract_mismatch', {
            contractKeys,
            manifestKeys,
        });
    }
    const result: Record<string, ContentPackAssetRef | ContentPackConfigRef> = {};
    for (const key of contractKeys) {
        const expected = contract[key];
        const actual = manifest.refs[key];
        result[key] = materializeContentPackRef(key, expected, actual);
    }
    return result;
}

function materializeContentPackRef(
    key: string,
    expected: ContentPackAssetContract | ContentPackConfigContract,
    actual: ContentPackManifestRef,
): ContentPackAssetRef | ContentPackConfigRef {
    if (expected.kind === 'content-pack-asset-contract') {
        if (actual.kind !== 'asset' || !actual.path || actual.type !== expected.type.name) {
            throw new YZForgeError(`ContentPack asset contract mismatch: ${key}`, 'content_pack.contract_mismatch', {
                key,
                expectedType: expected.type.name,
                actual,
            });
        }
        return { kind: 'content-pack-asset', type: expected.type, path: actual.path };
    }
    if (actual.kind !== 'config' || !actual.table || actual.primaryKey !== expected.primaryKey || !actual.codec) {
        throw new YZForgeError(`ContentPack config contract mismatch: ${key}`, 'content_pack.contract_mismatch', {
            key,
            expectedPrimaryKey: expected.primaryKey,
            actual,
        });
    }
    return {
        kind: 'content-pack-config',
        table: actual.table,
        primaryKey: actual.primaryKey,
        codec: actual.codec,
    };
}

export function explainContentPack(ref: ContentPackRef): ContentPackLoadPlan {
    const contract = ref.contract && typeof ref.contract === 'object' ? ref.contract as Record<string, unknown> : {};
    return {
        id: ref.id,
        owner: ref.owner,
        name: ref.name,
        bundleName: ref.bundle,
        dependencies: ref.libraries.map((library) => library.name),
        contractKeys: Object.keys(contract).sort(),
    };
}

function sameNames(left: readonly string[] | undefined, right: readonly string[]): boolean {
    return [...(left ?? [])].sort().join('|') === [...right].sort().join('|');
}

function contentHash(dependencies: readonly string[], refs: Readonly<Record<string, ContentPackManifestRef>>): string {
    const normalizedRefs: Record<string, ContentPackManifestRef> = {};
    for (const key of Object.keys(refs).sort()) {
        normalizedRefs[key] = refs[key];
    }
    const value = JSON.stringify({ dependencies: [...dependencies].sort(), refs: normalizedRefs });
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `00000000${(hash >>> 0).toString(16)}`.slice(-8);
}
