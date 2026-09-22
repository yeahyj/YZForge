import { FrameworkError, invariant } from '../core/errors';

/** 同步存储适配器；App 默认使用 Cocos sys.localStorage，测试或平台可以注入其他实现。 */
export interface StorageBackend {
    /** 读取原始字符串，不存在返回 null。 */
    getItem(key: string): string | null;
    /** 保存原始字符串，失败须抛出错误。 */
    setItem(key: string, value: string): void;
    /** 删除一个键，失败须抛出错误。 */
    removeItem(key: string): void;
}
/** 存档的数据合同；所有值必须可以安全序列化为 JSON。 */
export interface StorageKey<T> {
    /** 应用内稳定名称，建议带模块前缀；@backup/ 为框架保留前缀。 */
    readonly id: string;
    /** 当前数据版本，正整数；未来版本拒绝降级读取或覆盖。 */
    readonly version: number;
    /** 从版本 n 到 n+1 的纯迁移函数，按顺序执行；不要在其中写盘或联网。 */
    readonly migrations?: Readonly<Record<number, (value: unknown) => unknown>>;
    /** 读写及迁移结果的运行时类型检查。 */
    readonly validate: (value: unknown) => value is T;
}
/** 读取结果；迁移或备份恢复不会自动写盘，业务确认后通过 set 保存。 */
export type StorageReadResult<T> =
    | { readonly status: 'loaded' | 'migrated' | 'recovered'; readonly value: T }
    | { readonly status: 'missing' | 'invalid' | 'incompatible'; readonly value?: undefined };

/**
 * 小型 JSON 存档和设置存储，保留上一份有效备份，支持逐版本迁移。
 * 不提供加密、服务器校验或异步大文件存储；关键进度应及时保存，不依赖进程退出钩子。
 */
export class Storage {
    /**
     * 创建独立命名空间的存储入口；普通业务使用 ctx.storage 或 app.storage。
     * @param prefix 稳定应用前缀，App 使用 appId 加冒号。
     * @param backend 平台同步键值存储，由 App 注入，便于独立测试。
     */
    constructor(
        private readonly prefix: string,
        private readonly backend: StorageBackend,
    ) {}
    /**
     * 创建子命名空间，不创建账号或复制数据。例如 storage.in('player').in(playerId)。
     * 原入口及其他玩家的数据不变；项目自己决定会话、玩家或存档槽的归属。
     */
    in(namespace: string): Storage {
        invariant(
            typeof namespace === 'string' && namespace.length > 0 && namespace.length <= 256,
            'STORAGE_NAMESPACE_INVALID',
            'Provide a non-empty namespace of at most 256 characters',
        );
        return new Storage(`${this.prefix}@namespace/${encodeURIComponent(namespace)}/`, this.backend);
    }
    private paths<T>(key: StorageKey<T>) {
        invariant(
            key.id.length > 0 && !key.id.startsWith('@') && Number.isSafeInteger(key.version) && key.version > 0,
            'STORAGE_INVALID',
            'Invalid storage key or version',
        );
        return { primary: this.prefix + key.id, backup: this.prefix + '@backup/' + encodeURIComponent(key.id) };
    }
    private decode<T>(key: StorageKey<T>, raw: string): { value: T; migrated: boolean } {
        const data = JSON.parse(raw) as { version: number; value: unknown };
        invariant(
            Number.isSafeInteger(data?.version) && data.version > 0,
            'STORAGE_INVALID',
            `Invalid saved version: ${key.id}`,
        );
        invariant(data.version <= key.version, 'STORAGE_INCOMPATIBLE', `Save ${key.id} requires a newer application`);
        const migrated = data.version !== key.version;
        for (let version = data.version; version < key.version; version++) {
            const migrate = key.migrations?.[version];
            invariant(migrate, 'STORAGE_INVALID', `Missing migration ${key.id}: ${version} -> ${version + 1}`);
            data.value = migrate(data.value);
        }
        invariant(key.validate(data.value), 'STORAGE_INVALID', `Invalid saved data: ${key.id}`);
        return { value: data.value, migrated };
    }
    /**
     * 读取并迁移主数据；主数据不存在返回 undefined，错误抛出，不自动使用备份。
     * @param key 版本、迁移步骤与类型合同。
     * @returns 验证通过的数据；迁移只在内存中进行。
     * @throws STORAGE_INVALID 数据无效；STORAGE_INCOMPATIBLE 数据来自更新版本；底层读取错误原样传播。
     */
    get<T>(key: StorageKey<T>): T | undefined {
        const raw = this.backend.getItem(this.paths(key).primary);
        if (raw === null) return undefined;
        try {
            return this.decode(key, raw).value;
        } catch (error) {
            if (error instanceof FrameworkError) throw error;
            throw new FrameworkError('STORAGE_INVALID', `Invalid saved data: ${key.id}`, { error });
        }
    }
    /**
     * 可恢复读取：主数据无效时尝试上一份有效备份，未来版本返回 incompatible。
     * @returns loaded 正常，migrated 已在内存迁移，recovered 使用备份；missing/invalid/incompatible 无可用值。
     * @remarks 不自动覆盖原文件或自动创建默认值，底层存储无法读取时仍抛出错误。
     */
    read<T>(key: StorageKey<T>): StorageReadResult<T> {
        const paths = this.paths(key),
            raw = this.backend.getItem(paths.primary);
        if (raw !== null) {
            try {
                const result = this.decode(key, raw);
                return Object.freeze({ status: result.migrated ? 'migrated' : 'loaded', value: result.value });
            } catch (error) {
                if (error instanceof FrameworkError && error.code === 'STORAGE_INCOMPATIBLE')
                    return Object.freeze({ status: 'incompatible' });
            }
        }
        const backup = this.backend.getItem(paths.backup);
        if (backup !== null) {
            try {
                return Object.freeze({ status: 'recovered', value: this.decode(key, backup).value });
            } catch (error) {
                if (error instanceof FrameworkError && error.code === 'STORAGE_INCOMPATIBLE')
                    return Object.freeze({ status: 'incompatible' });
            }
        }
        return Object.freeze({ status: raw === null && backup === null ? 'missing' : 'invalid' });
    }
    /**
     * 保存 JSON；先备份上一份有效值，再写主数据。无效主数据不会覆盖现有备份。
     * @param key 当前存档合同。
     * @param value 通过 validate 的可序列化数据。
     * @throws STORAGE_WRITE_FAILED 序列化、配额或写入失败；STORAGE_INCOMPATIBLE 阻止覆盖未来版本存档。
     */
    set<T>(key: StorageKey<T>, value: T): void {
        const paths = this.paths(key);
        invariant(key.validate(value), 'STORAGE_INVALID', `Invalid value: ${key.id}`);
        try {
            const serialized = JSON.stringify({ version: key.version, value });
            this.decode(key, serialized); // JSON 往返也须满足合同，防止 NaN、undefined、toJSON 等破坏数据。
            const savedBackup = this.backend.getItem(paths.backup);
            if (savedBackup !== null) {
                try {
                    this.decode(key, savedBackup);
                } catch (error) {
                    if (error instanceof FrameworkError && error.code === 'STORAGE_INCOMPATIBLE') throw error;
                }
            }
            const previous = this.backend.getItem(paths.primary);
            let backup: string | undefined;
            if (previous !== null) {
                try {
                    this.decode(key, previous);
                    backup = previous;
                } catch (error) {
                    if (error instanceof FrameworkError && error.code === 'STORAGE_INCOMPATIBLE') throw error;
                }
            }
            if (backup !== undefined) this.backend.setItem(paths.backup, backup);
            this.backend.setItem(paths.primary, serialized);
        } catch (error) {
            if (error instanceof FrameworkError && error.code === 'STORAGE_INCOMPATIBLE') throw error;
            throw new FrameworkError('STORAGE_WRITE_FAILED', `Could not save: ${key.id}`, { error });
        }
    }
    /** 删除指定存档及其备份；不删除整个应用命名空间。 */
    remove<T>(key: StorageKey<T>): void {
        const paths = this.paths(key);
        this.backend.removeItem(paths.backup);
        this.backend.removeItem(paths.primary);
    }
}
