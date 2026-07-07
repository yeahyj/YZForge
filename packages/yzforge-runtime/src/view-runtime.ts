import type { MaybePromise } from './types';

export interface ViewRuntimeView<TData = unknown, TResult = unknown> {
    __yzforgeBeforeOpen(data: TData | undefined): MaybePromise<void>;
    __yzforgeOpen(data: TData | undefined): MaybePromise<void>;
    __yzforgeBeforeClose(reason: unknown): MaybePromise<boolean | void>;
    __yzforgeClose(result: unknown): MaybePromise<void>;
}

export class ViewRuntime {
    public async beforeOpen<TData, TResult>(
        view: ViewRuntimeView<TData, TResult>,
        data: TData | undefined,
    ): Promise<void> {
        await view.__yzforgeBeforeOpen(data);
    }

    public async open<TData, TResult>(
        view: ViewRuntimeView<TData, TResult>,
        data: TData | undefined,
    ): Promise<void> {
        await view.__yzforgeOpen(data);
    }

    public async beforeClose<TResult>(
        view: ViewRuntimeView<unknown, TResult>,
        reason: unknown,
    ): Promise<boolean | void> {
        return await view.__yzforgeBeforeClose(reason);
    }

    public async close<TResult>(
        view: ViewRuntimeView<unknown, TResult>,
        result: unknown,
    ): Promise<void> {
        await view.__yzforgeClose(result);
    }
}
