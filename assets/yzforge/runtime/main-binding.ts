import { Canvas, director, isValid, Node } from 'cc';
import { YZForgeError } from './errors';
import { ViewLayer } from './ui';

export interface MainBinding {
    readonly mainRoot: Node;
    readonly worldRoot: Node;
    readonly sceneHost: Node;
    readonly canvas: Node;
    readonly uiRoot: Node;
    readonly fullscreenLayer: Node;
    readonly safeAreaRoot: Node;
    readonly pageLayer: Node;
    readonly paperLayer: Node;
    readonly popupLayer: Node;
    readonly toastLayer: Node;
    readonly topLayer: Node;
    readonly systemLayer: Node;
    readonly layerRoots: Readonly<Record<ViewLayer, Node>>;
}

export interface MainBindingOptions {
    readonly mainRoot?: Node;
}

export function createMainBinding(options: MainBindingOptions = {}): MainBinding {
    const mainRoot = options.mainRoot && isValid(options.mainRoot)
        ? options.mainRoot
        : findSceneChild('MainRoot');
    const worldRoot = requireChild(mainRoot, 'WorldRoot');
    const sceneHost = requireChild(worldRoot, 'SceneHost');
    const canvas = requireChild(mainRoot, 'Canvas');
    if (!canvas.getComponent(Canvas)) {
        throw new YZForgeError('Main Canvas node must have cc.Canvas.', 'main_binding.canvas_missing');
    }
    const uiRoot = requireChild(canvas, 'UIRoot');
    const fullscreenLayer = requireChild(uiRoot, 'FullscreenLayer');
    const safeAreaRoot = requireChild(uiRoot, 'SafeAreaRoot');
    const pageLayer = requireChild(safeAreaRoot, 'PageLayer');
    const paperLayer = requireChild(safeAreaRoot, 'PaperLayer');
    const popupLayer = requireChild(safeAreaRoot, 'PopupLayer');
    const toastLayer = requireChild(safeAreaRoot, 'ToastLayer');
    const topLayer = requireChild(safeAreaRoot, 'TopLayer');
    const systemLayer = requireChild(uiRoot, 'SystemLayer');
    return {
        mainRoot,
        worldRoot,
        sceneHost,
        canvas,
        uiRoot,
        fullscreenLayer,
        safeAreaRoot,
        pageLayer,
        paperLayer,
        popupLayer,
        toastLayer,
        topLayer,
        systemLayer,
        layerRoots: {
            [ViewLayer.Page]: pageLayer,
            [ViewLayer.Paper]: paperLayer,
            [ViewLayer.Popup]: popupLayer,
            [ViewLayer.Toast]: toastLayer,
            [ViewLayer.Top]: topLayer,
            [ViewLayer.System]: systemLayer,
        },
    };
}

function findSceneChild(name: string): Node {
    const scene = director.getScene();
    if (!scene) {
        throw new YZForgeError('Main scene is not available.', 'main_binding.scene_missing');
    }
    return requireChild(scene, name);
}

function requireChild(parent: Node, name: string): Node {
    const child = parent.children.find((item) => item.name === name);
    if (!child || !isValid(child)) {
        throw new YZForgeError(`Main binding node missing: ${parent.name}/${name}`, 'main_binding.node_missing', {
            parent: parent.name,
            name,
        });
    }
    return child;
}
