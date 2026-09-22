import { untilCancelled } from '../core/cancellation';
import { ClockDriver, foregroundDeadline } from '../core/clock-driver';
import { ErrorReporter, FrameworkError, invariant, reportError } from '../core/errors';
import { Scope, Lifetime } from '../core/scope';
import type { ScopedAssets } from '../assets/asset-manager';
import type { ScopedConfig } from '../config/config-manager';
import type { Events } from '../core/events';
import type { ScopedTime } from '../time/time-service';
import type { AudioManager } from '../audio/audio-manager';
import type { UIManager } from '../ui/ui-manager';
import type { Storage } from '../platform/storage';

/**
 * 模块的轻量公开引用，通常由模块 public.ts 导出。
 * import 此引用不会加载私有代码或初始化业务；app.modules.use 才取得模块 API。
 * @typeParam Api - 模块对外公开的 API 合同。
 */
export interface ModuleRef<Api> {
    /**
     * 已登记的模块 ID，例如 inventory；与 module.json 的 id 一致。
     */
    readonly id: string;
    /**
     * @internal
     * 框架内部类型标记或生命周期入口，业务通过公开上下文和管理器使用，不直接读写或调用。
     */
    readonly __api?: Api;
}
/** 模块内部服务集合的类型引用；应放在模块私有 code 中，跨模块通信使用 ModuleRef 的公开 API。 */
export interface ModuleServicesRef<T> {
    /** 服务所属的业务模块 ID，用来阻止其他模块直接读取内部服务。 */
    readonly moduleId: string;
    /** @internal 仅供 TypeScript 关联服务集合类型。 */
    readonly __services?: T;
}
/**
 * 定义本模块内部服务集合的轻量引用，不创建服务实例。
 * @example const InventoryServices = moduleServices<{ inventory: InventoryService }>('inventory');
 */
export function moduleServices<T>(moduleId: string): ModuleServicesRef<T> {
    return Object.freeze({ moduleId });
}
/** 别名到公开模块引用的类型映射；项目由 module.json.dependencies 生成 code/generated/dependencies.ts。 */
export type ModuleDependencies = Readonly<Record<string, ModuleRef<unknown>>>;
/** 从依赖引用推导完整 API 类型，业务无需将 unknown 强制转换为自己的接口。 */
export type DependencyApis<D extends ModuleDependencies> = {
    readonly [K in keyof D]: D[K] extends ModuleRef<infer Api> ? Api : never;
};
/**
 * 将模块工厂与公开 API、内部服务及依赖类型连接起来；返回普通 ModuleFactory，不引入自动依赖注入容器。
 * @param ref public.ts 中的公开模块引用，工厂必须满足其 API 合同。
 * @param input 可选内部服务合同和依赖别名映射，依赖实例仍由模块管理器按声明初始化。
 * @param factory 显式创建普通 Service 并返回 { api, services }；清理登记到 ctx.scope。
 * @returns 可直接装配到 ModuleDefinition 或 ModuleEntry 的工厂。
 */
export function defineModule<Api, Services = unknown, D extends ModuleDependencies = Record<string, never>>(
    ref: ModuleRef<Api>,
    input: { readonly services?: ModuleServicesRef<Services>; readonly dependencies?: D },
    factory: (
        ctx: ModuleContext,
        dependencies: DependencyApis<D>,
    ) =>
        | { api: NoInfer<Api>; services?: NoInfer<Services> }
        | Promise<{ api: NoInfer<Api>; services?: NoInfer<Services> }>,
): ModuleFactory<Api> {
    invariant(
        !input.services || input.services.moduleId === ref.id,
        'MODULE_SERVICES_HOST',
        'Services must belong to the factory module',
    );
    return async (ctx, raw) => {
        invariant(ctx.id === ref.id, 'MODULE_FACTORY_ID', `Expected module ${ref.id}, received ${ctx.id}`);
        const dependencies: Record<string, unknown> = {};
        for (const [alias, dependency] of Object.entries(input.dependencies ?? {})) {
            invariant(
                Object.prototype.hasOwnProperty.call(raw, dependency.id),
                'MODULE_DEPENDENCY_MISSING',
                `Declare ${dependency.id} in ${ref.id}/module.json`,
            );
            dependencies[alias] = raw[dependency.id];
        }
        const result = await factory(ctx, Object.freeze(dependencies) as DependencyApis<D>);
        invariant(
            !input.services || result.services !== undefined,
            'MODULE_SERVICES_MISSING',
            `Factory ${ref.id} must return its declared services`,
        );
        return result;
    };
}
/**
 * 框架注入模块工厂、UIView 和 GameComponent 的业务上下文。
 * 模块 Scope、界面展示 Scope、组件激活 Scope 长度不同，应按实际使用期选择。
 */
export interface ModuleContext {
    /** 应用命名空间下的小型存档与设置入口，支持逐版本迁移和有效备份恢复。 */
    readonly storage: Storage;
    /**
     * 读取本模块工厂显式返回的内部服务集合，不创建服务或延长模块寿命。
     * @param ref 本模块 code 中的 moduleServices 引用。
     * @returns 带完整类型的同一组服务；服务状态由服务自身管理。
     * @throws MODULE_NOT_READY 工厂尚未完成或旧代已结束；MODULE_SERVICES_HOST 引用属于其他模块。
     * @example const { inventory } = this.ctx.services(InventoryServices);
     */
    services<T>(ref: ModuleServicesRef<T>): T;
    /**
     * 当前宿主业务模块 ID；共享 Part 从其他资源包加载时，仍使用调用方指定的宿主。
     */
    readonly id: string;
    /**
     * 本次模块业务实例的生命周期，最后一个外部持有结束后清理；不是每次 UI 展示的 Scope。
     */
    readonly scope: Lifetime;
    /**
     * 默认使用模块 Scope、“当前模块/default”命名空间和当前宿主的资源入口。
     * 临时界面资源使用 ctx.assets.in(show.scope)。
     */
    readonly assets: ScopedAssets;
    /**
     * 默认由模块持有的配置入口；界面短期使用请 load(Table, show.scope)。
     */
    readonly config: ScopedConfig;
    /**
     * 共享类型化事件总线；on 需显式传订阅所有者，例如 show.scope。
     */
    readonly events: Events;
    /**
     * 默认绑定模块 Scope 的业务时间入口；界面短期订阅使用 show.time。
     */
    readonly time: ScopedTime;
    /**
     * 共享 UI 管理器，open 和 pushPage 需显式传入界面所有者。
     */
    readonly ui: UIManager;
    /**
     * 共享音频服务，每次 play 都需指定播放所有者。
     */
    readonly audio: AudioManager;
    /**
     * 为外部业务流程创建会话，并在会话结束前额外保持当前模块业务实例。
     * @param owner - 外部所有者，例如 app.flows；不能是本模块 scope 或其后代，避免模块持有自己。
     * @param label - 用于诊断的会话名称。
     * @returns owner 的子 Scope；关闭时归还本次模块持有，不会创建另一份模块实例。
     * @throws FrameworkError 模块尚未发布 API，或 owner 属于模块内部。
     * @remarks 通过已就绪的公开模块 API 发起会话；模块工厂初始化中不要调用此方法。
     */
    createSession(owner: Lifetime, label: string): Scope;
}
/**
 * 模块业务初始化工厂，在首次 use 的这一代业务实例中执行一次，可同步或异步返回 { api }。
 * 第一个参数 ctx 是模块上下文，第二个参数按依赖模块 ID 提供已经初始化的 API。
 * 模块结束时通过 ctx.scope.defer 登记的函数清理服务；再次 use 可能创建新一代业务实例。
 * @remarks 代码随应用启动加载只表示工厂可用，不表示工厂已经执行。不要在工厂中等待自身 UI 或自身 use。
 * @typeParam Api - 返回给调用方的公开 API 类型。
 */
export type ModuleFactory<Api = unknown> = (
    ctx: ModuleContext,
    dependencies: Readonly<Record<string, unknown>>,
) => { api: Api; services?: unknown } | Promise<{ api: Api; services?: unknown }>;
/**
 * 模块装配描述，由 module.json 生成；同时描述业务依赖与代码交付方式。
 */
export interface ModuleDefinition {
    /**
     * 全局唯一模块 ID。
     */
    readonly id: string;
    /**
     * 依赖模块 ID 数组；业务初始化时先取得这些依赖，其 API 按 ID 注入工厂第二个参数。
     * 必须存在且不得循环，关闭时按相反依赖顺序清理。
     */
    readonly dependencies: readonly string[];
    /**
     * 随应用代码提供的工厂函数，即 eager 代码模式；登记函数不会立即执行业务初始化。
     */
    readonly factory?: ModuleFactory;
    /**
     * 按需模式的本地可执行代码 Bundle ID；未提供 factory 时与 entryPath 一起指定。
     */
    readonly codeBundle?: string;
    /**
     * 代码 Bundle 内的模块入口预制体路径，由 ModuleEntry 返回工厂；不应指向普通 UI 预制体。
     */
    readonly entryPath?: string;
}
/**
 * 有使用期限的模块 API 句柄，由 modules.use 返回；所有者结束时自动归还，也可提前 release。
 * 多个句柄共享一代业务实例，最后一份持有归还后才启动模块清理。
 */
export interface ModuleHandle<Api> {
    /**
     * 公开业务 API；句柄归还、所有者取消或模块停止后访问会抛 MODULE_HANDLE_ENDED。
     * 不要从中提取嵌套对象并长期跨生命周期保存；嵌套业务对象仍需模块自己约束。
     */
    readonly api: Api;
    /**
     * 句柄及所有者仍有效，且模块处于业务 ready 状态时为 true。
     */
    readonly active: boolean;
    /**
     * 提前归还本句柄，重复调用不会重复减少持有。
     * @returns 若这是最后一份持有，等待模块清理；否则只结束本句柄。
     * @remarks 归还业务持有不等于从 JavaScript 运行时卸载已经注册的代码。
     */
    release(): Promise<void>;
}
type ModuleRecord = {
    definition: ModuleDefinition;
    scope: Scope;
    context: ModuleContext;
    demand: number;
    state: 'initializing' | 'ready' | 'stopping';
    codeReady: boolean;
    cleanupPending: boolean;
    ready: Promise<unknown>;
    api?: unknown;
    services?: unknown;
    stop?: Promise<void>;
    faultHolds: number;
    stopTimedOut: boolean;
};

/**
 * 管理代码准备、模块依赖、共享业务实例及其持有期限。
 * 业务通过 use 获得有期限的 API；prepareCode 仅用于需要先注册预制体脚本等情况。
 */
export class ModuleManager {
    /** 读取正在存活的业务模块、外部持有数及清理状态，不触发初始化。 */
    inspect() {
        return Object.freeze(
            Array.from(this.records, ([id, record]) =>
                Object.freeze({
                    id,
                    state: record.state,
                    demand: record.demand,
                    codeReady: record.codeReady,
                    cleanupPending: record.cleanupPending,
                    scope: record.scope.inspect(),
                }),
            ),
        );
    }
    private readonly definitions = new Map<string, ModuleDefinition>();
    private readonly records = new Map<string, ModuleRecord>();
    private readonly codeScope = new Scope('module-code');
    private readonly factories = new Map<string, Promise<ModuleFactory>>();
    private readonly loadedCode = new Set<string>();
    private accepting = true;
    private readonly dependencyOrder: string[] = [];
    /**
     * @internal
     * UIManager 接入的闲置实例驱逐回调，模块结束前清理属于它的缓存界面。
     */
    evictIdleViews: (moduleId: string) => Promise<void> = async () => {};
    /**
     * @internal
     * App 接入的工厂加载适配器；准备本地代码和入口，只返回工厂而不执行它。
     */
    loadFactory: (definition: ModuleDefinition, scope: Scope) => Promise<ModuleFactory> = async (definition) => {
        invariant(definition.factory, 'MODULE_LOADER_MISSING', `No code bundle adapter for ${definition.id}`);
        return definition.factory;
    };
    /**
     * @internal
     * App 创建模块管理器并校验重复 ID、缺失依赖和循环依赖。
     * @param definitions - 模块装配列表。
     * @param clock - 前台清理计时驱动。
     * @param makeContext - 为每一代业务实例创建模块上下文。
     * @param report - 异步清理异常上报器。
     * @param cleanupTimeoutMs - 前台清理超时毫秒数，默认 10000；超时隔离而不提前释放仍被使用的资源。
     */
    constructor(
        definitions: readonly ModuleDefinition[],
        private readonly clock: ClockDriver,
        private readonly makeContext: (
            id: string,
            scope: Scope,
            createSession: (owner: Lifetime, label: string) => Scope,
        ) => Omit<ModuleContext, 'services'>,
        private readonly report: ErrorReporter = reportError,
        private readonly cleanupTimeoutMs = 10000,
    ) {
        for (const definition of definitions) {
            invariant(!this.definitions.has(definition.id), 'MODULE_DUPLICATE', definition.id);
            this.definitions.set(definition.id, definition);
        }
        const visiting = new Set<string>(),
            ready = new Set<string>();
        const visit = (id: string) => {
            if (ready.has(id)) return;
            const definition = this.definitions.get(id);
            invariant(definition && !visiting.has(id), 'MODULE_DEPENDENCY_INVALID', `Missing or cyclic module: ${id}`);
            visiting.add(id);
            for (const dependency of definition.dependencies) visit(dependency);
            visiting.delete(id);
            ready.add(id);
        };
        for (const id of this.definitions.keys()) visit(id);
        this.dependencyOrder = Array.from(ready);
    }
    /**
     * 检查模块代码/工厂是否已可用，不判断业务是否已初始化，也不触发加载。
     * @param id - 模块 ID。
     * @returns eager 模块已有工厂或 lazy 工厂已准备时为 true；未知模块为 false。
     */
    isCodeReady(id: string): boolean {
        return this.loadedCode.has(id) || !!this.definitions.get(id)?.factory;
    }
    /**
     * 只准备模块代码及入口工厂，不执行该模块的业务初始化。
     * @param id - 已登记的模块 ID。
     * @param owner - 本次等待的所有者；取消本次等待不强制卸载共享代码。
     * @returns 工厂和可反序列化脚本可用后完成；业务 API 就绪请调用 use。
     */
    async prepareCode(id: string, owner: Lifetime): Promise<void> {
        owner.signal.throwIfAborted();
        await untilCancelled(this.factoryFor(id), owner.signal);
    }
    private factoryFor(id: string): Promise<ModuleFactory> {
        const definition = this.definitions.get(id);
        invariant(this.accepting && definition, 'MODULE_UNKNOWN', id);
        let pending = this.factories.get(id);
        if (!pending) {
            const scope = this.codeScope.child(id);
            pending = this.loadFactory(definition, scope).then((factory) => {
                this.loadedCode.add(id);
                return factory;
            });
            this.factories.set(id, pending);
            void pending.catch(() => {
                if (this.factories.get(id) === pending) this.factories.delete(id);
                void scope.close().catch(this.report);
            });
        }
        return pending;
    }
    /**
     * 检查当前业务实例是否已初始化完成，不触发创建；与 isCodeReady 含义不同。
     * @param id - 模块 ID。
     * @returns 当前业务状态为 ready 时为 true；未使用、正在初始化、停止或未知时为 false。
     */
    isReady(id: string): boolean {
        return this.records.get(id)?.state === 'ready';
    }
    /**
     * @internal
     * 判断 owner 是否为本模块业务 Scope 或其后代，避免内部 UI 再次持有自身模块。
     */
    isInternalOwner(id: string, owner: Lifetime): boolean {
        return this.records.get(id)?.scope.owns(owner) ?? false;
    }
    /**
     * @internal
     * 提供预制体绑定所需上下文，允许工厂初始化期间对未激活实例注入；实际激活仍要求模块 ready。
     */
    contextForBinding(id: string): ModuleContext {
        const record = this.records.get(id);
        invariant(record && record.state !== 'stopping', 'MODULE_NOT_READY', id);
        return record.context;
    }
    /**
     * @internal
     * 检查初始化中的模块是否通过内部所有者等待自己的 UI，发现循环等待时抛 MODULE_INIT_REENTRY。
     */
    assertCanOpen(id: string, owner: Lifetime): void {
        const record = this.records.get(id);
        invariant(
            !(record?.state === 'initializing' && record.scope.owns(owner)),
            'MODULE_INIT_REENTRY',
            `Factory cannot await its own UI: ${id}`,
        );
    }
    /**
     * @internal
     * 某 UI 清理超时时隔离其模块业务代，直到实例实际清理完成；期间不允许新的外部 use。
     */
    quarantine(id: string, untilDrained: Promise<void>): void {
        const record = this.records.get(id);
        if (!record) return;
        record.faultHolds++;
        record.cleanupPending = true;
        void untilDrained
            .then(() => {}, this.report)
            .finally(() => {
                record.faultHolds--;
                record.cleanupPending = record.faultHolds > 0 || record.stopTimedOut;
            });
    }
    /**
     * 取得已经 ready 的模块上下文，供集成层使用；不会增加模块持有或延长生命周期。
     * @param id - 已经初始化完成的模块 ID。
     * @returns 当前业务上下文。普通调用者优先 use 获取受保护 API。
     * @throws FrameworkError 模块未 ready，错误码 MODULE_NOT_READY。
     */
    context(id: string): ModuleContext {
        const record = this.records.get(id);
        invariant(record?.state === 'ready', 'MODULE_NOT_READY', id);
        return record.context;
    }
    /**
     * 取得有期限的模块 API，必要时准备代码、初始化依赖并执行工厂；并发调用共享初始化过程。
     * @param ref - 模块 public.ts 导出的 ModuleRef。
     * @param owner - API 使用期所有者，结束时自动归还。
     * @param requester - 内部依赖解析传入的请求模块 ID，普通业务通常省略。
     * @returns ModuleHandle，其 api 保留 ModuleRef 声明的类型。
     * @throws FrameworkError 模块未登记、工厂无效、初始化重入、上一代仍在异常清理或 App 正关停。
     * @throws OperationCancelled owner 取消；工厂异常原样传播。
     * @example
     * const handle = await app.modules.use(InventoryModule, flowScope);
     * const inventory = handle.api;
     * // flowScope 结束时自动归还，也可提前 await handle.release();
     */
    async use<Api>(ref: ModuleRef<Api>, owner: Lifetime, requester?: string): Promise<ModuleHandle<Api>> {
        owner.signal.throwIfAborted();
        invariant(this.accepting, 'APP_STOPPING', 'Modules are shutting down');
        const definition = this.definitions.get(ref.id);
        invariant(definition, 'MODULE_UNKNOWN', ref.id);
        invariant(
            !(requester === ref.id && this.records.get(ref.id)?.state === 'initializing'),
            'MODULE_INIT_REENTRY',
            `Factory cannot await itself: ${ref.id}`,
        );
        let record = this.records.get(ref.id);
        if (record?.cleanupPending)
            throw new FrameworkError(
                'MODULE_CLEANUP_PENDING',
                `Previous module generation is still draining: ${ref.id}`,
            );
        if (record?.state === 'stopping') {
            await untilCancelled(record.stop!, owner.signal);
            return this.use(ref, owner, requester);
        }
        if (!record) {
            const scope = new Scope(`module:${ref.id}`, this.report);
            record = {
                definition,
                scope,
                context: undefined as unknown as ModuleContext,
                demand: 0,
                state: 'initializing',
                codeReady: !!definition.factory,
                cleanupPending: false,
                faultHolds: 0,
                stopTimedOut: false,
                ready: Promise.resolve(undefined),
            };
            const current = record;
            current.context = Object.freeze({
                ...this.makeContext(ref.id, scope, (parent, label) => this.createSession(current, parent, label)),
                scope: scope.lifetime,
                services: <T>(servicesRef: ModuleServicesRef<T>): T => {
                    invariant(
                        servicesRef.moduleId === ref.id,
                        'MODULE_SERVICES_HOST',
                        'Use public module APIs for cross-module calls',
                    );
                    invariant(
                        this.records.get(ref.id) === current && current.state === 'ready' && !scope.signal.aborted,
                        'MODULE_NOT_READY',
                        `Services are unavailable: ${ref.id}`,
                    );
                    invariant(
                        current.services !== undefined,
                        'MODULE_SERVICES_MISSING',
                        `Module ${ref.id} did not return services`,
                    );
                    return current.services as T;
                },
            });
            this.records.set(ref.id, current);
            current.ready = Promise.resolve().then(async () => {
                const factory = await untilCancelled(this.factoryFor(definition.id), scope.signal);
                current.codeReady = true;
                scope.signal.throwIfAborted();
                const dependencies: Record<string, unknown> = {};
                for (const dependency of definition.dependencies)
                    dependencies[dependency] = (await this.use({ id: dependency }, scope, ref.id)).api;
                const pending = Promise.resolve().then(() => factory(current.context, Object.freeze(dependencies)));
                const result = await scope.track(pending);
                scope.signal.throwIfAborted();
                invariant(result && 'api' in result, 'MODULE_FACTORY_INVALID', `${ref.id} factory must return { api }`);
                current.api = result.api;
                current.services = result.services;
                current.state = 'ready';
                return result.api;
            });
            void current.ready
                .catch(() => {})
                .finally(() => {
                    if (current.demand === 0) void this.stopRecord(current).catch(this.report);
                });
        }
        const current = record;
        current.demand++;
        let released = false,
            delivered = false,
            unown = () => {};
        let releasing: Promise<void> | undefined;
        const release = (): Promise<void> => {
            if (released) return releasing ?? Promise.resolve();
            released = true;
            detach();
            unown();
            current.demand--;
            if (current.demand === 0) {
                if (current.state === 'initializing') current.scope.cancel();
                releasing = current.ready
                    .then(
                        () => {},
                        () => {},
                    )
                    .then(() => this.stopRecord(current));
            }
            return releasing ?? Promise.resolve();
        };
        const detach = owner.signal.onAbort(() => {
            if (!delivered) void release().catch(this.report);
        });
        unown = owner.defer(release);
        try {
            const api = (await untilCancelled(current.ready, owner.signal)) as Api;
            owner.signal.throwIfAborted();
            delivered = true;
            const check = () =>
                invariant(
                    !released && !owner.signal.aborted && !current.scope.signal.aborted && current.state === 'ready',
                    'MODULE_HANDLE_ENDED',
                    ref.id,
                );
            const guarded =
                api && typeof api === 'object'
                    ? (new Proxy(api as object, {
                          get(target, property) {
                              check();
                              const value = Reflect.get(target, property, target);
                              return typeof value === 'function'
                                  ? (...args: unknown[]) => {
                                        check();
                                        // 调用前登记屏障，保证方法同步部分触发关闭时也不会提前释放服务。
                                        // 只跟踪公开方法返回的工作；内部脱离返回链的任务仍须显式登记。
                                        let complete!: (value: unknown) => void;
                                        let fail!: (error: unknown) => void;
                                        const running = new Promise<unknown>((resolve, reject) => {
                                            complete = resolve;
                                            fail = reject;
                                        });
                                        void current.scope.track(running, `api:${String(property)}`);
                                        try {
                                            const result: unknown = Reflect.apply(value, target, args);
                                            complete(result);
                                            return result;
                                        } catch (error) {
                                            fail(error);
                                            throw error;
                                        }
                                    }
                                  : value;
                          },
                      }) as Api)
                    : api;
            return Object.freeze({
                get api() {
                    check();
                    return guarded;
                },
                get active() {
                    return (
                        !released && !owner.signal.aborted && !current.scope.signal.aborted && current.state === 'ready'
                    );
                },
                release,
            });
        } catch (error) {
            void release().catch(this.report);
            throw error;
        }
    }
    private createSession(record: ModuleRecord, owner: Lifetime, label: string): Scope {
        invariant(record.state === 'ready', 'MODULE_NOT_READY', 'Sessions require a published module API');
        invariant(
            !record.scope.owns(owner),
            'MODULE_SELF_HOLD',
            'Internal module work must not create an external session hold',
        );
        const session = owner.child(label);
        record.demand++;
        session.defer(async () => {
            if (--record.demand === 0) await this.stopRecord(record);
        });
        return session;
    }
    private stopRecord(record: ModuleRecord): Promise<void> {
        if (record.stop) return record.stop;
        record.state = 'stopping';
        const stopDeadline = foregroundDeadline(this.clock, this.cleanupTimeoutMs, () => {
            record.stopTimedOut = true;
            record.cleanupPending = true;
            this.report(
                new FrameworkError(
                    'MODULE_CLEANUP_PENDING',
                    `Module is retaining resources until tasks settle: ${record.definition.id}`,
                ),
            );
        });
        record.stop = Promise.resolve()
            .then(async () => {
                try {
                    await this.evictIdleViews(record.definition.id);
                } finally {
                    await record.scope.close();
                }
            })
            .finally(() => {
                stopDeadline();
                record.cleanupPending = false;
                if (this.records.get(record.definition.id) === record) this.records.delete(record.definition.id);
            });
        return record.stop;
    }
    /**
     * @internal
     * App 关停时按逆依赖顺序停止业务实例，最后归还入口预制体等代码持有。
     * @returns 各模块实际清理完成后结束；业务 UI/流程所有者应先关闭。
     * @throws FrameworkError 以 MODULE_SHUTDOWN_FAILED 汇总清理错误；不声称卸载 JS 类注册。
     */
    async close(): Promise<void> {
        this.accepting = false;
        // Callers must close their UI/flow owners first; dependencies drain via module scopes.
        const failures: unknown[] = [];
        for (const id of [...this.dependencyOrder].reverse()) {
            const record = this.records.get(id);
            if (!record) continue;
            try {
                record.scope.cancel();
                await record.ready.catch(() => {});
                await this.stopRecord(record);
            } catch (error) {
                failures.push(error);
            }
        }
        try {
            await this.codeScope.close();
        } catch (error) {
            failures.push(error);
        }
        if (failures.length)
            throw new FrameworkError('MODULE_SHUTDOWN_FAILED', 'Some module cleanups failed', { failures });
    }
}
