import type { Node } from 'cc';
import type { Lifetime } from '../../assets/framework/core/scope';
import type { BadgeStore } from '../../assets/framework/badges';
import type { HttpClient } from '../../assets/framework/network';
import type { GuideTargets, GuideRunner } from '../../assets/framework/guide';
import type { GuideFocusOverlay } from '../../assets/framework/ui/components/guide/guide-focus-overlay';

declare const owner: Lifetime;
declare const badges: BadgeStore;
declare const http: HttpClient;
declare const targets: GuideTargets<Node>;
declare const runner: GuideRunner;
declare const focus: GuideFocusOverlay;
async function contracts(): Promise<void> {
    const source = badges.source({ id: 'test' }, owner);
    source.set(1);
    // @ts-expect-error 不能把字符串当作数量。
    source.set('1');
    // @ts-expect-error 来源不能省略生命周期。
    badges.source({ id: 'missing-owner' });
    const data = await http.json({ url: 'https://example.test' }, owner, (value) => {
        // @ts-expect-error 外部 JSON 必须先验证，不能直接读取字段。
        return value.name;
    });
    void data;
    // @ts-expect-error 请求必须归属于生命周期。
    void http.request({ url: 'https://example.test' });
    const target = await targets.wait('button', owner);
    // @ts-expect-error 消费者不能关闭目标的注册期限。
    void target.scope.close();
    const session = focus.begin(owner);
    // @ts-expect-error 不支持任意字符串形状。
    void session.waitForClick(target, { message: '提示', shape: 'triangle' }, owner);
    runner.start(
        {
            id: 'intro',
            version: 1,
            steps: [
                {
                    id: 'a',
                    run: (task) => {
                        // @ts-expect-error 步骤只能借用自己的生命周期。
                        void task.scope.close();
                    },
                },
            ],
        },
        owner,
    );
    session.close();
}
void contracts;
