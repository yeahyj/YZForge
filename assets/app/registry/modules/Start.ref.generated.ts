import { YZFORGE_RUNTIME_ABI } from 'yzforge';
import { defineModuleRef } from 'yzforge/authoring';
import type { StartEnterParams } from '../../contracts/modules/Start.contract.generated';

export const StartRef = defineModuleRef<StartEnterParams>({
    abi: YZFORGE_RUNTIME_ABI,
    name: 'Start',
    bundle: 'yzforge-module-start',
    libraries: [],
});
