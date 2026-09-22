import { eventKey } from '../../../../framework/core/events';

/** Service 推导的只读展示数据；界面按数据绘制，不自行判断领取规则。 */
export interface TaskCardModel {
    readonly id: number;
    readonly title: string;
    readonly detail: string;
    readonly reward: number;
    readonly state: 'locked' | 'ready' | 'claimed';
}
/** 一次业务状态变化的事实，供其他模块订阅。 */
export const WorkshopChanged = eventKey<{ readonly reason: string; readonly progress: number; readonly coins: number }>(
    'workshop/changed',
);
