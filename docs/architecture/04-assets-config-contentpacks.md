# 04. 资源、配置与 ContentPack

## 资源必须经过 owner scope

业务不手写 `resources.load`、`bundle.load` 或跨 Scope 路径。生成器扫描 `res/**` 并产生 typed ref：

```ts
const texture = await this.assets.load(assets.textures.avatar);
const node = await this.assets.instantiate(assets.prefabs.enemy);
```

`AssetScope` 记录 asset ref count 和实例化 Node。Scope 释放时，它会继续尝试销毁全部 Node、释放全部 asset，并聚合失败。

Part 使用显式 Lease：

```ts
const part = await this.assets.createPart(assets.parts.reward, { amount: 10 });
part.instance.show();
await part.release();
```

Part 的 refs 绑定、初始化、dispose、Node 和 prefab asset 属于同一个补偿事务。调用方不释放时，Module owner scope 会自动释放。

## Bundle 与 asset 分层

```text
Owner Scope
  -> Asset / Node / Part leases
  -> BundleLease

BundleRecord
  -> physical bundle / loading task / cache state
```

先按 asset ownership 释放具体引用，再按 cache policy 决定是否 `removeBundle`。禁止用 `bundle.releaseAll()` 代替这个模型。

## 配置表

配置事实源只有：

- `config-source/excel/*.xlsx`
- `config-source/export-plan.json`

主键只来自 Excel header rule `pk`。字段叫 `id` 并不会自动成为主键。

```bash
npm run yzforge:config:build
npm run yzforge:config:check
```

生成的 JSON 和 `code/generated/config.ts` 都不能手改。业务通过生成的 table ref、row interface 和 key 常量访问。

## ContentPack 三层事实源

```text
content-pack.json
  构建身份、owner、bundle、Library dependencies、可选 presentationRequests

manifest.generated.json
  运行时 identity、refs path、config table、codec、presentationRequests、contentHash

generated content-packs.ts
  key/kind/type/primary-key contract，不保存运行时路径
```

生成的 TypeScript 示例：

```ts
const BattleLevel001ContentPackContract = {
    levelRoot: contentPackAssetContract(Prefab),
    enemyWave: contentPackConfigContract<EnemyWaveRow>({ primaryKey: 'id' }),
};

export const BattleLevel001ContentPack = defineContentPack({
    abi: YZFORGE_RUNTIME_ABI,
    id: 'battle.level001',
    owner: 'Battle',
    name: 'Level001',
    bundle: 'yzforge-content-pack-battle-level001',
    libraries: [],
    presentationRequests: [
        { key: 'levelRoot', capability: 'battle.level-root', version: 1, prefab: 'levelRoot' },
    ],
    contract: BattleLevel001ContentPackContract,
});
```

加载后，实际 ref path 只从 bundle 内的 manifest materialize：

```ts
const pack = await this.contentPacks.load(BattleLevel001ContentPack);
const prefab = await pack.assets.load(pack.refs.levelRoot);
const wave = pack.config.enemyWave.get('wave-1');
await pack.release();
```

运行时校验覆盖 schemaVersion、id、owner、name、bundle、dependencies、presentationRequests、content hash，以及 manifest 与 TypeScript contract 的 key/kind/type/primary key。任一不一致都拒绝加载并回滚 record scope。

## ContentPack 的租约资源边界

一个 ContentPack record 只共享 manifest、配置和 Bundle；每次 `load()` 都创建独立的运行时资源 Scope：

```text
ContentPack record
  ├─ metadataAssets（manifest / config）
  └─ ContentPackLease A ─ leaseAssets / Node / PartLease
  └─ ContentPackLease B ─ leaseAssets / Node / PartLease
```

因此释放 A 不会销毁 B 的实例；最后一个 lease 释放后，才释放共享的 metadata 和 Bundle。`snapshot()` 同时报告 metadataAssets 与每个活跃 lease 的资源快照。

ContentPack prefab 可以挂 owner Module、Shared 或声明的 Library 中已经编译的脚本，但 ContentPack 目录本身不能放 TypeScript。需要把内容 prefab 当作 Part 时，调用方显式提供那个已加载的组件类：

```ts
const pack = await this.contentPacks.load(BattleLevel001ContentPack);
const part = await pack.assets.createPart(pack.refs.levelRoot, BattleLevelRootPart, { waveId: 'wave-1' });
await part.release();
await pack.release();
```

这样 prefab 与脚本不是物理上强制分离，而是职责分离：内容包选择 prefab 和数据；Module / Library 提供可审查、可编译、可测试的行为。

## 受约束的表现能力

当某个内容 prefab 需要 owner Module 的特殊表现行为时，内容包只能声明需求，不能提供脚本路径、类名或反射入口：

```json
{
  "presentationRequests": [
    {
      "key": "levelRoot",
      "capability": "battle.level-root",
      "version": 1,
      "prefab": "levelRoot"
    }
  ]
}
```

owner Module 在 `onCreate` 注册精确版本；加载内容包时，缺少能力或版本不同都会拒绝加载并回滚：

```ts
protected onCreate(): void {
    this.contentPacks.registerPresentationCapability({
        id: 'battle.level-root',
        version: 1,
    });
}
```

这不是动态插件执行机制。它只让内容数据声明“我需要哪一种已编译的行为”，实际脚本仍由 owner Module 或声明的 Library 持有。首版采用精确版本匹配；不能用 `>=` 静默替代不兼容的 UI/交互语义。

## ContentPack 边界

- 只能由 owner Module 加载。
- 可以提供内容 prefab、数据、音频和配置。
- 不能提供 Page、Popup 等由 UI 系统直接打开的 View。
- ContentPack 自己不能提供 TypeScript；prefab 脚本只能来自 owner Module、Shared 或声明的 Library。
- 每次 load 返回独立 `ContentPackLease`，其 Node、asset 和 Part 都随该 lease 释放；同一 Module 内只共享 record metadata。
