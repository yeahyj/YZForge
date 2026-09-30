// 自动生成的唯一公开入口。人工契约放 contracts，公开生成物由声明决定。
import type { ModuleRef } from '../../../framework/modules/module-manager';
import type { LobbyApi } from './contracts/api';
/** 轻量模块引用；import 不加载私有实现或初始化业务。 */
export const LobbyModule: ModuleRef<LobbyApi> = { id: 'lobby' };
export * from './contracts/Dashboard.types';
export * from './contracts/api';
export * from './contracts/generated/bundles';
export * from './contracts/generated/resources-default';
export * from './contracts/generated/views';
