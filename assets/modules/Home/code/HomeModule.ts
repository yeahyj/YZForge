import { Module } from '../../../yzforge/runtime';
import type { HomeEnterParams } from './public';

export class HomeModule extends Module<HomeEnterParams> {
    protected onEnter(params?: HomeEnterParams): void {
        this.logger.info('Home module entered.', params);
    }

    protected onExit(): void {
        this.logger.info('Home module exited.');
    }
}
