// 自动生成的唯一公开入口。人工契约放 contracts，公开生成物由声明决定。
import type { ModuleRef } from '../../../framework/modules/module-manager';
import type { WorkshopApi } from './contracts/api';
/** 轻量模块引用；import 不加载私有实现或初始化业务。 */
export const WorkshopModule: ModuleRef<WorkshopApi> = { id: 'workshop' };
export * from './contracts/WorkflowPage.types';
export * from './contracts/api';
export * from './contracts/badges';
export * from './contracts/generated/bundles';
export * from './contracts/generated/config/Tasks.table';
export * from './contracts/generated/config/Tasks.types';
export * from './contracts/generated/enums/Quality';
export * from './contracts/generated/resources-default';
export * from './contracts/generated/views';
export * from './contracts/workflow';
