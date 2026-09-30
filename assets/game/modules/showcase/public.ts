// 自动生成的唯一公开入口。人工契约放 contracts，公开生成物由声明决定。
import type { ModuleRef } from '../../../framework/modules/module-manager';
import type { ShowcaseApi } from './contracts/api';
/** 轻量模块引用；import 不加载私有实现或初始化业务。 */
export const ShowcaseModule: ModuleRef<ShowcaseApi> = { id: 'showcase' };
export * from './contracts/ShowcasePage.types';
export * from './contracts/api';
export * from './contracts/generated/bundles';
export * from './contracts/generated/config/Samples.table';
export * from './contracts/generated/config/Samples.types';
export * from './contracts/generated/enums/Quality';
export * from './contracts/generated/localization-default';
export * from './contracts/generated/resources-default-en';
export * from './contracts/generated/resources-default-zh-cn';
export * from './contracts/generated/resources-default';
export * from './contracts/generated/resources-extra';
export * from './contracts/generated/views';
