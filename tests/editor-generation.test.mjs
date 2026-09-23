import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const entry = new URL('../extensions/yzforge-editor/main.js', import.meta.url);
const require = createRequire(entry);
const source = await readFile(entry, 'utf8');
const tick = () => new Promise((resolve) => setImmediate(resolve));
function editor(
    generate,
    execFile = () => {
        throw Error('Unexpected process');
    },
) {
    const timers = new Set();
    const watchers = new Map();
    const warnings = [];
    const exported = {};
    const context = vm.createContext({
        exports: exported,
        require: (name) => {
            if (name === 'fs')
                return {
                    ...require('fs'),
                    watchFile: (path, _options, listener) => watchers.set(path, listener),
                    unwatchFile: (path) => watchers.delete(path),
                    existsSync: () => false,
                };
            if (name === './bundle-config') return { ensurePresets: async () => {} };
            if (name === 'child_process') return { execFile };
            return require(name);
        },
        Editor: {
            Project: { path: fileURLToPath(new URL('../', import.meta.url)) },
            Message: { addBroadcastListener() {}, removeBroadcastListener() {} },
        },
        setTimeout: (callback) => {
            timers.add(callback);
            return callback;
        },
        clearTimeout: (callback) => timers.delete(callback),
        console: { warn: (message) => warnings.push(message) },
        generate,
    });
    vm.runInContext(source, context);
    // 仅替换耗时的资源生成；实际监听、串行队列、错误分类及重试代码完整运行。
    vm.runInContext('actions.generate = generate;', context);
    exported.load();
    return {
        async advance() {
            const timer = timers.values().next().value;
            assert.ok(timer, 'expected scheduled generation');
            timers.delete(timer);
            timer();
            await tick();
        },
        change() {
            for (const listener of watchers.values()) listener();
        },
        status: () => JSON.parse(vm.runInContext('JSON.stringify(autoStatus)', context)),
        pending: () => timers.size,
        unload: () => exported.unload(),
        processError: () => vm.runInContext('runTool("generate")', context),
        warnings,
    };
}

test('自动生成：构建锁期间合并修改，释放锁后无需再次保存即可生成最新配置', async () => {
    let busy = true;
    let version = 1;
    const generated = [];
    const editorState = editor(async () => {
        if (busy) throw Object.assign(Error('build locked'), { code: 'GAME_BUILD_BUSY' });
        generated.push(version);
    });
    try {
        await editorState.advance();
        assert.equal(editorState.status().state, 'waiting');
        version = 2;
        editorState.change();
        editorState.change();
        assert.equal(editorState.pending(), 1);
        await editorState.advance();
        assert.deepEqual(generated, []);
        busy = false;
        await editorState.advance();
        assert.deepEqual(generated, [2]);
        assert.equal(editorState.status().state, 'ready');
        assert.equal(editorState.pending(), 0);
        assert.deepEqual(editorState.warnings, []);
    } finally {
        editorState.unload();
    }
});

test('自动生成：无效配置不循环重试；卸载后迟到的构建忙错误不再启动任务', async () => {
    let fail;
    let mode = 'invalid';
    const editorState = editor(() => {
        if (mode === 'invalid') throw Error('invalid JSON');
        return new Promise((_resolve, reject) => {
            fail = reject;
        });
    });
    try {
        await editorState.advance();
        assert.equal(editorState.status().state, 'error');
        assert.equal(editorState.pending(), 0);
        assert.equal(editorState.warnings.length, 1);
        mode = 'pending';
        editorState.change();
        await editorState.advance();
        editorState.unload();
        fail(Object.assign(Error('locked'), { code: 'GAME_BUILD_BUSY' }));
        await tick();
        assert.equal(editorState.pending(), 0);
    } finally {
        editorState.unload();
    }
});

test('自动生成：子进程保留构建忙错误码，生成期间的新修改在完成后补做', async () => {
    let finish;
    let calls = 0;
    const editorState = editor(
        () => {
            calls++;
            if (calls === 1)
                return new Promise((resolve) => {
                    finish = resolve;
                });
        },
        (_file, _args, _options, callback) =>
            callback(
                Error('failed'),
                '',
                JSON.stringify({
                    code: 'GAME_BUILD_BUSY',
                    message: 'build locked',
                }),
            ),
    );
    try {
        await assert.rejects(editorState.processError(), { code: 'GAME_BUILD_BUSY', message: 'build locked' });
        await editorState.advance();
        editorState.change();
        finish();
        await tick();
        assert.equal(editorState.pending(), 1);
        await editorState.advance();
        assert.equal(calls, 2);
        assert.equal(editorState.pending(), 0);
    } finally {
        editorState.unload();
    }
});
