// Generated contract; rows remain in resource bundles.
import { defineTable } from '../../../../../framework/config/schema';
import type { ItemsRow, ItemsId, ItemsIndexes } from './Items.types';
export const ItemsTable = defineTable<ItemsRow, ItemsId, ItemsIndexes>({
  "id": "lobby.items",
  "primaryKey": "id",
  "fields": {
    "id": {
      "kind": "int"
    },
    "name": {
      "kind": "string"
    },
    "amount": {
      "kind": "int"
    },
    "enabled": {
      "kind": "bool"
    }
  },
  "indexes": {},
  "schemaHash": "sha256:96f3a38807b52e2248aebad7faee03d807b52e76274a0a281deb35d7491fdba7"
});
