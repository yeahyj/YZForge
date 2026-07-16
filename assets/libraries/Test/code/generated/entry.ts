import { YZFORGE_RUNTIME_ABI } from 'yzforge';
import { defineLibraryEntry, registerLibraryEntry } from 'yzforge/authoring';
import { assets } from './assets';
import { config } from './config';
import { providers } from '../providers';
registerLibraryEntry(defineLibraryEntry({
    abi: YZFORGE_RUNTIME_ABI,
    name: 'Test',
    bundle: 'yzforge-lib-test',
    assets,
    config,
    libraries: [],
    tokens: providers,
}));
