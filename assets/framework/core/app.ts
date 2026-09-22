import { game, Game, Node, sys } from 'cc';
import { Assets } from '../assets/asset-manager';
import { ContentRelease } from '../assets/asset-types';
import { AudioManager } from '../audio/audio-manager';
import { ConfigManager } from '../config/config-manager';
import { ModuleDefinition, ModuleManager } from '../modules/module-manager';
import { bundleFactoryLoader } from '../modules/module-entry';
import { Storage, StorageBackend } from '../platform/storage';
import { createPlatformClock, PlatformClockOptions } from '../platform/clock';
import { TimeOptions, TimeService } from '../time/time-service';
import { UIManager, ViewDefinition } from '../ui/ui-manager';
import { ClockDriver, SystemClockDriver } from './clock-driver';
import { Events } from './events';
import { Scope, Lifetime } from './scope';
import { FrameworkError } from './errors';
import { GameComponent } from './game-component';
import { BootFlow } from './boot';
import type { RuntimeDiagnostics } from './diagnostics';
/**
 * 应用启动装配参数。通常由项目设置和生成的发布清单构建，交给 AppEntry.appOptions。
 */
export interface AppOptions {
    /** 可选同步存储适配器；默认 Cocos sys.localStorage，用于平台接入或测试。 */
    readonly storageBackend?: StorageBackend;
    /**
     * 稳定应用 ID，用作本地存储前缀；允许字母、数字、点、下划线和连字符，首字符须为字母或数字。
     */
    readonly appId: string;
    /**
     * 应用节点，承载音频等常驻对象；由启动场景提供，其存活时间应覆盖 App。
     */
    readonly root: Node;
    /**
     * UI 层级的父节点，应位于正确配置的 Canvas 下；管理器在其下创建各类 UI 层。
     */
    readonly uiRoot: Node;
    /**
     * 生成的内容发布路由，包含代码包、资源包、动态索引和配置路由；运行中不改写。
     */
    readonly release: ContentRelease;
    /**
     * 模块定义列表，描述依赖及 eager 工厂或 lazy 代码入口；登记不等于执行模块业务初始化。
     */
    readonly modules: readonly ModuleDefinition[];
    /**
     * 生成的 UI 定义列表，描述 ViewKey、所属模块、预制体资源和层级策略。
     */
    readonly views: readonly ViewDefinition[];
    /**
     * 可选底层时钟驱动，用于平台适配或测试；提供时优先于 clockOptions。
     */
    readonly clock?: ClockDriver;
    /**
     * 业务时间配置，例如服务器源、可信度要求、日历偏移及刷新边界；未设置时采用 TimeService 默认值。
     */
    readonly time?: TimeOptions;
    /**
     * 默认平台时钟适配选项，例如微信性能计数器单位；显式提供 clock 时不使用。
     */
    readonly clockOptions?: PlatformClockOptions;
    /**
     * UI 和模块清理超时阈值，单位毫秒，默认 10000；只累计前台可测时间。
     * 超时用于隔离未完成清理，不会强行终止 JavaScript Promise。
     */
    readonly cleanupTimeoutMs?: number;
    /**
     * 最大同时占用的音频声部数，正整数，默认 16；达到上限时普通新播放请求会失败。
     */
    readonly maxAudioVoices?: number;
    /**
     * 自定义音频通道及初始音量，音量为 0～1；内置 bgm、sfx、voice 默认均为 1。
     */
    readonly audioChannels?: Readonly<Record<string, number>>;
}
/**
 * 框架应用入口，装配资源、配置、UI、音频、模块、事件、时间和存储服务。
 * 通常由 AppEntry 创建，业务组件通过 this.ctx 使用所需服务，无需各自 new 管理器。
 */
export class App {
    /** 获取当前运行诊断快照，适合调试面板和错误报告；不会加载模块或修改运行状态。 */
    inspect() {
        return Object.freeze({
            scope: this.scope.inspect(),
            flows: this.flows.inspect(),
            modules: this.modules.inspect(),
            ui: this.ui.inspect(),
            assets: this.assets.inspect(),
            config: this.config.inspect(),
            time: this.time.snapshot(),
            boot: this.boot.inspect(),
        });
    }
    /** 只读诊断能力；模块接收此接口，不需要获得整个 App。 */
    readonly diagnostics: RuntimeDiagnostics = Object.freeze({
        snapshot: () => {
            const assets = this.assets.inspect();
            const config = this.config.inspect();
            return Object.freeze({
                pages: this.ui.inspect().pages,
                modules: Object.freeze(this.modules.inspect().map((module) => module.id)),
                bundles: Object.freeze([...assets.bundles]),
                resourceCount: assets.resources.filter((entry) => entry.users > 0).length,
                configCount: config.filter((entry) => entry.users > 0).length,
                configDrainingCount: config.filter((entry) => entry.users === 0).length,
            });
        },
        module: (id: string) =>
            Object.freeze({
                codeReady: this.modules.isCodeReady(id),
                businessReady: this.modules.isReady(id),
            }),
    });
    /**
     * 应用根生命周期，覆盖所有核心服务；普通业务流程优先放到 flows 或更短的子 Scope。
     */
    readonly scope = new Scope('app');
    /**
     * 应用中的普通业务流程所有者；关停时优先取消，避免流程继续请求正在关闭的服务。
     * 可以 child 创建独立会话，并在会话结束时 close。
     */
    readonly flows = this.scope.child('flows');
    /** 失败时回收本次业务启动，保留核心服务以展示错误和允许显式重试。 */
    readonly boot = new BootFlow(this.flows.lifetime);
    /**
     * 全应用共享的类型化事件总线，用于广播已发生的事实；命令和查询优先用模块 API。
     */
    readonly events = new Events();
    /**
     * 以 appId 隔离的小型本地存储入口，提供版本和类型校验。
     */
    readonly storage: Storage;
    /**
     * 只读的平台信息快照：native 是否原生、mobile 是否移动设备、os 操作系统、platform 引擎平台标识。
     */
    readonly platform = Object.freeze({
        /**
         * 是否为 Cocos 原生运行环境，对应 sys.isNative。
         */
        native: sys.isNative,
        /**
         * 引擎是否将当前设备识别为移动设备，对应 sys.isMobile。
         */
        mobile: sys.isMobile,
        /**
         * Cocos 提供的操作系统标识，对应 sys.os。
         */
        os: sys.os,
        /**
         * Cocos 运行平台标识，对应 sys.platform。
         */
        platform: sys.platform,
    });
    /**
     * 底层设备时间、单调计时和前后台驱动；业务日期、校时和跨日订阅优先使用 time。
     */
    readonly clock: ClockDriver;
    /**
     * 全应用业务时间服务。直接订阅须传 Scope；模块内可用已绑定所有者的 ctx.time。
     */
    readonly time: TimeService;
    /**
     * 共享资源管理器；使用时显式传所有者，或通过 in 创建带默认 Scope 的入口。
     */
    readonly assets: Assets;
    /**
     * 配置表管理器；导入生成合同后按需 load 数据，表查询结果随 Scope 有效。
     */
    readonly config: ConfigManager;
    /**
     * 模块代码准备和业务生命周期管理器；use 取得绑定所有者的 API 句柄。
     */
    readonly modules: ModuleManager;
    /**
     * UI 管理器，负责层级、展示 Scope、结果、缓存和页面栈。
     */
    readonly ui: UIManager;
    /**
     * 音频播放及音量管理器，播放任务显式绑定所有者。
     */
    readonly audio: AudioManager;
    private closing?: Promise<void>;
    private readonly unbind: () => void = () => {};
    /**
     * 构建应用核心；任何一步失败都会等待已创建部分清理后才拒绝。
     * 初始业务通过 app.boot.start 启动，使用 BootContext.scope 持有首屏和会话。
     */
    static async create(input: AppOptions): Promise<App> {
        let partial: App | undefined;
        try {
            return new App(input, (value) => {
                partial = value;
            });
        } catch (error) {
            try {
                await partial?.close();
            } catch (cleanup) {
                throw new FrameworkError('APP_STARTUP_FAILED', 'App construction and cleanup failed', {
                    error,
                    cleanup,
                });
            }
            throw error;
        }
    }
    /**
     * 创建核心服务并接通引擎前后台事件，尚未执行所有模块业务工厂。
     * @param input - 应用装配参数，通常使用生成清单与项目设置。
     * @throws FrameworkError appId、发布路由、模块依赖或服务配置不合法。
     */
    private constructor(input: AppOptions, capture: (partial: App) => void) {
        capture(this);
        if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(input.appId))
            throw new FrameworkError('APP_ID_INVALID', 'Provide a stable application ID for storage isolation');
        this.storage = new Storage(`${input.appId}:`, input.storageBackend ?? sys.localStorage);
        this.clock = input.clock ?? createPlatformClock(input.clockOptions);
        this.time = new TimeService(this.clock, this.scope, input.time);
        this.assets = new Assets(input.release, this.scope);
        this.config = new ConfigManager(this.assets);
        this.assets.attachConfig(this.config);
        this.modules = new ModuleManager(
            input.modules,
            this.clock,
            (id, scope, createSession) =>
                Object.freeze({
                    id,
                    scope,
                    assets: this.assets.in(scope, `${id}/default`, id),
                    config: this.config.in(scope),
                    time: this.time.in(scope),
                    events: this.events,
                    storage: this.storage,
                    diagnostics: this.diagnostics,
                    ui: this.ui,
                    audio: this.audio,
                    createSession,
                }),
            undefined,
            input.cleanupTimeoutMs,
        );
        this.modules.loadFactory = bundleFactoryLoader(this.assets);
        this.assets.codeReady = (id) => this.modules.isCodeReady(id);
        this.assets.prepareCode = (id, owner) => this.modules.prepareCode(id, owner);
        this.assets.moduleReady = (id) => this.modules.isReady(id);
        this.assets.bindInstance = (node, scope, id, active) => {
            const components = node.getComponentsInChildren(GameComponent);
            if (components.length && !id)
                throw new FrameworkError(
                    'INSTANCE_MODULE_REQUIRED',
                    'Provide the business host moduleId or instantiate through ctx.assets',
                );
            if (id)
                for (const component of components) {
                    component.__bind(this.modules.contextForBinding(id), scope, this.time);
                    if (active) component.__allow(scope);
                }
        };
        this.assets.activateInstance = (node, scope) => {
            for (const component of node.getComponentsInChildren(GameComponent)) component.__allow(scope);
        };
        this.ui = new UIManager(
            input.uiRoot,
            this.assets,
            this.modules,
            this.time,
            this.clock,
            input.views,
            this.scope.lifetime,
            undefined,
            input.cleanupTimeoutMs,
        );
        this.audio = new AudioManager(
            input.root,
            this.assets,
            this.clock,
            this.scope,
            input.maxAudioVoices,
            input.audioChannels,
        );
        const hide = () => {
            if (this.clock instanceof SystemClockDriver) this.clock.setBackground(true);
        };
        const show = () => {
            if (this.clock instanceof SystemClockDriver) this.clock.setBackground(false);
        };
        game.on(Game.EVENT_HIDE, hide);
        game.on(Game.EVENT_SHOW, show);
        this.unbind = () => {
            game.off(Game.EVENT_HIDE, hide);
            game.off(Game.EVENT_SHOW, show);
        };
    }
    /**
     * 把手工编排场景中的 GameComponent 接入某个模块的框架生命周期。
     * @param root - 要查找框架组件的场景根节点或子树根节点。
     * @param moduleId - 组件的宿主业务模块；先取得模块持有，再绑定组件。
     * @param owner - 此场景会话的所有者；返回的绑定 Scope 是其子 Scope。
     * @returns 场景绑定 Scope，关闭时结束组件框架生命周期和模块持有。
     * @remarks 不负责创建或销毁传入的场景节点；UI 预制体和 assets.instantiate 已自动绑定，无需重复调用。
     * @throws 模块初始化、组件绑定或取消错误；失败时清理本次绑定持有。
     */
    async bindScene(root: Node, moduleId: string, owner: Lifetime): Promise<Scope> {
        const scope = owner.child(`scene-host:${moduleId}`);
        try {
            await this.modules.use({ id: moduleId }, scope);
            scope.signal.throwIfAborted();
            this.assets.bindInstance(root, scope, moduleId, true);
            return scope;
        } catch (error) {
            await scope.close();
            throw error;
        }
    }
    /**
     * 依次停止 UI、业务流程、音频、模块及根 Scope，并解绑引擎事件。
     * @returns 全部清理结束后完成；重复调用返回同一次关停 Promise。
     * @throws FrameworkError 清理中出现错误时，以 APP_SHUTDOWN_FAILED 汇总，仍会尝试其他清理步骤。
     */
    close(): Promise<void> {
        if (!this.closing)
            this.closing = (async () => {
                const failures: unknown[] = [];
                const attempt = async (action: () => Promise<void>) => {
                    try {
                        await action();
                    } catch (error) {
                        failures.push(error);
                    }
                };
                this.flows.cancel();
                await attempt(() => this.ui?.close() ?? Promise.resolve());
                await attempt(() => this.flows.close());
                await attempt(() => this.audio?.close() ?? Promise.resolve());
                await attempt(() => this.modules?.close() ?? Promise.resolve());
                await attempt(() => this.scope.close());
                this.unbind();
                if (failures.length)
                    throw new FrameworkError('APP_SHUTDOWN_FAILED', 'Shutdown completed with cleanup failures', {
                        failures,
                    });
            })();
        return this.closing;
    }
}
