import { _decorator, Button } from 'cc';
import { NetworkLabPageBinding } from './generated/NetworkLabPageBinding';
import type { ViewShowContext } from '../../../../../framework/ui/ui-view';
import { HttpClient } from '../../../../../framework/network/http-client';
import { DemoHttpTransport } from '../services/DemoHttpTransport';
const { ccclass } = _decorator;
/** 网络示例：模拟与真实请求明确区分，取消和最新查询复用现有 Actions / Scope。 */
@ccclass('showcase.NetworkLabPage')
export class NetworkLabPage extends NetworkLabPageBinding {
    protected onShow(show: ViewShowContext<void, void>): void {
        const simulated = new HttpClient({ baseUrl: 'https://demo.invalid', transport: new DemoHttpTransport() });
        const bind = (button: Button, callback: () => void | Promise<void>) =>
            show.listen(button.node, Button.EventType.CLICK, callback);
        const request = async (kind: 'success' | 'failure' | 'slow' | 'real') => {
            await show.actions.latest('http', async (task) => {
                task.commit(() => {
                    this.lblOutput.string = kind === 'real' ? '真实 HTTP GET 请求中…' : `本地模拟 ${kind} 请求中…`;
                });
                try {
                    const data = await (kind === 'real' ? this.ctx.http : simulated).json(
                        {
                            url: kind === 'real' ? this.editUrl.string.trim() : `/${kind}`,
                            timeoutMs: kind === 'slow' ? 180 : 10000,
                        },
                        task.scope,
                        (value) => {
                            if (
                                !value ||
                                typeof value !== 'object' ||
                                typeof (value as { message?: unknown }).message !== 'string'
                            )
                                throw Error('响应需要 message 字符串');
                            return value as { message: string };
                        },
                    );
                    task.commit(() => {
                        this.lblOutput.string = `${kind === 'real' ? '真实 HTTP' : '本地模拟'} 成功\n${data.message}\n请求已结束，Scope 已归还。`;
                    });
                } catch (error) {
                    task.commit(() => {
                        this.lblOutput.string = String(error);
                    });
                }
            });
        };
        bind(this.btnBack, () => show.ui.back());
        bind(this.btnSuccess, () => request('success'));
        bind(this.btnFailure, () => request('failure'));
        bind(this.btnTimeout, () => request('slow'));
        bind(this.btnReal, () => request('real'));
        bind(this.btnCancel, async () => {
            await show.actions.latest('http', (task) => {
                task.commit(() => {
                    this.lblOutput.string = '已取消当前请求，旧响应不能回写。';
                });
            });
        });
        this.lblOutput.string =
            '默认不自动重试。\n连续点击会取消旧查询，只接受最新一次结果。\n真实 GET 示例要求 JSON 中包含 message 字符串。';
    }
}
