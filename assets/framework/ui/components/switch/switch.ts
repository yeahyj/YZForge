import { _decorator, CCInteger, Component } from 'cc';
const { ccclass, property, menu, disallowMultiple, executeInEditMode } = _decorator;

/**
 * 子节点显隐开关。挂在父节点上，按索引或名字显示任意几个直接子节点。
 * 不创建内容、不绑定按钮、不管理业务状态；禁用再启用仍保持最后一次选择。
 * @example switcher.updateCheck(0, 2); switcher.updateCheckByName('Content');
 */
@ccclass('yzforge.Switch')
@menu('YZForge/UI/子节点切换')
@disallowMultiple
@executeInEditMode
export class Switch extends Component {
    @property({ type: [CCInteger], visible: false }) private _checkIndex: number[] = [0];

    /** 显示的直接子节点索引，从 0 开始；空数组隐藏全部，超出范围的索引忽略。 */
    @property({
        type: [CCInteger],
        displayName: '显示的子节点索引',
        tooltip: '可同时显示多个，例如 0、2；空列表隐藏全部。',
    })
    get checkIndex(): number[] {
        return this._checkIndex.slice();
    }
    set checkIndex(value: number[]) {
        this.updateCheck(...value);
    }

    /** 按索引更新并记住选择；重复索引自动去重，传空参数隐藏全部。 */
    updateCheck(...childIndex: number[]): void {
        if (!childIndex.every(Number.isInteger)) throw new RangeError('子节点索引须为整数');
        this._checkIndex = Array.from(new Set(childIndex));
        this.refresh();
    }

    /** 按名字更新并记住选择；同名子节点全部显示，未找到的名字忽略。 */
    updateCheckByName(...names: string[]): void {
        this.updateCheck(...this.node.children.flatMap((child, index) => (names.includes(child.name) ? [index] : [])));
    }

    /** 重新应用当前索引。代码增删或调整子节点顺序后调用此方法。 */
    refresh(): void {
        if (!this.node) return;
        this.node.children.forEach((child, index) => {
            child.active = this._checkIndex.includes(index);
        });
    }

    /** Inspector 按钮事件入口，自定义事件数据填节点名字，多个名字以英文逗号分隔。 */
    selectFromEvent(_event: unknown, names: string): void {
        this.updateCheckByName(
            ...names
                .split(',')
                .map((name) => name.trim())
                .filter(Boolean),
        );
    }

    /** @internal 编辑器与运行时都应用已保存的选择。 */
    protected onEnable(): void {
        this.refresh();
    }
}
