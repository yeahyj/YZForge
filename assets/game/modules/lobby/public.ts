import type { ModuleRef } from '../../../framework/modules/module-manager';
export interface LobbyApi { readonly moduleId: string; }
export const LobbyModule: ModuleRef<LobbyApi> = { id: 'lobby' };
