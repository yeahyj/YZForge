import { game, Game, Node, sys } from 'cc';
import { Assets } from '../assets/asset-manager';
import { ContentRelease } from '../assets/asset-types';
import { AudioManager } from '../audio/audio-manager';
import { ConfigManager } from '../config/config-manager';
import { ModuleDefinition, ModuleManager } from '../modules/module-manager';
import { bundleFactoryLoader } from '../modules/module-entry';
import { Storage } from '../platform/storage';
import { createPlatformClock, PlatformClockOptions } from '../platform/clock';
import { TimeOptions, TimeService } from '../time/time-service';
import { UIManager, ViewDefinition } from '../ui/ui-manager';
import { ClockDriver, SystemClockDriver } from './clock-driver';
import { Events } from './events';
import { Scope } from './scope';
import { FrameworkError } from './errors';
import { GameComponent } from './game-component';
export interface AppOptions {
  readonly appId: string;
  readonly root: Node; readonly uiRoot: Node; readonly release: ContentRelease;
  readonly modules: readonly ModuleDefinition[]; readonly views: readonly ViewDefinition[];
  readonly clock?: ClockDriver; readonly time?: TimeOptions;
  readonly clockOptions?: PlatformClockOptions;
  readonly cleanupTimeoutMs?: number; readonly maxAudioVoices?: number; readonly audioChannels?: Readonly<Record<string, number>>;
}
/** Composition root: fixed services, ordinary module factories, no extension installation. */
export class App {
  readonly scope = new Scope('app');
  readonly flows = this.scope.child('flows');
  readonly events = new Events();
  readonly storage: Storage;
  readonly platform = Object.freeze({ native: sys.isNative, mobile: sys.isMobile, os: sys.os, platform: sys.platform });
  readonly clock: ClockDriver;
  readonly time: TimeService;
  readonly assets: Assets;
  readonly config: ConfigManager;
  readonly modules: ModuleManager;
  readonly ui: UIManager;
  readonly audio: AudioManager;
  private closing?: Promise<void>;
  private readonly unbind: () => void;
  constructor(input: AppOptions) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(input.appId)) throw new FrameworkError('APP_ID_INVALID', 'Provide a stable application ID for storage isolation');
    this.storage = new Storage(`${input.appId}:`);
    this.clock = input.clock ?? createPlatformClock(input.clockOptions);
    this.time = new TimeService(this.clock, this.scope, input.time);
    this.assets = new Assets(input.release, this.scope);
    this.config = new ConfigManager(this.assets); this.assets.attachConfig(this.config);
    this.modules = new ModuleManager(input.modules, this.clock, (id, scope, createSession) => Object.freeze({ id, scope,
      assets: this.assets.in(scope, `${id}/default`), config: this.config.in(scope), time: this.time.in(scope),
      events: this.events, ui: this.ui, audio: this.audio, createSession }), undefined, input.cleanupTimeoutMs);
    this.modules.loadFactory = bundleFactoryLoader(this.assets);
    this.assets.codeReady = id => this.modules.isCodeReady(id); this.assets.moduleReady = id => this.modules.isReady(id);
    this.assets.bindInstance = (node, scope, id, active) => {
      const components = node.getComponentsInChildren(GameComponent);
      if (components.length && !id) throw new FrameworkError('INSTANCE_MODULE_REQUIRED', 'GameComponent prefabs require a registered module resource key');
      if (id) for (const component of components) {
        component.__bind(this.modules.contextForBinding(id), scope, this.time);
        if (active) component.__allow(scope);
      }
    };
    this.assets.activateInstance = (node, scope) => { for (const component of node.getComponentsInChildren(GameComponent)) component.__allow(scope); };
    this.ui = new UIManager(input.uiRoot, this.assets, this.modules, this.time, this.clock, input.views, undefined, input.cleanupTimeoutMs);
    this.audio = new AudioManager(input.root, this.assets, this.clock, this.scope, input.maxAudioVoices, input.audioChannels);
    const hide = () => { if (this.clock instanceof SystemClockDriver) this.clock.setBackground(true); };
    const show = () => { if (this.clock instanceof SystemClockDriver) this.clock.setBackground(false); };
    game.on(Game.EVENT_HIDE, hide); game.on(Game.EVENT_SHOW, show);
    this.unbind = () => { game.off(Game.EVENT_HIDE, hide); game.off(Game.EVENT_SHOW, show); };
  }
  close(): Promise<void> {
    if (!this.closing) this.closing = (async () => {
      const failures: unknown[] = [];
      const attempt = async (action: () => Promise<void>) => { try { await action(); } catch (error) { failures.push(error); } };
      this.flows.cancel();
      await attempt(() => this.ui.close()); await attempt(() => this.flows.close());
      await attempt(() => this.audio.close()); await attempt(() => this.modules.close());
      await attempt(() => this.scope.close()); this.unbind();
      if (failures.length) throw new FrameworkError('APP_SHUTDOWN_FAILED', 'Shutdown completed with cleanup failures', { failures });
    })();
    return this.closing;
  }
}
