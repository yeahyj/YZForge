import type {
    AudioClip,
    Font,
    ImageAsset,
    JsonAsset,
    Material,
    Prefab,
    SceneAsset,
    SpriteAtlas,
    SpriteFrame,
    TextAsset,
    Texture2D,
} from 'cc';
/**
 * 资源种类与 Cocos 资源类的类型映射，决定 load 返回哪一种资源。
 * 通常使用生成的 AssetKey，让 TypeScript 自动推导结果类型。
 */
export interface AssetTypes {
    /**
     * 预制体资源；加载只得到 Prefab，创建节点请使用 assets.instantiate。
     */
    Prefab: Prefab;
    /**
     * 图片精灵帧，可赋给 Sprite.spriteFrame；与 Texture2D、ImageAsset 是不同种类。
     */
    SpriteFrame: SpriteFrame;
    /**
     * GPU 纹理资源，用于材质或需要纹理的引擎接口。
     */
    Texture2D: Texture2D;
    /**
     * 图片源数据资源；普通 UI 图片通常使用 SpriteFrame。
     */
    ImageAsset: ImageAsset;
    /**
     * 音频片段；播放及其生命周期交给 audio 管理器。
     */
    AudioClip: AudioClip;
    /**
     * JSON 资源；配置表请优先通过 config.load 获得校验、索引及只读查询能力。
     */
    JsonAsset: JsonAsset;
    /**
     * 纯文本资源，正文通过返回资源的 text 属性读取。
     */
    TextAsset: TextAsset;
    /**
     * 材质资源；不要修改共享材质来保存某个实例的独立状态。
     */
    Material: Material;
    /**
     * 精灵图集；图集中单帧也可以生成独立的 SpriteFrame 逻辑键。
     */
    SpriteAtlas: SpriteAtlas;
    /**
     * 字体资源。
     */
    Font: Font;
    /**
     * 场景资源；加载资源本身不会切换场景。
     */
    SceneAsset: SceneAsset;
}
/**
 * 框架支持的资源种类字符串，例如 SpriteFrame、Prefab、AudioClip；大小写必须与 AssetTypes 一致。
 */
export type AssetKind = keyof AssetTypes;
/**
 * 资源的公开类型合同：稳定的逻辑 ID 加资源种类，不包含资源对象，也不会在 import 时下载资源。
 * 优先使用自动扫描 dynamic 目录生成的常量，避免手写名称和同名歧义。
 * @typeParam K - 资源种类，决定加载结果的 Cocos 类型。
 */
export interface AssetKey<K extends AssetKind = AssetKind> {
    /**
     * 完整逻辑 ID：模块/资源包/种类/相对路径，例如 lobby/default/sprite/icons/coin。
     * 这是清单中的逻辑名称，不是 db:// 地址或磁盘路径。
     */
    readonly id: string;
    /**
     * 资源的 Cocos 种类，例如 SpriteFrame；与 ID 中的种类段必须匹配。
     */
    readonly type: K;
}
/**
 * 逻辑键解析后的资源地址。一般由清单生成并由 assets.resolve 获取，业务优先保存 AssetKey。
 */
export interface AssetAddress<K extends AssetKind = AssetKind> {
    /**
     * 发布清单中登记的 Bundle ID。
     */
    readonly bundle: string;
    /**
     * Bundle 内的引擎加载路径，通常不带扩展名；子资源可能包含 spriteFrame 等后缀。
     */
    readonly path: string;
    /**
     * 实际要加载的 Cocos 资源种类。
     */
    readonly type: K;
    /**
     * 可选发布版本标识；resolve 填入当前 releaseId，用于描述地址所属版本。
     * 不会据此在当前 JS 运行时切换发布版本。
     */
    readonly revision?: string;
    /**
     * 加载图集中的某一帧时填写帧名；此时 path 指向 SpriteAtlas，type 必须是 SpriteFrame。
     */
    readonly atlasFrame?: string;
    /**
     * 兼容旧清单的单一代码模块 ID；新版依赖列表使用 requiredCodeModules。
     * 也作为直接实例化时未指定 moduleId 的旧宿主回退值。
     */
    readonly codeModule?: string;
    /**
     * 反序列化前必须注册的脚本模块 ID 列表，由生成器计算。
     * 只准备代码，不自动执行这些模块的业务工厂。
     */
    readonly requiredCodeModules?: readonly string[];
}
/**
 * 一个代码包或资源包的发布描述；Bundle 注册、实际资源下载与模块业务初始化是不同步骤。
 */
export interface BundleDefinition {
    /**
     * Bundle 的唯一 ID，必须与发布清单中的登记及引擎构建名称一致。
     */
    readonly id: string;
    /**
     * 可选加载位置，可为引擎支持的 Bundle 名称或地址；省略时按 id 加载。
     * 代码包的远程脚本限制由模块加载器另外检查。
     */
    readonly location?: string;
    /**
     * 可选构建版本，原样传给引擎 loadBundle 的 version 选项。
     */
    readonly version?: string;
    /**
     * 需要先准备的 Bundle ID；不允许缺失依赖或循环依赖，省略表示无依赖。
     */
    readonly dependencies?: readonly string[];
    /**
     * 资源逻辑命名空间，例如 lobby/default；openBundle 返回的 assets 据此解析相对名称。
     */
    readonly namespace?: string;
}
/**
 * 动态资源索引的 JSON 合同；由生成器扫描 dynamic 生成，不要求开发者逐项登记。
 * static 中被预制体等静态引用的资源不需要加入这个索引。
 */
export interface NamespaceIndex {
    /**
     * 索引格式版本：1 使用单层资源名，2 支持多层相对路径及代码依赖信息。
     */
    readonly formatVersion: 1 | 2;
    /**
     * 该索引所属的“模块/资源包”，例如 lobby/default。
     */
    readonly namespace: string;
    /**
     * 完整逻辑 ID 到实际资源地址的映射；相同文件名可以用不同相对路径区分。
     */
    readonly assets: Readonly<Record<string, AssetAddress>>;
    /**
     * 可选别名映射：别名完整 ID → 当前索引的目标完整 ID。
     * 别名不能覆盖现有 ID，也不能再次指向别名。
     */
    readonly aliases?: Readonly<Record<string, string>>;
}
/**
 * 一份配置表 JSON 数据在某个资源包中的路由。
 */
export interface TableRoute {
    /**
     * 承载这份配置数据的 Bundle ID。
     */
    readonly bundle: string;
    /**
     * Bundle 内配置 JSON 的加载路径。
     */
    readonly path: string;
    /**
     * 该数据文件的版本标识；运行时与 JSON 头部核对，防止合同和数据混用。
     */
    readonly dataRevision: string;
}
/**
 * 一次内容发布的总路由表：登记 Bundle、动态资源索引及配置表数据。
 * 当前运行时只选择一个 releaseId；切换发布版本需要重启 JS 运行时和引擎资源缓存。
 */
export interface ContentRelease {
    /**
     * 项目指定的发布版本 ID，来自发布设置；同一运行会话固定使用该值。
     */
    readonly releaseId: string;
    /**
     * 按 Bundle ID 索引的代码包、资源包描述。
     */
    readonly bundles: Readonly<Record<string, BundleDefinition>>;
    /**
     * 按“模块/资源包”索引动态清单位置；每项 bundle 为承载包，path 为其内的 JSON 加载路径。
     */
    readonly namespaces: Readonly<Record<string, { readonly bundle: string; readonly path: string }>>;
    /**
     * 配置表 ID → 数据路由数组；同表分布到多个包时，加载必须明确选择 bundle。
     */
    readonly tables: Readonly<Record<string, readonly TableRoute[]>>;
}
/**
 * Bundle 引用：可以传 ID 字符串，也可以传生成的含 id 的常量对象。
 */
export type BundleRef =
    | string
    | {
          /**
           * 发布清单中登记的 Bundle ID；与字符串形式含义相同。
           */
          readonly id: string;
      };
/**
 * 从字符串或生成的 Bundle 引用中取出 ID；不检查包是否存在，也不触发加载。
 * @param ref - Bundle ID 或含 id 的对象。
 * @returns Bundle ID 字符串。
 */
export const bundleId = (ref: BundleRef): string => (typeof ref === 'string' ? ref : ref.id);
