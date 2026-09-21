// Generated release snapshot. Restart the game runtime to select another release.
import type { ContentRelease } from '../../../framework/assets/asset-types';
export const release: ContentRelease = {
    releaseId: 'dev-20260920',
    bundles: {
        'm-lobby': {
            id: 'm-lobby',
            namespace: 'lobby/default',
            dependencies: [],
        },
    },
    namespaces: {
        'lobby/default': {
            bundle: 'm-lobby',
            path: 'yz-index',
        },
    },
    tables: {
        'lobby.items': [
            {
                bundle: 'm-lobby',
                path: 'dynamic/config/items',
                dataRevision: 'sha256:68821a6513140031db77adb219a6231b7591176e2c6163d4a3d60f4970ff8c60',
            },
        ],
    },
};
