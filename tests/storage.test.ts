import test from 'node:test';
import assert from 'node:assert/strict';
import { Storage, type StorageBackend, type StorageKey } from '../assets/framework/platform/storage';
class MemoryStorage implements StorageBackend {
    readonly values = new Map<string, string>();
    failWrite = '';
    getItem(key: string) {
        return this.values.get(key) ?? null;
    }
    setItem(key: string, value: string) {
        if (key === this.failWrite) throw Error('quota');
        this.values.set(key, value);
    }
    removeItem(key: string) {
        this.values.delete(key);
    }
}
const key: StorageKey<{ coins: number }> = {
    id: 'wallet',
    version: 2,
    migrations: { 1: (value) => ({ coins: (value as { gold: number }).gold }) },
    validate: (value): value is { coins: number } =>
        !!value && typeof value === 'object' && Number.isSafeInteger((value as { coins: number }).coins),
};
test('optional namespaces isolate users, backups and separator-containing IDs', () => {
    const backend = new MemoryStorage(),
        storage = new Storage('game:', backend);
    const first = storage.in('user/A'),
        second = storage.in('user').in('A');
    first.set(key, { coins: 1 });
    first.set(key, { coins: 2 });
    second.set(key, { coins: 9 });
    assert.equal(storage.in('user/A').get(key)?.coins, 2);
    assert.equal(second.get(key)?.coins, 9);
    assert.equal(storage.get(key), undefined);
    first.remove(key);
    assert.equal(second.get(key)?.coins, 9);
    assert.throws(() => storage.in(''), { code: 'STORAGE_NAMESPACE_INVALID' });
    assert.throws(() => storage.set({ ...key, id: '@namespace/user' }, { coins: 0 }));
});
test('save migration does not overwrite source until explicitly saved', () => {
    const backend = new MemoryStorage(),
        storage = new Storage('game:', backend);
    backend.setItem('game:wallet', JSON.stringify({ version: 1, value: { gold: 12 } }));
    assert.deepEqual(storage.read(key), { status: 'migrated', value: { coins: 12 } });
    assert.equal(JSON.parse(backend.getItem('game:wallet')!).version, 1);
    storage.set(key, { coins: 13 });
    assert.deepEqual(storage.get(key), { coins: 13 });
    assert.equal(JSON.parse(backend.getItem('game:@backup/wallet')!).version, 1);
});
test('corrupt main save recovers a valid backup without destroying either copy', () => {
    const backend = new MemoryStorage(),
        storage = new Storage('game:', backend);
    storage.set(key, { coins: 1 });
    storage.set(key, { coins: 2 });
    backend.setItem('game:wallet', 'damaged');
    assert.deepEqual(storage.read(key), { status: 'recovered', value: { coins: 1 } });
    storage.set(key, { coins: 3 });
    assert.equal(JSON.parse(backend.getItem('game:@backup/wallet')!).value.coins, 1);
    storage.remove(key);
    assert.equal(storage.read(key).status, 'missing');
});
test('future saves are never replaced by an older app or an older backup', () => {
    const backend = new MemoryStorage(),
        storage = new Storage('game:', backend);
    storage.set(key, { coins: 1 });
    storage.set(key, { coins: 2 });
    const future = JSON.stringify({ version: 3, value: { coins: 99 } });
    backend.setItem('game:wallet', future);
    assert.equal(storage.read(key).status, 'incompatible');
    assert.throws(() => storage.set(key, { coins: 0 }), { code: 'STORAGE_INCOMPATIBLE' });
    assert.equal(backend.getItem('game:wallet'), future);
});
test('failed primary write preserves the previous valid save and missing migrations remain recoverable', () => {
    const backend = new MemoryStorage(),
        storage = new Storage('game:', backend);
    storage.set(key, { coins: 9 });
    backend.failWrite = 'game:wallet';
    assert.throws(() => storage.set(key, { coins: 10 }), { code: 'STORAGE_WRITE_FAILED' });
    assert.equal(storage.get(key)!.coins, 9);
    const unhandled = { ...key, version: 4 };
    assert.equal(storage.read(unhandled).status, 'invalid');
    assert.equal(storage.get(key)!.coins, 9);
});
test('a future backup is preserved even if the primary save is missing or damaged', () => {
    for (const primary of [null, 'damaged', JSON.stringify({ version: 2, value: { coins: 1 } })]) {
        const backend = new MemoryStorage(),
            storage = new Storage('game:', backend);
        const future = JSON.stringify({ version: 3, value: { coins: 99 } });
        backend.setItem('game:@backup/wallet', future);
        if (primary !== null) backend.setItem('game:wallet', primary);
        assert.throws(() => storage.set(key, { coins: 0 }), { code: 'STORAGE_INCOMPATIBLE' });
        assert.equal(backend.getItem('game:@backup/wallet'), future);
        assert.equal(backend.getItem('game:wallet'), primary);
    }
});
