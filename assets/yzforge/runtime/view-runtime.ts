import type { MaybePromise } from './types';

export type ViewRuntimeOperation = 'bind' | 'before-open' | 'open' | 'before-close' | 'close' | 'wait-result';

export const viewRuntimeOperation = Symbol('yzforge.view.runtime-operation');

export interface ViewRuntimeView {
    [viewRuntimeOperation](operation: ViewRuntimeOperation, value?: unknown, secondary?: unknown): MaybePromise<unknown>;
}

export class ViewRuntime {
    public async bind(view: ViewRuntimeView, module: unknown, handle: unknown): Promise<void> {
        await view[viewRuntimeOperation]('bind', module, handle);
    }

    public async beforeOpen<TData>(view: ViewRuntimeView, data: TData | undefined): Promise<void> {
        await view[viewRuntimeOperation]('before-open', data);
    }

    public async open<TData>(view: ViewRuntimeView, data: TData | undefined): Promise<void> {
        await view[viewRuntimeOperation]('open', data);
    }

    public async beforeClose(view: ViewRuntimeView, reason: unknown): Promise<boolean | void> {
        return await view[viewRuntimeOperation]('before-close', reason) as boolean | void;
    }

    public async close(view: ViewRuntimeView, result: unknown): Promise<void> {
        await view[viewRuntimeOperation]('close', result);
    }

    public async waitResult<TResult>(view: ViewRuntimeView): Promise<TResult> {
        return await view[viewRuntimeOperation]('wait-result') as TResult;
    }
}
