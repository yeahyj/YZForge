import { sys } from 'cc';
import { FrameworkError } from '../core/errors';
/**
 * 本地存储的版本与类型合同，用于小型玩家设置等数据。
 * @typeParam T - 值类型，须能安全 JSON 序列化并通过 validate 校验。
 */
export interface StorageKey<T> {
    /**
     * 应用内稳定键名，建议带模块前缀；Storage 会自动添加 appId 前缀。
     */
    readonly id: string;
    /**
     * 数据结构版本，读取时必须完全相等；升级不会自动迁移旧值。
     */
    readonly version: number;
    /**
     * 运行时类型守卫，读取和写入都会调用；不要只做 TypeScript 强制类型转换。
     */
    readonly validate: (value: unknown) => value is T;
}
/**
 * 基于 Cocos sys.localStorage 的小型本地持久化，保存 { version, value } 并检查合同。
 * 数据可被设备用户修改，适合偏好设置；不提供存档迁移、加密或服务器校验。
 */
export class Storage {
    /**
     * 创建带命名空间的存储入口，App 默认传入 appId 加冒号。
     * @param prefix - 实际键名前缀，使用稳定值避免读不到既有数据。
     */
    constructor(private readonly prefix: string) {}
    /**
     * 读取并校验一个保存值。
     * @param key - 稳定 ID、版本和类型守卫。
     * @returns 值不存在时为 undefined，否则返回符合合同的值；不会自动提供默认值。
     * @throws FrameworkError JSON、版本或类型校验失败时抛 STORAGE_INVALID；底层读取错误原样传播。
     */
    get<T>(key: StorageKey<T>): T | undefined {
        const raw = sys.localStorage.getItem(this.prefix + key.id);
        if (raw === null) return undefined;
        try {
            const data = JSON.parse(raw) as { version: number; value: unknown };
            if (data.version !== key.version || !key.validate(data.value)) throw Error('Incompatible saved value');
            return data.value;
        } catch (error) {
            throw new FrameworkError('STORAGE_INVALID', `Invalid saved data: ${key.id}`, { error });
        }
    }
    /**
     * 校验后同步保存 JSON 数据，不自动迁移旧版本。
     * @param key - 存储合同。
     * @param value - 符合合同且可 JSON 序列化的值。
     * @throws FrameworkError 值无效时为 STORAGE_INVALID，序列化或写入失败时为 STORAGE_WRITE_FAILED。
     */
    set<T>(key: StorageKey<T>, value: T): void {
        if (!key.validate(value)) throw new FrameworkError('STORAGE_INVALID', `Invalid value: ${key.id}`);
        try {
            sys.localStorage.setItem(this.prefix + key.id, JSON.stringify({ version: key.version, value }));
        } catch (error) {
            throw new FrameworkError('STORAGE_WRITE_FAILED', `Could not save: ${key.id}`, { error });
        }
    }
    /**
     * 删除当前应用前缀下的一个键，不影响其他键。
     * @param key - 待删除键的合同；删除时仅使用 id，不检查 version。
     */
    remove<T>(key: StorageKey<T>): void {
        sys.localStorage.removeItem(this.prefix + key.id);
    }
}
