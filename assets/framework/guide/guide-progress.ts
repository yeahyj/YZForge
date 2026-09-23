import type { Storage, StorageKey } from '../platform/storage';
import { invariant } from '../core/errors';
import type { GuideCheckpoint, GuideProgressStore } from './guide-runner';

/** 将引导检查点保存在既有 Storage 中；可传 storage.in(accountId) 实现账号隔离。 */
export class StorageGuideProgress implements GuideProgressStore {
    /** storage 决定应用/账号命名空间，prefix 默认 guide。 */
    constructor(
        private readonly storage: Storage,
        private readonly prefix = 'guide',
    ) {}
    private key(id: string): StorageKey<GuideCheckpoint> {
        return {
            id: `${this.prefix}/${id}`,
            version: 1,
            validate: (value): value is GuideCheckpoint => {
                if (!value || typeof value !== 'object') return false;
                const candidate = value as GuideCheckpoint;
                return (
                    Number.isSafeInteger(candidate.version) &&
                    candidate.version > 0 &&
                    ['running', 'completed', 'skipped'].includes(candidate.status) &&
                    (candidate.status !== 'running' ||
                        (typeof candidate.nextStep === 'string' && candidate.nextStep.length > 0))
                );
            },
        };
    }
    /** 读取当前记录；损坏或不兼容存档明确报错，由业务决定恢复方式。 */
    read(id: string): GuideCheckpoint | undefined {
        const result = this.storage.read(this.key(id));
        invariant(
            result.status !== 'invalid' && result.status !== 'incompatible',
            'GUIDE_PROGRESS_INVALID',
            '引导进度存档需要恢复',
        );
        return result.value;
    }
    /** 同步持久化；存储错误保留原始错误码，不推进流程。 */
    write(id: string, checkpoint: GuideCheckpoint): void {
        this.storage.set(this.key(id), checkpoint);
    }
    /** 显式清除一个引导的本地记录；正在运行时应先取消并等待 result。 */
    reset(id: string): void {
        this.storage.remove(this.key(id));
    }
}
