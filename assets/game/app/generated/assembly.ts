// Generated from module.json.
import type { ModuleDefinition } from '../../../framework/modules/module-manager';
import type { ViewDefinition } from '../../../framework/ui/ui-manager';
import { createLobbyModule as factoryLobby } from "../../modules/lobby/code/LobbyModule";
export const modules: readonly ModuleDefinition[] = [
{ id: "lobby", dependencies: [], factory: factoryLobby }
];
export const views: readonly ViewDefinition[] = [
  {
    "id": "lobby.dashboard",
    "module": "lobby",
    "prefab": {
      "id": "lobby/default/prefab/dashboard",
      "type": "Prefab"
    },
    "kind": "page",
    "cache": "none",
    "duplicate": "reject"
  },
  {
    "id": "lobby.reward-popup",
    "module": "lobby",
    "prefab": {
      "id": "lobby/default/prefab/reward-popup",
      "type": "Prefab"
    },
    "kind": "popup",
    "cache": "none",
    "duplicate": "reject"
  }
];
