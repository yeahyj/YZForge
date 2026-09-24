import type { LocalizationOptions } from '../../framework/localization/localization';
import { ShowcaseRes } from '../modules/showcase/contracts/generated/resources-default';
import { ShowcaseExtraRes } from '../modules/showcase/contracts/generated/resources-extra';

/** 示例语言登记；可改为项目自己的语言 Bundle，导入 Key 不会提前下载对应包。 */
export const localization: LocalizationOptions = {
    defaultLocale: 'zh-CN',
    catalogs: { 'zh-CN': ShowcaseRes.json.localesZhCn, en: ShowcaseExtraRes.json.localesEn },
};
