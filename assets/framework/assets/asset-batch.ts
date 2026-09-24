import type { AssetKey, AssetTypes } from './asset-types';
import { untilCancelled } from '../core/cancellation';
import { FrameworkError, invariant } from '../core/errors';
import type { Lifetime } from '../core/scope';

/** 按请求条目计数的加载进度；不代表下载字节、实例化或 GPU 上传进度。 */
export interface AssetBatchProgress {
    readonly completed: number;
    readonly total: number;
    readonly name?: string;
}
/** 一批资源的准备策略；共享资源仍由现有资源缓存合并加载。 */
export interface AssetBatchOptions {
    /** 同时等待的条目数，默认 4；不覆盖引擎下载器的全局并发设置。 */
    readonly concurrency?: number;
    /** 开始时通知 0，之后每个条目成功通知一次；回调须同步，抛错会取消本批。 */
    readonly onProgress?: (progress: AssetBatchProgress) => void;
}
export type LoadedAssets<T extends Record<string, AssetKey>> = {
    readonly [P in keyof T]: AssetTypes[T[P]['type']];
};

/** @internal Assets 的批量编排；成功保留本批子 Scope，失败只归还本批持有。 */
export async function loadAssetBatch<T extends Record<string, AssetKey>>(
    keys: T,
    owner: Lifetime,
    load: <K extends AssetKey['type']>(key: AssetKey<K>, scope: Lifetime) => Promise<AssetTypes[K]>,
    options: AssetBatchOptions = {},
): Promise<LoadedAssets<T>> {
    const concurrency = options.concurrency ?? 4;
    invariant(Number.isSafeInteger(concurrency) && concurrency > 0, 'ASSET_BATCH_LIMIT', '并发数必须为正整数');
    const entries = Object.entries(keys);
    const scope = owner.child('asset-batch');
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let next = 0,
        completed = 0;
    const progress = (name?: string) => {
        scope.signal.throwIfAborted();
        const returned: unknown = options.onProgress?.(Object.freeze({ completed, total: entries.length, name }));
        if (returned && typeof (returned as Promise<unknown>).then === 'function') {
            void Promise.resolve(returned).catch(() => {});
            throw new FrameworkError('ASSET_BATCH_PROGRESS_ASYNC', '进度回调必须同步');
        }
        scope.signal.throwIfAborted();
    };
    try {
        progress();
        const workers = Array.from({ length: Math.min(concurrency, entries.length) }, async () => {
            while (next < entries.length) {
                scope.signal.throwIfAborted();
                const [name, key] = entries[next++];
                const pending = Promise.resolve().then(() => {
                    scope.signal.throwIfAborted();
                    return load(key, scope.lifetime);
                });
                result[name] = await untilCancelled(pending, scope.signal);
                completed++;
                progress(name);
            }
        });
        await Promise.all(workers);
        scope.signal.throwIfAborted();
        if (!entries.length) await scope.close();
        return Object.freeze(result) as LoadedAssets<T>;
    } catch (error) {
        scope.cancel();
        try {
            await scope.close();
        } catch (cleanup) {
            throw new FrameworkError('ASSET_BATCH_CLEANUP_FAILED', '批量加载失败且回收异常', { error, cleanup });
        }
        throw error;
    }
}
