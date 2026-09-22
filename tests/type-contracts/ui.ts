import type { Lifetime } from '../../assets/framework/core/scope';
import type { ViewShowContext } from '../../assets/framework/ui/ui-view';
import type { PageKey, LocalViewKey } from '../../assets/framework/ui/ui-manager';

declare const show: ViewShowContext<void, void>;
declare const page: PageKey<{ id: number }>;
declare const popup: LocalViewKey<{ title: string }, boolean>;
declare const owner: Lifetime;

async function uiContracts() {
    const result = await show.ui.pushPage(page, { id: 1 });
    if (result.status === 'ignored') {
        const reason: 'busy' = result.reason;
        void reason;
    }
    // @ts-expect-error 页面内导航不提供在旧 show 中等待下一页关闭的句柄。
    void result.result;
    const handle = await show.ui.open(popup, { title: '确认' }, { owner });
    const answer = await handle.result;
    if (answer.status === 'completed') {
        const confirmed: boolean = answer.value;
        void confirmed;
    }
    // @ts-expect-error 弹窗不能压入页面栈。
    await show.ui.pushPage(popup, { title: '错误' });
    // @ts-expect-error 页面必须通过导航打开。
    await show.ui.open(page, { id: 1 });
    // @ts-expect-error 参数保持页面定义的类型。
    await show.ui.pushPage(page, { id: '1' });
    const returned: void = show.ui.back();
    void returned;
}
void uiContracts;
