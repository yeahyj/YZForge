import { Storage, type StorageBackend, type StorageKey } from '../../../../../framework/platform/storage';

/** 故障实验专用内存后端；不会修改浏览器、小游戏或原生平台的真实存档。 */
export class LabStorageBackend implements StorageBackend {
    readonly values = new Map<string, string>();
    failKey = '';
    getItem(key: string): string | null {
        return this.values.get(key) ?? null;
    }
    setItem(key: string, value: string): void {
        if (key === this.failKey) throw Error('模拟配额不足');
        this.values.set(key, value);
    }
    removeItem(key: string): void {
        this.values.delete(key);
    }
}

/** v1 gold 字段升级成 v2 coins；这是存档版本升级示例，不是框架迁移要求。 */
export const LabWallet: StorageKey<{ coins: number }> = {
    id: 'wallet',
    version: 2,
    migrations: { 1: (value) => ({ coins: (value as { gold: number }).gold }) },
    validate: (value): value is { coins: number } =>
        !!value &&
        typeof value === 'object' &&
        Number.isSafeInteger((value as { coins: number }).coins) &&
        (value as { coins: number }).coins >= 0,
};

/** 每次页面展示建立独立实验环境，所有破坏操作限定在这份内存 Map 中。 */
export class StorageLab {
    readonly backend = new LabStorageBackend();
    readonly storage = new Storage('showcase:', this.backend);

    /** 损坏主记录，观察框架读取上一次有效备份。 */
    corrupt(): string {
        this.reset();
        this.storage.set(LabWallet, { coins: 10 });
        this.storage.set(LabWallet, { coins: 20 });
        this.backend.setItem('showcase:wallet', '故意损坏的 JSON');
        const result = this.storage.read(LabWallet);
        return `读取状态 ${result.status} · 恢复余额 ${result.value?.coins}\n主记录仍保留，读取不会偷偷覆盖原始存档。`;
    }
    /** 主写入失败时，内存中的旧存档和备份仍可读取。 */
    failWrite(): string {
        this.reset();
        this.storage.set(LabWallet, { coins: 10 });
        this.backend.failKey = 'showcase:wallet';
        try {
            this.storage.set(LabWallet, { coins: 99 });
        } catch (error) {
            return `${String(error)}\n失败后余额仍为 ${this.storage.get(LabWallet)?.coins}`;
        } finally {
            this.backend.failKey = '';
        }
        throw Error('实验异常：故障未生效');
    }
    /** 读取旧版本只生成升级结果，显式 set 才保存新版本。 */
    upgrade(): string {
        this.reset();
        this.backend.setItem('showcase:wallet', JSON.stringify({ version: 1, value: { gold: 30 } }));
        const result = this.storage.read(LabWallet);
        return `读取状态 ${result.status} · coins ${result.value?.coins}\n原始记录仍为 v1；需要明确保存才能升级落盘。`;
    }
    /** 高版本记录不能被旧应用覆盖，即使旧应用提供了默认值。 */
    future(): string {
        this.reset();
        this.backend.setItem('showcase:wallet', JSON.stringify({ version: 99, value: { coins: 500 } }));
        const result = this.storage.read(LabWallet);
        try {
            this.storage.set(LabWallet, { coins: 0 });
        } catch (error) {
            return `读取状态 ${result.status}\n覆盖被拒绝：${String(error)}`;
        }
        throw Error('实验异常：高版本记录被覆盖');
    }
    /** 只清空此实验的内存后端。 */
    reset(): void {
        this.backend.failKey = '';
        this.backend.values.clear();
    }
}
