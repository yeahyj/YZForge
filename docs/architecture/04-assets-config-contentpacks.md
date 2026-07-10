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
  构建身份、owner、bundle、Library dependencies

manifest.generated.json
  运行时 identity、refs path、config table、codec、contentHash

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

运行时校验覆盖 schemaVersion、id、owner、name、bundle、dependencies、content hash，以及 manifest 与 TypeScript contract 的 key/kind/type/primary key。任一不一致都拒绝加载并回滚 record scope。

## ContentPack 边界

- 只能由 owner Module 加载。
- 可以提供内容 prefab、数据、音频和配置。
- 不能提供 Page、Popup 等由 UI 系统直接打开的 View。
- 每次 load 返回独立 `ContentPackLease`；同一 Module 内可共享 record。
