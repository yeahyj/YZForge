import { director, Director, isValid, Node } from 'cc';

/** 停用并销毁节点，等待帧末实际销毁，保证随后释放资源时节点已经失效。 */
export function destroyNode(node: Node): Promise<void> {
    if (!isValid(node)) return Promise.resolve();
    node.active = false;
    node.destroy();
    return new Promise((resolve) => {
        const check = () => {
            if (!isValid(node)) resolve();
            else director.once(Director.EVENT_AFTER_DRAW, check);
        };
        director.once(Director.EVENT_AFTER_DRAW, check);
    });
}
