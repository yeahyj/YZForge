import { moduleServices } from '../../../../framework/modules/module-manager';
import type { LobbyService } from './services/LobbyService';
/** 大厅内部服务合同；其他模块通过 public.ts 的公开 API 通信。 */
export const LobbyServices = moduleServices<{ readonly lobby: LobbyService }>('lobby');
