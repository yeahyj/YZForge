'use strict';
const path = require('path');
const { createHash } = require('crypto');
const ts = require('typescript');
const { bindingShape } = require('./binding-scan.cjs');

/** 从脚本的真实 ES 导出解析组件类型，支持命名导出、默认导出和导出别名。 */
function componentExport(file, custom) {
    const program = ts.createProgram([file], { noResolve: true, noLib: true, experimentalDecorators: true });
    const source = program.getSourceFile(file),
        checker = program.getTypeChecker();
    const module = source && checker.getSymbolAtLocation(source);
    if (!module) throw Error(`${file}: 组件脚本没有可导出的 TypeScript 模块`);
    const exports = checker.getExportsOfModule(module).flatMap((symbol) => {
        const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
        return (target.declarations || [])
            .filter((decl) => ts.isClassDeclaration(decl) && decl.getSourceFile() === source)
            .map((decl) => ({ decl, exported: symbol.name }));
    });
    const isCcclass = (expression, seen = new Set()) => {
        if (ts.isPropertyAccessExpression(expression)) return expression.name.text === 'ccclass';
        if (!ts.isIdentifier(expression) || seen.has(expression)) return false;
        seen.add(expression);
        const symbol = checker.getSymbolAtLocation(expression);
        const declaration = symbol?.valueDeclaration ?? symbol?.declarations?.[0];
        if (declaration && (ts.isBindingElement(declaration) || ts.isImportSpecifier(declaration)))
            return (declaration.propertyName ?? declaration.name).getText(source) === 'ccclass';
        if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer)
            return isCcclass(declaration.initializer, seen);
        return expression.text === 'ccclass';
    };
    const decorated = (decl) =>
        (ts.getDecorators(decl) || []).some(
            ({ expression }) =>
                ts.isCallExpression(expression) &&
                isCcclass(expression.expression) &&
                expression.arguments[0] &&
                ts.isStringLiteralLike(expression.arguments[0]) &&
                expression.arguments[0].text === custom.className,
        );
    // 注册名优先；表达式形式的 ccclass 名称可以用 Creator 提供的构造函数名定位。
    let matches = exports.filter(({ decl }) => decorated(decl));
    if (!matches.length && custom.runtimeName)
        matches = exports.filter(({ decl }) => decl.name?.text === custom.runtimeName);
    if (new Set(matches.map(({ decl }) => decl)).size !== 1)
        throw Error(`${file}: 无法唯一确定 ${custom.className} 的导出类，请导出挂载的组件类后重新编译`);
    matches.sort(
        (a, b) => (a.exported === 'default') - (b.exported === 'default') || a.exported.localeCompare(b.exported),
    );
    const exported = matches[0].exported;
    if (exported !== 'default' && !ts.isIdentifierText(exported, ts.ScriptTarget.Latest))
        throw Error(`${file}: 组件导出名不能生成 TypeScript 标识符：${exported}`);
    return exported;
}

/** 通过 AssetDB 定位脚本，生成相对于 Binding 文件的类型导入；查询函数由编辑器提供。 */
async function resolveBindingFields(fields, directory, scriptFile) {
    const cache = new Map(),
        result = [];
    for (const field of fields) {
        if (!field.custom) {
            result.push(field);
            continue;
        }
        const key = JSON.stringify(field.custom);
        if (!cache.has(key)) {
            const file = await scriptFile(field.custom.classId);
            if (!file || !/\.ts$/i.test(file) || /\.d\.ts$/i.test(file))
                throw Error(`${field.path || field.nodeName}: 找不到 ${field.custom.className} 的项目 TypeScript 脚本`);
            let module = path.relative(directory, file).replaceAll('\\', '/').replace(/\.ts$/i, '');
            if (path.isAbsolute(module)) throw Error(`组件脚本和 Binding 不在同一磁盘：${file}`);
            if (!module.startsWith('.')) module = './' + module;
            cache.set(key, { module, exported: componentExport(file, field.custom) });
        }
        result.push({ ...field, imported: cache.get(key) });
    }
    return result;
}

/** 编译签名包含节点结构及真实类型导入，避免同名字段使用尚未更新的脚本元数据写回预制体。 */
function bindingPlan(fields) {
    return {
        signature: createHash('sha256').update(JSON.stringify(fields)).digest('hex'),
        fields: bindingShape(fields),
    };
}

/** 生成 Page/Popup/Part 共用的绑定基类；组件具体类型只参与 TypeScript 检查。 */
function bindingSource(module, className, fields, framework, component = false) {
    const types = [...new Set(fields.map((field) => field.type))];
    const used = new Set([
        '_decorator',
        'ccclass',
        'property',
        'GameComponent',
        'UIView',
        `${className}Binding`,
        `${className}Params`,
        `${className}Result`,
        ...types,
    ]);
    const aliases = new Map(),
        imports = [];
    const resolved = fields.map((field) => {
        if (!field.imported) return { ...field, valueType: field.type };
        const key = JSON.stringify(field.imported);
        if (!aliases.has(key)) {
            const { module, exported } = field.imported;
            const hint = exported === 'default' ? field.custom.runtimeName : exported;
            const validIdentifier = typeof hint === 'string' && ts.isIdentifierText(hint, ts.ScriptTarget.Latest);
            const token =
                validIdentifier &&
                ts.createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, hint).scan();
            const base = token === ts.SyntaxKind.Identifier ? hint : 'BoundComponent';
            let alias = base,
                index = 2;
            while (used.has(alias)) alias = base + index++;
            used.add(alias);
            aliases.set(key, alias);
            imports.push(
                exported === 'default'
                    ? `import type ${alias} from ${JSON.stringify(module)};`
                    : `import type { ${exported}${alias === exported ? '' : ' as ' + alias} } from ${JSON.stringify(module)};`,
            );
        }
        return { ...field, valueType: aliases.get(key) };
    });
    const label = (value) =>
        String(value)
            .replace(/\*\//g, '* /')
            .replace(/[\r\n\u2028\u2029]+/g, ' ');
    const declarations = resolved
        .map(
            (field) =>
                `  /** @internal Creator 自动写入的序列化引用，无需手动拖节点；请勿手改生成字段。 */
  @property({ type: ${field.type}, visible: false })
  private ${field.field}: ${field.valueType} | null = null;
  /**
   * 自动绑定节点 ${label(field.nodeName)} 的 ${field.valueType}；节点改名、替换组件后通过工作台更新绑定。
   * @throws FrameworkError 引用缺失或已失效，需检查命名、组件和绑定结果。
   */
  protected get ${field.name}(): ${field.valueType} { return this.requireBinding(this.${field.field}, ${JSON.stringify(field.nodeName)}); }`,
        )
        .join('\n');
    const base = component
        ? `import { GameComponent } from '${framework}/core/game-component';`
        : `import { UIView } from '${framework}/ui/ui-view';\nimport type { ${className}Params, ${className}Result } from '../${className}.types';`;
    return `// 由 YZForge 自动生成。节点绑定通过工作台更新，业务逻辑写在派生脚本中。
import { _decorator${types.length ? ', ' + types.join(', ') : ''} } from 'cc';
${base}
${imports.join('\n')}
const { ccclass${types.length ? ', property' : ''} } = _decorator;
/** 自动绑定基类；由 Creator 根据节点命名写入引用，业务继承后直接使用受保护的节点 getter。 */
@ccclass('${module}.${className}Binding')
export class ${className}Binding extends ${component ? 'GameComponent' : `UIView<${className}Params, ${className}Result>`} {
  /** @internal 编辑器核对本次生成是否已编译，不用于业务逻辑。 */
  static readonly __yzforgeBindingSignature: string = '${bindingPlan(fields).signature}';
${declarations}
  /** @internal 框架初始化时验证全部绑定；重新生成会更新此方法。 */
  protected validateBindings(): void { ${fields.map((field) => `void this.${field.name};`).join(' ')} }
}
`;
}

exports.componentExport = componentExport;
exports.resolveBindingFields = resolveBindingFields;
exports.bindingPlan = bindingPlan;
exports.bindingSource = bindingSource;
