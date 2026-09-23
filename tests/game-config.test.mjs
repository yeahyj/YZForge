import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile, mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import config from '../tools/yzforge/game-config.cjs';
import build from '../tools/yzforge/game-build.cjs';

const original = JSON.parse(await readFile(new URL('../project-settings/game-config.json', import.meta.url), 'utf8'));
const selection = { appVersion: '1.0.0', channel: 'web_local', mode: 'debug', environment: 'dev' };
const fixture = () => {
    const source = structuredClone(original);
    source.preview.mockSdk = false;
    for (const channel of Object.values(source.channels)) {
        for (const [environment, value] of Object.entries(channel.environments))
            value.apiBaseUrl = `https://${environment}.example.test`;
    }
    return source;
};
test('游戏配置：渠道 × 模式 × 环境独立，Debug+Prod 和 Release+Staging 地址正确', () => {
    const source = fixture();
    for (const channel of Object.keys(source.channels))
        for (const mode of config.modes)
            for (const environment of config.environments) {
                const snapshot = config.resolveConfig(source, { appVersion: '1.2.3', channel, mode, environment });
                assert.equal(snapshot.endpoints.apiBaseUrl, `https://${environment}.example.test`);
                assert.equal(snapshot.diagnostics.logLevel, source.modes[mode].logLevel);
                assert.equal(snapshot.platform, source.channels[channel].platform);
                assert.equal(snapshot.channel, channel);
                assert.equal('channels' in snapshot, false);
                assert.equal('storageNamespace' in snapshot, false);
            }
});
test('游戏配置：字符串 ID 不依赖排列，显示名修改不改变所选渠道', () => {
    const source = fixture();
    const expected = config.resolveConfig(source, selection);
    source.channels = Object.fromEntries(Object.entries(source.channels).reverse());
    assert.deepEqual(config.resolveConfig(source, selection), expected);
    source.channels[selection.channel].name = '改名';
    assert.equal(config.resolveConfig(source, selection).channel, expected.channel);
    assert.notEqual(config.resolveConfig(source, selection).configHash, expected.configHash);
});
test('游戏配置：缺失渠道/环境、错误字段、模式覆盖地址、无效 JSON 参数被拒绝', () => {
    const source = fixture();
    assert.throws(() => config.resolveConfig(source, { ...selection, channel: 'missing' }), /渠道不存在/);
    delete source.channels[selection.channel].environments.prod;
    assert.throws(() => config.resolveConfig(source, { ...selection, environment: 'prod' }), /未配置 prod/);
    const override = fixture();
    override.modes.debug.apiBaseUrl = 'https://wrong.test';
    assert.throws(() => config.resolveConfig(override, selection), /不支持字段 apiBaseUrl/);
    const params = fixture();
    params.channels.web_local.environments.dev.sdkParameters.value = NaN;
    assert.throws(() => config.resolveConfig(params, selection), /必须是对象/);
    assert.throws(() => config.resolveConfig(source, { ...selection, appVersion: '../bad' }), /游戏版本/);
});

test('游戏配置：增加复用 SDK 的渠道只需配置；已删除渠道不回退到第一项', () => {
    const source = fixture();
    source.channels.wechat_partner_b = {
        ...structuredClone(source.channels.wechat_partner),
        name: '微信 · 发行商 B',
        integration: 'partner',
    };
    assert.match(config.channelOptionsSource(source), /wechat_partner_b/);
    assert.equal(
        config.resolveConfig(source, { ...selection, channel: 'wechat_partner_b' }).sdk.integration,
        'partner',
    );
    delete source.channels.web_local;
    assert.match(config.channelOptionsSource(source), /发行商 B/);
    assert.throws(() => config.resolveConfig(source, selection), /渠道不存在/);
    assert.throws(() => config.validate({ ...source, selection }), /不支持字段 selection/);
});

test('游戏配置：新平台的构建映射由 JSON 登记', () => {
    const source = fixture();
    source.platforms.custom_host = ['custom-game'];
    source.channels.custom_self = {
        ...structuredClone(source.channels.web_local),
        platform: 'custom_host',
        name: '新宿主',
    };
    const snapshot = config.resolveConfig(source, { ...selection, channel: 'custom_self' });
    assert.doesNotThrow(() => config.assertBuild(snapshot, { platform: 'custom-game', debug: true }));
    assert.throws(() => config.assertBuild(snapshot, { platform: 'web-mobile', debug: true }), /构建目标/);
});
test('游戏构建：核对真实 debug、平台、AppID；禁止预览模拟进入产物', () => {
    const source = fixture();
    const snapshot = config.resolveConfig(source, {
        ...selection,
        channel: 'web_local',
        mode: 'debug',
        environment: 'prod',
    });
    assert.doesNotThrow(() => config.assertBuild(snapshot, { platform: 'web-mobile', debug: true }));
    assert.throws(() => config.assertBuild(snapshot, { platform: 'web-mobile', debug: false }), /Debug/);
    assert.throws(() => config.assertBuild(snapshot, { platform: 'wechatgame', debug: true }), /构建目标/);
    assert.throws(
        () => config.assertBuild({ ...snapshot, previewMockSdk: true }, { platform: 'web-mobile', debug: true }),
        /模拟 SDK/,
    );
    const wechat = config.resolveConfig(source, { ...selection, channel: 'wechat_self' });
    assert.throws(
        () => config.assertBuild(wechat, { platform: 'wechatgame', debug: wechat.mode === 'debug' }),
        /platformAppId/,
    );
    wechat.platformAppId = 'wx_fixture';
    assert.throws(
        () =>
            config.assertBuild(wechat, {
                platform: 'wechatgame',
                debug: wechat.mode === 'debug',
                packages: { wechatgame: { appid: 'wx_other' } },
            }),
        /AppID/,
    );
});
test('游戏构建：冻结快照、互斥、配置漂移检测、释放后可以重复构建', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yzforge-game-build-'));
    let lease;
    try {
        const source = fixture();
        const snapshot = config.resolveConfig(source, selection);
        const savedScene = [
            { __type__: 'cc.SceneAsset' },
            { __type__: 'cc.Scene' },
            { __type__: 'cc.Node', _name: 'GameRoot', _parent: { __id__: 1 }, _components: [{ __id__: 3 }] },
            {
                __type__: 'game.GameSettings',
                appVersion: selection.appVersion,
                channelId: selection.channel,
                mode: 0,
                environment: 0,
            },
        ];
        for (const [file, value] of [
            [config.sourcePath, JSON.stringify(source)],
            [config.selectionPath, JSON.stringify(savedScene)],
            [config.componentMetaPath, JSON.stringify({ uuid: '17725982-0e26-487f-990c-f0dd249803d5' })],
            [config.snapshotPath, JSON.stringify(snapshot)],
            [config.outputPath, 'export const gameConfig = {};'],
        ]) {
            await mkdir(dirname(join(root, file)), { recursive: true });
            await writeFile(join(root, file), value);
        }
        const options = {
            platform: 'web-mobile',
            debug: snapshot.mode === 'debug',
            packages: { 'yzforge-editor': { configHash: snapshot.configHash } },
        };
        lease = await build.begin(root, options);
        await assert.rejects(config.assertUnlocked(root), /游戏构建正在使用/);
        await assert.rejects(build.begin(root, options), /已有游戏构建/);
        assert.equal((await build.verify(lease)).configHash, snapshot.configHash);
        savedScene[3].environment = 2;
        await writeFile(join(root, config.selectionPath), JSON.stringify(savedScene));
        await assert.rejects(build.verify(lease), /发生变化/);
        await build.end({ ...lease, buildId: 'not-the-owner' });
        await access(join(root, '.yzforge/game-build.lock'));
        await build.end(lease);
        await config.assertUnlocked(root);
        await assert.rejects(build.begin(root, options), /旧游戏配置/);
    } finally {
        await build.end(lease);
        await rm(root, { recursive: true, force: true });
    }
});

test('构建恢复：只移除已退出进程的锁，活动构建、未知状态、并发生成和变更的锁均保留', async () => {
    const root = await mkdtemp(join(tmpdir(), 'yzforge-build-recovery-'));
    const directory = join(root, '.yzforge');
    const file = join(root, config.buildLockPath);
    // 使用实际退出的子进程 PID，避免假设某个固定 PID 永远不存在。
    const child = spawn(process.execPath, ['-e', ''], { windowsHide: true });
    const pid = child.pid;
    await once(child, 'exit');
    const stale = { buildId: 'interrupted', pid, channel: 'web_local', mode: 'debug', environment: 'dev' };
    const save = (value) => writeFile(file, JSON.stringify(value));
    try {
        await mkdir(directory);
        await save({ ...stale, pid: process.pid });
        await assert.rejects(
            build.recover(root, async () => true),
            /进程仍在运行/,
        );
        assert.equal(JSON.parse(await readFile(file, 'utf8')).pid, process.pid);
        await save(stale);
        for (const idle of [false, undefined]) {
            await assert.rejects(
                build.recover(root, async () => idle),
                /状态不可确认/,
            );
            await access(file);
        }
        await writeFile(join(directory, 'generation.lock'), '{}');
        await assert.rejects(
            build.recover(root, async () => true),
            /Generation is already running/,
        );
        await access(file);
        await rm(join(directory, 'generation.lock'));
        await assert.rejects(
            build.recover(root, async () => {
                await save({ ...stale, buildId: 'replacement' });
                return true;
            }),
            /构建锁已变化/,
        );
        assert.equal(JSON.parse(await readFile(file, 'utf8')).buildId, 'replacement');
        await save(stale);
        assert.deepEqual(await build.recover(root, async () => true), { recovered: true, buildId: 'interrupted' });
        await config.assertUnlocked(root);
        assert.deepEqual(await build.recover(root), { recovered: false });
        await save(stale);
        assert.deepEqual(await build.recover(root), { recovered: true, buildId: 'interrupted' });
        await save({ pid });
        await assert.rejects(build.recover(root), /缺少有效进程和任务标识/);
        await access(file);
    } finally {
        await rm(root, { recursive: true, force: true });
    }
});
