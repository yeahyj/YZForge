import { YZFORGE_RUNTIME_ABI } from 'yzforge';
import { defineModuleEntry, registerModuleEntry } from 'yzforge/authoring';
import { StartModule } from '../StartModule';
import { assets } from './assets';
import { config } from './config';
registerModuleEntry(defineModuleEntry({
    abi: YZFORGE_RUNTIME_ABI,
    name: 'Start',
    bundle: 'yzforge-module-start',
    type: StartModule,
    assets,
    config,
    libraries: [],
}));
