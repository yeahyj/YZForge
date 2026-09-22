import { moduleServices } from '../../../../framework/modules/module-manager';
import type { ShowcaseService } from './services/ShowcaseService';

/** 示例模块的诊断和事件记录；只向本模块界面暴露。 */
export const ShowcaseServices = moduleServices<{ showcase: ShowcaseService }>('showcase');
