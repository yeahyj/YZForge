import { _decorator, Button } from 'cc';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import { OperationCancelled } from '../../../../../framework/core/errors';
import { runTask } from '../../../../../framework/core/scope';
import { BootFlow } from '../../../../../framework/core/boot';
import { EconomyTable } from '../../../common/contracts/generated/config/Economy.table';
import { ShowcaseServices } from '../ShowcaseServices';
import { AsyncLabPageBinding } from './generated/AsyncLabPageBinding';
const { ccclass } = _decorator;
// 仅用于模拟不支持取消的底层 I/O；这不是框架的时间调度 API。
const request = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** 用真实 Actions、Scope、BootFlow 和配置批量加载演示可控失败。 */
@ccclass('showcase.AsyncLabPage')
export class AsyncLabPage extends AsyncLabPageBinding {
    protected onShow(show: ViewShowContext<void, void>): void {
        let attempts = 0;
        const output = (text: string) =>
            show.commit(() => {
                this.lblOutput.string = text;
            });
        const bind = (button: Button, work: () => void | Promise<void>) =>
            show.listen(button.node, Button.EventType.CLICK, work, (error) =>
                output(`失败已接住，可重试：${String(error)}`),
            );
        bind(this.btnBack, () => show.ui.back());
        bind(this.btnLatest, async () => {
            await show.actions.exclusive('latest-demo', async () => {
                const accepted: string[] = [];
                const old = show.actions
                    .latest('search', async (task) => {
                        await request(250);
                        task.commit(() => {
                            accepted.push('旧结果');
                        });
                    })
                    .catch((error: unknown) => {
                        if (!(error instanceof OperationCancelled)) throw error;
                    });
                await Promise.resolve(); // 让旧底层请求确实开始，再触发替换。
                const fresh = show.actions.latest('search', async (task) => {
                    await request(30);
                    task.commit(() => {
                        accepted.push('新结果');
                    });
                });
                await Promise.all([old, fresh]);
                await request(280);
                output(`latest 接受：${accepted.join(', ')}\n旧请求先开始、后完成，旧 commit 被拦截。`);
            });
        });
        bind(this.btnExclusive, async () => {
            let executed = 0;
            await Promise.all(
                [1, 2, 3].map(() =>
                    show.actions.exclusive('submit', async () => {
                        executed++;
                        await request(120);
                    }),
                ),
            );
            output(`exclusive：连续提交 3 次，执行 ${executed} 次\n重复调用返回 undefined，不重复执行业务。`);
        });
        bind(this.btnSerial, async () => {
            const order: number[] = [];
            await Promise.all(
                [1, 2, 3].map((id) =>
                    show.actions.serial('queue', async () => {
                        await request(50);
                        order.push(id);
                    }),
                ),
            );
            output(`serial：${order.join(' → ')}\n队列顺序执行；单项失败不会卡住后续项目。`);
        });
        bind(this.btnRetry, async () => {
            await show.actions.exclusive('retry', async () => {
                await request(100);
                if (++attempts === 1) throw Error('第一次模拟请求失败');
                output(`第 ${attempts} 次尝试成功\n失败释放命名操作，再点击即可重试。`);
            });
        });
        bind(this.btnCancel, async () => {
            const owner = show.scope.child('cancel-demo');
            let accepted = false;
            let finished = false;
            const work = runTask(owner, async (task) => {
                await request(120);
                accepted = task.commit(() => {});
                finished = true;
            }).catch((error: unknown) => {
                if (!(error instanceof OperationCancelled)) throw error;
            });
            await Promise.resolve(); // 验证正在执行的工作，而非尚未开始的队列项。
            owner.cancel();
            await owner.close();
            await work;
            output(`取消后实际工作结束：${finished}\n旧提交接受：${accepted}\nclose 等待真实退出，再完成资源回收。`);
        });
        bind(this.btnBatch, async () => {
            const before = this.ctx.diagnostics.snapshot().configCount;
            try {
                await show.config.loadMany({
                    valid: EconomyTable,
                    missing: { ...EconomyTable, id: 'showcase.missing-table' },
                });
            } catch (error) {
                const after = this.ctx.diagnostics.snapshot();
                output(
                    `预期批量失败：${String(error)}\n持有表条目：${before} → ${after.configCount}\n无持有的底层收尾：${after.configDrainingCount} 条\n共享 I/O 完成后回收，不把逻辑取消当成物理中断。`,
                );
            }
        });
        bind(this.btnBoot, async () => {
            const owner = show.scope.child('boot-demo');
            const boot = new BootFlow(owner);
            let cleaned = 0;
            try {
                try {
                    await boot.start((task) => {
                        task.scope.defer(() => {
                            cleaned++;
                        });
                        throw Error('模拟启动失败');
                    });
                } catch {
                    /* 预期失败；下一次必须在清理后开始。 */
                }
                await boot.start(() => {});
                output(
                    `启动尝试 ${boot.inspect().attempts} 次 · ${boot.inspect().state}\n失败尝试清理 ${cleaned} 次，第二次成功。\n这是一份独立启动流，不重启当前应用。`,
                );
            } finally {
                await owner.close();
            }
        });
        bind(this.btnLeave, async () => {
            const service = this.ctx.services(ShowcaseServices).showcase;
            const physical = request(250);
            show.ui.back(); // 发出返回请求，不能等待自己关闭。
            await physical;
            if (
                !show.commit(() => {
                    this.lblOutput.string = '不应发生的旧页面回写';
                })
            )
                service.rejectStaleCommit();
        });
        output(
            '模拟 I/O 延迟，实际使用框架取消与清理机制。\n可试最新结果、防重复、顺序执行与重试。\n最后一个按钮返回上页，首页显示过期提交计数。',
        );
    }
}
