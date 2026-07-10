# 07. V2 API 示例

## 启动 App

```ts
import { createApp } from 'yzforge';
import { StartRef } from 'yzforge/modules/Start';

const app = createApp();
await app.start({ mainRoot: this.node });
const start = await app.enterModule(StartRef, { from: 'boot' });
```

`app.viewport` 和 `app.lifecycle` 只能读取、订阅：

```ts
const disposeViewport = app.viewport.onChanged((profile) => {
    console.log(profile.safeInsets);
});
const disposeBackground = app.lifecycle.on('hide', () => saveDraft());
```

## Module

```ts
import { Module } from 'yzforge';
import { assets } from './generated/assets';
import { BattleLevel001ContentPack } from './generated/content-packs';

export class Battle extends Module<BattleEnterParams, BattleConfigTables> {
    protected async onLoad(): Promise<void> {
        await this.assets.preload(assets.views.pageBattle);
    }

    protected async onEnter(params: BattleEnterParams): Promise<void> {
        await this.ui.open(assets.views.pageBattle, params);
    }

    protected async onUnload(): Promise<void> {
        // owner scope 会继续释放未手工释放的 UI、Part、ContentPack 和资源。
    }

    public async loadLevel(): Promise<void> {
        const pack = await this.contentPacks.load(BattleLevel001ContentPack);
        const root = await pack.assets.instantiate(pack.refs.levelRoot);
        console.log(root, pack.config.enemyWave.get('wave-1'));
    }
}
```

## 独立 Module Lease

```ts
const a = await app.loadModule(BattleRef);
const b = await app.loadModule(BattleRef);

console.assert(a !== b);
console.assert(a.instance === b.instance);

await a.release(); // b 仍持有 record
await b.release(); // 最后一个 lease，自动卸载
```

需要无条件终止当前 Module 时使用 `app.unloadModule(BattleRef)`；这会使现有 Lease 全部进入 released。

## View

```ts
import { View } from 'yzforge';

export class ConfirmPopup extends View<ConfirmData, boolean> {
    protected onBindRefs(): void {
        // AutoRefs 生成基类在这里绑定 marker。
    }

    protected onOpen(data: ConfirmData): void {
        this.title.string = data.title;
        this.listen(this.confirm.node, 'click', () => void this.close(true));
        this.listen(this.cancel.node, 'click', () => void this.cancel('user_cancel'));
    }

    protected async onDispose(): Promise<void> {
        await flushViewMetrics();
    }
}
```

业务看不到 View runtime control method。打开失败时框架仍会执行已成立的 close/disposer/onDispose，并解析等待中的 result 为 cancel。

## Part

```ts
import { Part } from 'yzforge';

export class RewardPart extends Part<RewardData> {
    protected onInit(data: RewardData): void {
        this.amount.string = String(data.amount);
    }

    protected onDispose(reason?: unknown): void {
        console.log('reward part disposed', reason);
    }
}

const reward = await this.assets.createPart(assets.parts.reward, { amount: 10 });
reward.instance.play();
await reward.release();
```

## Library token

```ts
const battleCore = await this.libraries.load(BattleCoreRef);
const service = battleCore.use(BattleCoreTokens.rules);
await battleCore.release();
```

每次 Library load 返回独立 `LibraryLease`。长期持有时保存 Lease，并在所属业务生命周期结束时释放；Module scope 会兜底。

## 生成代码边界

以下 API 只允许 generated 文件导入：

```ts
import {
    defineModuleRef,
    defineContentPack,
    contentPackAssetContract,
    registerModuleEntry,
} from 'yzforge/authoring';
```

业务代码导入 `yzforge/authoring` 会被 strict Validator 拒绝。
