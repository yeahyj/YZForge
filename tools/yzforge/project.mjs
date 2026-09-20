import { readFile, writeFile, mkdir, rename, readdir, realpath, unlink, open } from 'node:fs/promises';
import { resolve, relative, dirname, isAbsolute, sep } from 'node:path';
import { createHash } from 'node:crypto';
export const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
export const digest = (value) =>
    `sha256:${createHash('sha256')
        .update(typeof value === 'string' ? value : JSON.stringify(value))
        .digest('hex')}`;
export function within(root, path) {
    const absolute = resolve(root, path);
    const local = relative(resolve(root), absolute);
    if (isAbsolute(local) || local === '..' || local.startsWith(`..${sep}`))
        throw Error(`Path escapes project: ${path}`);
    return absolute;
}
export async function safePath(root, path) {
    const target = within(root, path);
    let ancestor = target;
    while (true) {
        try {
            const resolved = await realpath(ancestor);
            within(await realpath(root), resolved);
            return target;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            const parent = dirname(ancestor);
            if (parent === ancestor) throw error;
            ancestor = parent;
        }
    }
}
export async function files(root, extension) {
    let entries;
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }
    const result = [];
    for (const entry of entries) {
        if (entry.isSymbolicLink())
            throw Error(`Symlinks are not supported in generated project sources: ${entry.name}`);
        const path = resolve(root, entry.name);
        if (entry.isDirectory()) result.push(...(await files(path, extension)));
        else if (!extension || path.endsWith(extension)) result.push(path);
    }
    return result;
}
export async function modules(root) {
    const manifests = (await files(resolve(root, 'assets/game/modules'), '/module.json')).concat(
        await files(resolve(root, 'assets/game/modules'), '\\module.json'),
    );
    const unique = [...new Set(manifests)];
    return Promise.all(
        unique.map(async (path) => ({ ...(await json(path)), directory: dirname(path), manifestPath: path })),
    );
}
export function identifier(value) {
    const result = value.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase());
    if (
        !/^[a-zA-Z_$][\w$]*$/.test(result) ||
        ['class', 'delete', 'import', 'new', 'function', '__proto__', 'constructor', 'prototype'].includes(result)
    )
        throw Error(`Cannot generate TypeScript identifier: ${value}`);
    return result;
}
export const pascal = (value) => {
    const name = identifier(value);
    return name[0].toUpperCase() + name.slice(1);
};
/** Stages the whole batch before commit; backups permit exact rollback/recovery. Never writes engine serialization. */
export async function writeBatch(root, output, label = 'generate') {
    const transaction = `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    const base = await safePath(root, `.yzforge/changes/${transaction}`);
    const entries = [];
    for (const [path, content] of Object.entries(output)) {
        if (/\.(scene|prefab|meta)$/i.test(path))
            throw Error('Serialized Cocos assets must be written through the editor');
        const target = await safePath(root, path);
        let previous = null;
        try {
            previous = await readFile(target, 'utf8');
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
        }
        if (previous === content) continue;
        entries.push({ path: relative(root, target).replaceAll('\\', '/'), previous, content });
    }
    await mkdir(base, { recursive: true });
    await writeFile(resolve(base, 'transaction.json'), JSON.stringify({ label, status: 'prepared', entries }, null, 2));
    for (let index = 0; index < entries.length; index++)
        await writeFile(resolve(base, `${index}.staged`), entries[index].content);
    const applied = [];
    try {
        for (let index = 0; index < entries.length; index++) {
            const item = entries[index],
                target = await safePath(root, item.path);
            await mkdir(dirname(target), { recursive: true });
            await rename(resolve(base, `${index}.staged`), target);
            applied.push(item);
        }
    } catch (error) {
        for (const item of applied.reverse()) {
            const target = await safePath(root, item.path);
            if (item.previous !== null) await writeFile(target, item.previous);
            else await unlink(target);
        }
        await writeFile(
            resolve(base, 'failed.json'),
            JSON.stringify({ message: error.message, applied: applied.map((item) => item.path) }, null, 2),
        );
        throw error;
    }
    await writeFile(
        resolve(base, 'complete.json'),
        JSON.stringify({ label, paths: entries.map((item) => item.path) }, null, 2),
    );
    return { transaction, paths: entries.map((item) => item.path) };
}
export async function withProjectLock(root, action) {
    const directory = await safePath(root, '.yzforge');
    await mkdir(directory, { recursive: true });
    const target = resolve(directory, 'generation.lock');
    let lock;
    try {
        lock = await open(target, 'wx');
    } catch (error) {
        if (error.code === 'EEXIST')
            throw Error(
                'Generation is already running or was interrupted. Inspect .yzforge/generation.lock before recovery.',
                { cause: error },
            );
        throw error;
    }
    try {
        await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
        return await action();
    } finally {
        await lock.close();
        await unlink(target);
    }
}
