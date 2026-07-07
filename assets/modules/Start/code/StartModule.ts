import { Module } from '../../../yzforge/runtime';
import type { StartEnterParams } from './public';

export class StartModule extends Module<StartEnterParams> {
    protected onEnter(params?: StartEnterParams): void {
        this.logger.info('Start module entered.', params);
    }
}
