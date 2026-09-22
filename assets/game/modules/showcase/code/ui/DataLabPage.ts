import { _decorator, Button } from 'cc';
import type { PlaybackHandle } from '../../../../../framework/audio/audio-manager';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import type { LabParams } from '../../contracts/demo-navigation';
import { ShowcaseRes } from '../../contracts/generated/resources-default';
import { ShowcaseBundles } from '../../contracts/generated/bundles';
import { SamplesTable } from '../../contracts/generated/config/Samples.table';
import { Quality } from '../../contracts/generated/enums/Quality';
import { TasksTable } from '../../../workshop/contracts/generated/config/Tasks.table';
import { EconomyTable } from '../../../common/contracts/generated/config/Economy.table';
import { DataLabPageBinding } from './generated/DataLabPageBinding';
const { ccclass } = _decorator;
/** 静态引用、动态索引、配置路由、跨模块合同与音频的可操作示例。 */
@ccclass('showcase.DataLabPage')
export class DataLabPage extends DataLabPageBinding {
    protected onShow(show: ViewShowContext<LabParams, void>): void {
        let audio: PlaybackHandle | undefined;
        let audioState = 0;
        const previousVolume = this.ctx.audio.getVolume('sfx');
        show.scope.defer(() => this.ctx.audio.setVolume('sfx', previousVolume));
        const output = (text: string) =>
            show.commit(() => {
                this.lblOutput.string = text;
            });
        const bind = (button: Button, work: () => void | Promise<void>) =>
            show.listen(button.node, Button.EventType.CLICK, work, (error) => output(String(error)));
        bind(this.btnBack, () => show.back());
        bind(this.btnResource, async () => {
            const address = await show.assets.resolve(ShowcaseRes.sprite.iconsAlphaToken);
            await show.setSprite(this.sprPreview, ShowcaseRes.sprite.iconsAlphaToken);
            output(
                `类型化 Key → ${address.bundle}\n${address.path}\n也可用相对名 icons/alpha/token。\nstatic 通过预制体直接引用，dynamic 自动编目。`,
            );
        });
        bind(this.btnAmbiguous, async () => {
            try {
                await show.assets.resolve('token', 'SpriteFrame');
                output('异常：同名资源未被拒绝。');
            } catch (error) {
                output(`预期歧义：${String(error)}\n请使用完整 Key 或 icons/alpha/token。`);
            }
        });
        bind(this.btnDefault, async () => {
            const table = await show.config.load(SamplesTable, { bundle: ShowcaseBundles.default });
            const row = table.require(101);
            await show.setSprite(this.sprPreview, row.icon);
            output(
                `默认分片 ${table.size} 行 · ${row.name}\n枚举 ${row.quality} · 开关 ${row.enabled} · 权重 ${row.weight}\n标签 ${row.tags.join('/')} · 坐标 ${row.position.x},${row.position.y}\n普通品质索引命中 ${table.by('quality', Quality.Normal).length} 行`,
            );
        });
        bind(this.btnExtra, async () => {
            const bundle = await show.assets.openBundle(ShowcaseBundles.extra);
            const table = await bundle.tables.load(SamplesTable);
            const row = table.require(201);
            await show.setSprite(this.sprPreview, row.icon);
            output(
                `扩展分片 ${table.size} 行 · ${row.name}\n准备包 ≠ 加载包内所有资源\n表的资源引用通过独立 Key 按需加载\n可空字段：${row.note ?? '空'}`,
            );
        });
        bind(this.btnPublic, async () => {
            const table = await show.config.load(EconomyTable);
            output(
                `公共表 ${table.id} · ${table.size} 行\n公共奖励 ${table.require(1).amount}\n公开 TS 合同 import 不加载 JSON\n读取配置不需要创建 common 业务服务。`,
            );
        });
        bind(this.btnMany, async () => {
            const tables = await show.config.loadMany({ tasks: TasksTable, economy: EconomyTable });
            const state = show.params.navigation.inspect();
            output(
                `跨模块批量加载：任务 ${tables.tasks.size} · 公共 ${tables.economy.size}\n外键任务 1 → 公共表 ${tables.tasks.require(1).economy}\n任务代码 ${state.workshopCodeReady} · 业务 ${state.workshopBusinessReady}\n两张表的资源持有都随本页结束。`,
            );
        });
        bind(this.btnAudio, async () => {
            await show.actions.exclusive('audio', async () => {
                show.audio.resumeFromGesture();
                if (!audio?.active) {
                    audio = await show.audio.play(ShowcaseRes.audio.audioChime, { loop: true, channel: 'sfx' });
                    audioState = 1;
                } else if (audioState === 1) {
                    audio.pause();
                    audioState = 2;
                } else if (audioState === 2) {
                    audio.resume();
                    audioState = 3;
                } else {
                    await audio.stop();
                    audioState = 0;
                }
                output(
                    `音频：${['停止', '播放', '暂停', '继续播放'][audioState]}\n连续点击：播放 → 暂停 → 继续 → 停止\n页面结束会自动停止并释放音频。`,
                );
            });
        });
        bind(this.btnVolume, () => {
            const next = this.ctx.audio.getVolume('sfx') > 0.5 ? 0.25 : 1;
            this.ctx.audio.setVolume('sfx', next);
            output(`sfx 音量：${Math.round(next * 100)}%\n这里只调节音效通道，退出实验恢复原值。`);
        });
        output(
            '右侧图片最初来自 static 序列化引用。\n动态按钮改用自动生成的 AssetKey。\n两份 token 同名：短名失败、完整 Key 明确。\nXLSX 覆盖枚举、数组、向量、颜色、外键和分片。',
        );
    }
}
