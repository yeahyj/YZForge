import assert from 'node:assert/strict';
import { call } from '../../tools/yzforge/mcp.mjs';

// 对已构建的独立空副本验收；仅创建测试窗口，不切换或保存编辑场景。
const url = new URL(process.argv[2]);
assert.equal(url.hostname, '127.0.0.1');
assert.equal(url.protocol, 'http:');
const appId = process.argv[3];
assert.ok(appId, '第二个参数需要填副本的框架 appId');
const poll = `(async () => {
    if (!globalThis.System) return null;
    const cc = await System.import('cc');
    const root = cc.director.getScene()?.getChildByName('GameRoot');
    const entry = root?.getComponent('game.GameRoot');
    if (!entry?.app) return null;
    const app = entry.app, phase = app.boot.inspect().state;
    if (phase === 'failed') throw Error('空模板启动失败：' + entry.bootStatus?.string);
    if (phase !== 'ready') return null;
    globalThis.__templateCheck = { cc, app, entry };
    const options = entry.appOptions();
    return {
        phase, appId: options.appId, moduleDefinitions: options.modules.length,
        viewDefinitions: options.views.length, bundleDefinitions: Object.keys(options.release.bundles),
        tables: Object.keys(options.release.tables), namespaces: Object.keys(options.release.namespaces),
        status: { text: entry.bootStatus?.string, visible: entry.bootStatus?.node.activeInHierarchy },
        activeModules: app.modules.inspect(), ui: app.ui.inspect(), assets: app.assets.inspect(),
    };
})()`;
const close = `(async () => {
    const { app } = globalThis.__templateCheck;
    await app.close();
    await app.close();
    return app.inspect();
})()`;
const result = await call('execute_javascript', {
    context: 'editor',
    args: { url: url.href, poll, close },
    code: `return await (async () => {
    const window = new (require('electron').BrowserWindow)({
        show: false, width: 720, height: 1280,
        webPreferences: { nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, offscreen: true },
    });
    const errors = [];
    window.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message); });
    try {
        await window.loadURL(args.url);
        const deadline = Date.now() + 25000;
        let state;
        while (Date.now() < deadline) {
            state = await window.webContents.executeJavaScript(args.poll);
            if (state) break;
            await new Promise(resolve => setTimeout(resolve, 150));
        }
        if (!state) throw Error('空模板未在 25 秒内就绪：' + JSON.stringify(errors));
        await window.webContents.executeJavaScript('globalThis.__templateCheck.cc.profiler.hideStats();new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));');
        const pt = require('path'), fs = require('fs');
        const screenshot = pt.join(Editor.Project.path, 'temp', 'mcp-captures', 'yzforge-empty-template.png');
        fs.mkdirSync(pt.dirname(screenshot), { recursive: true });
        fs.writeFileSync(screenshot, (await window.webContents.capturePage()).toPNG());
        const closed = await window.webContents.executeJavaScript(args.close);
        return { state, closed, screenshot, errors };
    } finally {
        window.destroy();
    }
})();`,
});
const { state, closed, errors } = result.data;
assert.equal(state.phase, 'ready');
assert.equal(state.appId, appId);
assert.equal(state.moduleDefinitions, 0);
assert.equal(state.viewDefinitions, 0);
assert.deepEqual(state.bundleDefinitions, []);
assert.deepEqual(state.tables, []);
assert.deepEqual(state.namespaces, []);
assert.deepEqual(state.activeModules, []);
assert.deepEqual(state.ui.views, []);
assert.deepEqual(state.assets.bundles, []);
assert.equal(state.status.visible, true);
assert.match(state.status.text, /启动完成/);
assert.equal(closed.scope.state, 'closed');
assert.deepEqual(closed.modules, []);
assert.deepEqual(closed.ui.views, []);
assert.deepEqual(errors, []);
console.log(JSON.stringify({ ok: true, ...result.data }, null, 2));
