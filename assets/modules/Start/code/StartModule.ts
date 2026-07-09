import { Module } from 'yzforge';
import type { StartConfigTables } from './generated/config';
import type { StartEnterParams } from './public';

export class StartModule extends Module<StartEnterParams, StartConfigTables> {
    protected onEnter(params?: StartEnterParams): void {
        this.logger.info('Start module entered.', params);
    }
}
