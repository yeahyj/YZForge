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
    type ContentPackPresentationRequest,
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
    readonly presentationRequests: readonly ContentPackPresentationRequest[];
}

/**
 * A behavior implemented by the owner Module and requested declaratively by a
 * ContentPack. Content packs never nominate a script or class to execute.
 */
export interface ContentPackPresentationCapability {
    readonly id: string;
    readonly version: number;
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
    readonly presentationRequests: readonly ContentPackPresentationRequest[];
    readonly presentationCapabilities: readonly ContentPackPresentationCapability[];
    readonly contentHash: string;
    readonly manifest: ContentPackManifest;
    /** Shared manifest/config resources held for the lifetime of the record. */
    readonly metadataAssets: AssetScopeSnapshot;
    /** Per-load runtime resources, nodes, and Parts. */
    readonly leases: readonly ContentPackLeaseSnapshot[];
}

export interface ContentPackLeaseSnapshot {
    readonly leaseId: string;
    readonly ownerId: string;
    readonly ownerPath: string;
    readonly assets: AssetScopeSnapshot;
}

interface ContentPackRecord {
    readonly ref: ContentPackRef;
    readonly bundle: BundleLease;
    readonly scope: ReleaseScope;
    readonly metadataAssets: ContentPackAssetScope;
    readonly refs: Record<string, ContentPackAssetRef | ContentPackConfigRef>;
    readonly manifest: ContentPackManifest;
    readonly config: ConfigScope<unknown>;
    readonly presentationCapabilities: readonly ContentPackPresentationCapability[];
    readonly leases: Map<string, ContentPackLeaseImpl>;
}

class ContentPackLeaseImpl implements ContentPackLease<Record<string, unknown>, unknown> {
    private leaseReleased = false;
    private detachOwnerRelease?: () => void;

    public constructor(
        private readonly manager: ContentPackManager,
        private readonly record: ContentPackRecord,
        private readonly leaseScope: ReleaseScope,
        private readonly assetsScope: ContentPackAssetScope,
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
        return this.assetsScope;
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

    public async releaseResources(reason: unknown): Promise<void> {
        await this.leaseScope.release(reason);
    }

    public snapshot(): ContentPackLeaseSnapshot {
        return {
            leaseId: this.leaseId,
            ownerId: this.owner.id,
            ownerPath: this.owner.path,
            assets: this.assetsScope.snapshot(),
        };
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
    private readonly presentationCapabilities = new Map<string, ContentPackPresentationCapability>();
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
        if (!this.ownerScope.active || lease.released) {
            await lease.release({ type: 'content_pack_acquire_cancelled' });
            throw this.acquireCancelled(ref);
        }
        this.leases.add(lease);
        return lease;
    }

    public explain<TContract, TConfig>(ref: ContentPackRef<TContract, TConfig>): ContentPackLoadPlan {
        this.assertOwner(ref);
        return explainContentPack(ref);
    }

    /**
     * Registers one owner-Module behavior that ContentPacks may request. The
     * registration is tied to the Module scope and deliberately has no public
     * manual disposer: a loaded pack must not lose a capability mid-lifetime.
     */
    public registerPresentationCapability(capability: ContentPackPresentationCapability): void {
        const normalized = normalizePresentationCapability(capability, this.ownerModuleName);
        if (!this.ownerScope.active) {
            throw new YZForgeError(
                `ContentPack presentation capability cannot be registered after owner scope starts closing: ${normalized.id}`,
                'content_pack.presentation_capability_scope_closed',
                { capability: normalized.id, owner: this.ownerModuleName },
            );
        }
        if (this.presentationCapabilities.has(normalized.id)) {
            throw new YZForgeError(
                `ContentPack presentation capability is already registered: ${normalized.id}`,
                'content_pack.presentation_capability_duplicate',
                { capability: normalized.id, owner: this.ownerModuleName },
            );
        }
        this.presentationCapabilities.set(normalized.id, normalized);
        try {
            this.ownerScope.defer(`content-pack-presentation:${normalized.id}`, () => {
                if (this.presentationCapabilities.get(normalized.id) === normalized) {
                    this.presentationCapabilities.delete(normalized.id);
                }
            });
        } catch (error) {
            this.presentationCapabilities.delete(normalized.id);
            throw error;
        }
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
        await runCleanupSteps(`contentPack.lease.release:${record.ref.id}/${lease.leaseId}`, [
            {
                step: 'release content pack ownership',
                task: () => this.kernel.ownership.release(lease.owner, 'content-pack', record.ref.id),
            },
            { step: 'release lease resources', task: () => lease.releaseResources(reason) },
            { step: 'release unused content pack record', task: () => this.releaseRecordIfUnused(record, reason) },
        ]);
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
            const metadataAssets = new ContentPackAssetScope(
                ref.id,
                bundle,
                this.kernel.logger.child(`content-pack:${ref.id}`),
                scope.child('assets', ref.id),
                this.kernel.ownership,
            );
            const manifestAsset = await metadataAssets.load(assetRef(JsonAsset, 'manifest.generated'));
            const manifest = readContentPackManifest(ref, manifestAsset);
            const refs = materializeContentPackRefs(ref.contract, manifest);
            const presentationCapabilities = this.resolvePresentationCapabilities(ref, manifest.presentationRequests);
            const config = await this.kernel.configs.loadContentPackScope<TConfig>(refs, metadataAssets);
            const record: ContentPackRecord = {
                ref,
                bundle,
                scope,
                metadataAssets,
                refs,
                manifest,
                config,
                presentationCapabilities,
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
        const transaction = new CompensationStack(`contentPack.lease.attach:${record.ref.id}/${leaseId}`);
        transaction.defer('release unused content pack record', (reason) => this.releaseRecordIfUnused(record, reason));
        try {
            const leaseScope = record.scope.child('content-pack-lease', leaseId);
            transaction.defer('release content pack lease scope', (reason) => leaseScope.release(reason));
            const assets = new ContentPackAssetScope(
                `${record.ref.id}/${leaseId}`,
                record.bundle,
                this.kernel.logger.child(`content-pack:${record.ref.id}/${leaseId}`),
                leaseScope.child('assets', leaseId),
                this.kernel.ownership,
            );
            const lease = new ContentPackLeaseImpl(this, record, leaseScope, assets, leaseId, identity);
            record.leases.set(leaseId, lease);
            transaction.defer('remove content pack lease record', () => {
                record.leases.delete(leaseId);
            });
            this.kernel.ownership.acquire(identity, 'content-pack', record.ref.id, {
                bundleName: record.ref.bundle,
                leaseId,
            });
            transaction.defer('release content pack ownership', () => {
                this.kernel.ownership.release(identity, 'content-pack', record.ref.id);
            });
            lease.attachOwnerRelease(this.ownerScope.defer(`content-pack-lease:${record.ref.id}:${leaseId}`, (reason) => lease.release(reason)));
            transaction.commit();
            return lease as unknown as ContentPackLease<TContract, TConfig>;
        } catch (error) {
            return await transaction.fail(error, { type: 'content_pack_lease_attach_failed', contentPack: record.ref.id, leaseId });
        }
    }

    private async releaseRecordIfUnused(record: ContentPackRecord, reason: unknown): Promise<void> {
        if (record.leases.size > 0 || this.records.get(record.ref.id) !== record) {
            return;
        }
        this.records.delete(record.ref.id);
        await record.scope.release(reason);
    }

    private resolvePresentationCapabilities(
        ref: ContentPackRef,
        requests: readonly ContentPackPresentationRequest[],
    ): readonly ContentPackPresentationCapability[] {
        return requests.map((request) => {
            const capability = this.presentationCapabilities.get(request.capability);
            if (!capability) {
                throw new YZForgeError(
                    `ContentPack requires an unregistered presentation capability: ${ref.id}/${request.key} -> ${request.capability}@${request.version}`,
                    'content_pack.presentation_capability_missing',
                    {
                        contentPack: ref.id,
                        requestKey: request.key,
                        capability: request.capability,
                        expectedVersion: request.version,
                        owner: this.ownerModuleName,
                    },
                );
            }
            if (capability.version !== request.version) {
                throw new YZForgeError(
                    `ContentPack presentation capability version mismatch: ${ref.id}/${request.key} requires ${request.capability}@${request.version}, owner registered @${capability.version}`,
                    'content_pack.presentation_capability_version_mismatch',
                    {
                        contentPack: ref.id,
                        requestKey: request.key,
                        capability: request.capability,
                        expectedVersion: request.version,
                        actualVersion: capability.version,
                        owner: this.ownerModuleName,
                    },
                );
            }
            return capability;
        });
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
        const metadataAssets = record.metadataAssets.snapshot();
        return {
            id: record.ref.id,
            owner: record.ref.owner,
            name: record.ref.name,
            bundleName: record.ref.bundle,
            leaseCount: record.leases.size,
            dependencies: record.manifest.dependencies,
            presentationRequests: record.manifest.presentationRequests,
            presentationCapabilities: record.presentationCapabilities,
            contentHash: record.manifest.contentHash,
            manifest: record.manifest,
            metadataAssets,
            leases: Array.from(record.leases.values()).map((lease) => lease.snapshot()),
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
    if (manifest.schemaVersion !== 2) mismatches.push('schemaVersion');
    if (manifest.id !== ref.id) mismatches.push('id');
    if (manifest.owner !== ref.owner) mismatches.push('owner');
    if (manifest.name !== ref.name) mismatches.push('name');
    if (manifest.bundle !== ref.bundle) mismatches.push('bundle');
    if (!sameNames(manifest.dependencies, ref.libraries.map((library) => library.name))) mismatches.push('dependencies');
    if (!Array.isArray(manifest.presentationRequests)) mismatches.push('presentationRequests');
    if (!manifest.refs || typeof manifest.refs !== 'object') mismatches.push('refs');
    if (typeof manifest.contentHash !== 'string' || !manifest.contentHash) mismatches.push('contentHash');
    if (mismatches.length > 0) {
        throw new YZForgeError(`ContentPack manifest mismatch: ${ref.id} (${mismatches.join(', ')})`, 'content_pack.manifest_mismatch', {
            id: ref.id,
            mismatches,
        });
    }
    const expectedRequests = normalizePresentationRequests(ref.presentationRequests, `ContentPack ref ${ref.id}`);
    const actualRequests = normalizePresentationRequests(manifest.presentationRequests, `ContentPack manifest ${ref.id}`);
    if (!samePresentationRequests(actualRequests, expectedRequests)) {
        throw new YZForgeError(`ContentPack manifest mismatch: ${ref.id} (presentationRequests)`, 'content_pack.manifest_mismatch', {
            id: ref.id,
            mismatches: ['presentationRequests'],
            expectedPresentationRequests: expectedRequests,
            actualPresentationRequests: actualRequests,
        });
    }
    assertPresentationRequestPrefabs(ref.id, actualRequests, manifest.refs ?? {});
    const expectedHash = contentHash(manifest.dependencies ?? [], manifest.refs ?? {}, actualRequests);
    if (manifest.contentHash !== expectedHash) {
        throw new YZForgeError(`ContentPack manifest content hash mismatch: ${ref.id}`, 'content_pack.manifest_hash_mismatch', {
            id: ref.id,
            expected: expectedHash,
            actual: manifest.contentHash,
        });
    }
    return {
        ...manifest,
        dependencies: [...(manifest.dependencies ?? [])],
        presentationRequests: actualRequests,
        refs: manifest.refs ?? {},
    } as ContentPackManifest;
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
        presentationRequests: normalizePresentationRequests(ref.presentationRequests, `ContentPack ref ${ref.id}`),
    };
}

function sameNames(left: readonly string[] | undefined, right: readonly string[]): boolean {
    return [...(left ?? [])].sort().join('|') === [...right].sort().join('|');
}

function contentHash(
    dependencies: readonly string[],
    refs: Readonly<Record<string, ContentPackManifestRef>>,
    presentationRequests: readonly ContentPackPresentationRequest[],
): string {
    const normalizedRefs: Record<string, ContentPackManifestRef> = {};
    for (const key of Object.keys(refs).sort()) {
        normalizedRefs[key] = refs[key];
    }
    const normalizedRequests = [...presentationRequests]
        .map((request) => ({
            key: request.key,
            capability: request.capability,
            version: request.version,
            prefab: request.prefab,
        }))
        .sort(comparePresentationRequestKeys);
    const value = JSON.stringify({
        dependencies: [...dependencies].sort(),
        presentationRequests: normalizedRequests,
        refs: normalizedRefs,
    });
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return `00000000${(hash >>> 0).toString(16)}`.slice(-8);
}

function normalizePresentationCapability(
    capability: ContentPackPresentationCapability,
    owner: string,
): ContentPackPresentationCapability {
    if (!capability || typeof capability !== 'object'
        || !isPresentationCapabilityId(capability.id)
        || !isPositiveVersion(capability.version)) {
        throw new YZForgeError(
            `ContentPack presentation capability is invalid for owner ${owner}.`,
            'content_pack.presentation_capability_invalid',
            { owner, capability },
        );
    }
    return { id: capability.id, version: capability.version };
}

function normalizePresentationRequests(value: unknown, source: string): ContentPackPresentationRequest[] {
    if (!Array.isArray(value)) {
        throw new YZForgeError(`ContentPack presentation requests must be an array: ${source}`, 'content_pack.presentation_request_invalid', {
            source,
            value,
        });
    }
    const keys = new Set<string>();
    const requests = value.map((candidate, index) => {
        const request = candidate as Partial<ContentPackPresentationRequest> | undefined;
        if (!request || typeof request !== 'object'
            || !isPresentationRequestKey(request.key)
            || !isPresentationCapabilityId(request.capability)
            || !isPositiveVersion(request.version)
            || !isPresentationRequestKey(request.prefab)) {
            throw new YZForgeError(`ContentPack presentation request is invalid: ${source}[${index}]`, 'content_pack.presentation_request_invalid', {
                source,
                index,
                request: candidate,
            });
        }
        if (keys.has(request.key)) {
            throw new YZForgeError(`ContentPack presentation request key is duplicated: ${source}/${request.key}`, 'content_pack.presentation_request_duplicate', {
                source,
                key: request.key,
            });
        }
        keys.add(request.key);
        return {
            key: request.key,
            capability: request.capability,
            version: request.version,
            prefab: request.prefab,
        };
    });
    return requests.sort(comparePresentationRequestKeys);
}

function assertPresentationRequestPrefabs(
    contentPack: string,
    requests: readonly ContentPackPresentationRequest[],
    refs: Readonly<Record<string, ContentPackManifestRef>>,
): void {
    for (const request of requests) {
        const prefab = refs[request.prefab];
        if (prefab?.kind === 'asset' && prefab.type === 'Prefab' && typeof prefab.path === 'string' && prefab.path) {
            continue;
        }
        throw new YZForgeError(
            `ContentPack presentation request must reference a generated Prefab ref: ${contentPack}/${request.key} -> ${request.prefab}`,
            'content_pack.presentation_request_prefab_invalid',
            { contentPack, request, actual: prefab },
        );
    }
}

function samePresentationRequests(
    left: readonly ContentPackPresentationRequest[],
    right: readonly ContentPackPresentationRequest[],
): boolean {
    return left.length === right.length && left.every((request, index) => {
        const expected = right[index];
        return request.key === expected.key
            && request.capability === expected.capability
            && request.version === expected.version
            && request.prefab === expected.prefab;
    });
}

function isPresentationRequestKey(value: unknown): value is string {
    return typeof value === 'string' && /^[A-Za-z][A-Za-z0-9]*$/.test(value);
}

function isPresentationCapabilityId(value: unknown): value is string {
    return typeof value === 'string' && /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/.test(value);
}

function isPositiveVersion(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

/**
 * Content hashes must be identical on the authoring machine and every target
 * device, so their order cannot depend on the device's default locale.
 */
function comparePresentationRequestKeys(
    left: ContentPackPresentationRequest,
    right: ContentPackPresentationRequest,
): number {
    if (left.key < right.key) {
        return -1;
    }
    if (left.key > right.key) {
        return 1;
    }
    return 0;
}
