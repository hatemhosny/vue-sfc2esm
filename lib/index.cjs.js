/*!
 * sfc2esm v0.1.0
 * (c) 2021 xiaoluoboding
 * @license MIT
 */
'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

var defaultCompiler = require('@vue/compiler-sfc/dist/compiler-sfc.esm-browser');
var shared = require('@vue/shared');
var vue = require('vue');
var base64 = require('crypto-js/enc-base64');
var sha256 = require('crypto-js/sha256');

function _interopDefaultLegacy (e) { return e && typeof e === 'object' && 'default' in e ? e : { 'default': e }; }

function _interopNamespace(e) {
  if (e && e.__esModule) return e;
  var n = Object.create(null);
  if (e) {
    Object.keys(e).forEach(function (k) {
      if (k !== 'default') {
        var d = Object.getOwnPropertyDescriptor(e, k);
        Object.defineProperty(n, k, d.get ? d : {
          enumerable: true,
          get: function () {
            return e[k];
          }
        });
      }
    });
  }
  n['default'] = e;
  return Object.freeze(n);
}

var defaultCompiler__namespace = /*#__PURE__*/_interopNamespace(defaultCompiler);
var base64__default = /*#__PURE__*/_interopDefaultLegacy(base64);
var sha256__default = /*#__PURE__*/_interopDefaultLegacy(sha256);

const MAIN_FILE = 'App.vue';
const COMP_IDENTIFIER = `__sfc__`;
/**
 * The default SFC compiler we are using is built from each commit
 * but we may swap it out with a version fetched from CDNs
 */
let SFCCompiler = defaultCompiler__namespace;
async function compileFile({ filename, code, compiled }) {
    if (!code.trim()) {
        store.errors = [];
        return;
    }
    if (!filename.endsWith('.vue')) {
        compiled.js = compiled.ssr = code;
        store.errors = [];
        return;
    }
    const id = await hashId(filename);
    const { errors, descriptor } = SFCCompiler.parse(code, {
        filename,
        sourceMap: true
    });
    if (errors.length) {
        store.errors = errors;
        return;
    }
    if ((descriptor.script && descriptor.script.lang) ||
        (descriptor.scriptSetup && descriptor.scriptSetup.lang) ||
        descriptor.styles.some((s) => s.lang) ||
        (descriptor.template && descriptor.template.lang)) {
        store.errors = [
            'lang="x" pre-processors are not supported in the in-browser playground.'
        ];
        return;
    }
    const hasScoped = descriptor.styles.some((s) => s.scoped);
    let clientCode = '';
    let ssrCode = '';
    const appendSharedCode = (code) => {
        clientCode += code;
        ssrCode += code;
    };
    const clientScriptResult = doCompileScript(descriptor, id, false);
    if (!clientScriptResult) {
        return;
    }
    const [clientScript, bindings] = clientScriptResult;
    clientCode += clientScript;
    // script ssr only needs to be performed if using <script setup> where
    // the render fn is inlined.
    if (descriptor.scriptSetup) {
        const ssrScriptResult = doCompileScript(descriptor, id, true);
        if (!ssrScriptResult) {
            return;
        }
        ssrCode += ssrScriptResult[0];
    }
    else {
        // when no <script setup> is used, the script result will be identical.
        ssrCode += clientScript;
    }
    // template
    // only need dedicated compilation if not using <script setup>
    if (descriptor.template && !descriptor.scriptSetup) {
        const clientTemplateResult = doCompileTemplate(descriptor, id, bindings, false);
        if (!clientTemplateResult) {
            return;
        }
        clientCode += clientTemplateResult;
        const ssrTemplateResult = doCompileTemplate(descriptor, id, bindings, true);
        if (!ssrTemplateResult) {
            return;
        }
        ssrCode += ssrTemplateResult;
    }
    if (hasScoped) {
        appendSharedCode(`\n${COMP_IDENTIFIER}.__scopeId = ${JSON.stringify(`data-v-${id}`)}`);
    }
    if (clientCode || ssrCode) {
        appendSharedCode(`\n${COMP_IDENTIFIER}.__file = ${JSON.stringify(filename)}` +
            `\nexport default ${COMP_IDENTIFIER}`);
        compiled.js = clientCode.trimStart();
        compiled.ssr = ssrCode.trimStart();
    }
    // styles
    let css = '';
    for (const style of descriptor.styles) {
        if (style.module) {
            store.errors = [`<style module> is not supported in the playground.`];
            return;
        }
        const styleResult = await SFCCompiler.compileStyleAsync({
            source: style.content,
            filename,
            id,
            scoped: style.scoped,
            modules: !!style.module
        });
        if (styleResult.errors.length) {
            // postcss uses pathToFileURL which isn't polyfilled in the browser
            // ignore these errors for now
            if (!styleResult.errors[0].message.includes('pathToFileURL')) {
                store.errors = styleResult.errors;
            }
            // proceed even if css compile errors
        }
        else {
            css += styleResult.code + '\n';
        }
    }
    if (css) {
        compiled.css = css.trim();
    }
    else {
        compiled.css = '/* No <style> tags present */';
    }
    // clear errors
    store.errors = [];
}
function doCompileScript(descriptor, id, ssr) {
    if (descriptor.script || descriptor.scriptSetup) {
        try {
            const compiledScript = SFCCompiler.compileScript(descriptor, {
                id,
                refSugar: true,
                inlineTemplate: true,
                templateOptions: {
                    ssr,
                    ssrCssVars: descriptor.cssVars
                }
            });
            let code = '';
            if (compiledScript.bindings) {
                code += `\n/* Analyzed bindings: ${JSON.stringify(compiledScript.bindings, null, 2)} */`;
            }
            code +=
                `\n` +
                    SFCCompiler.rewriteDefault(compiledScript.content, COMP_IDENTIFIER);
            return [code, compiledScript.bindings];
        }
        catch (e) {
            store.errors = [e];
            return;
        }
    }
    else {
        return [`\nconst ${COMP_IDENTIFIER} = {}`, undefined];
    }
}
function doCompileTemplate(descriptor, id, bindingMetadata, ssr) {
    const templateResult = SFCCompiler.compileTemplate({
        source: descriptor.template.content,
        filename: descriptor.filename,
        id,
        scoped: descriptor.styles.some(s => s.scoped),
        slotted: descriptor.slotted,
        ssr,
        ssrCssVars: descriptor.cssVars,
        isProd: false,
        compilerOptions: {
            bindingMetadata
        }
    });
    if (templateResult.errors.length) {
        store.errors = templateResult.errors;
        return;
    }
    const fnName = ssr ? `ssrRender` : `render`;
    return (`\n${templateResult.code.replace(/\nexport (function|const) (render|ssrRender)/, `$1 ${fnName}`)}` + `\n${COMP_IDENTIFIER}.${fnName} = ${fnName}`);
}
async function hashId(filename) {
    const hashDigest = base64__default['default'].stringify(sha256__default['default'](filename)); // hash the message
    return hashDigest.slice(0, 16);
}

const welcomeCode = `
<template>
  <h1>{{ msg }}</h1>
</template>

<script setup>
const msg = 'Hello World!'
</script>
`.trim();
class File {
    constructor(filename, code = '') {
        this.compiled = {
            js: '',
            css: '',
            ssr: ''
        };
        this.filename = filename;
        this.code = code;
    }
}
let files = {};
{
    files = {
        'App.vue': new File(MAIN_FILE, welcomeCode)
    };
}
const store = vue.reactive({
    files,
    activeFilename: MAIN_FILE,
    get activeFile() {
        return store.files[store.activeFilename];
    },
    get importMap() {
        const file = store.files['import-map.json'];
        return file && file.code;
    },
    errors: []
});
console.log(store.files[MAIN_FILE]);
vue.watchEffect(() => compileFile(store.activeFile));
for (const file in store.files) {
    if (file !== MAIN_FILE) {
        compileFile(store.files[file]);
    }
}
// watchEffect(() => {
//   history.replaceState({}, '', '#' + btoa(JSON.stringify(exportFiles())))
// })
function exportFiles() {
    const exported = {};
    for (const filename in store.files) {
        exported[filename] = store.files[filename].code;
    }
    return exported;
}
function setActive(filename) {
    store.activeFilename = filename;
}
function addFile(filename) {
    const file = (store.files[filename] = new File(filename));
    if (filename === 'import-map.json') {
        file.code = `
{
  "imports": {
  }
}`.trim();
    }
    setActive(filename);
}
function deleteFile(filename) {
    if (confirm(`Are you sure you want to delete ${filename}?`)) {
        if (store.activeFilename === filename) {
            store.activeFilename = MAIN_FILE;
        }
        delete store.files[filename];
    }
}

async function compileModules() {
    const modules = await processFile(store.files[MAIN_FILE]);
    const styles = [
        'color: white',
        'background: #42b983',
        'margin-left: 4px',
        'padding: 2px 4px',
        'border-radius: 2px'
    ].join(';');
    console.log(`Successfully compiled:%c${modules.length} modules.`, styles);
    return modules.reverse();
}
const modulesKey = `__modules__`;
const exportKey = `__export__`;
const dynamicImportKey = `__dynamic_import__`;
const moduleKey = `__module__`;
// similar logic with Vite's SSR transform, except this is targeting the browser
async function processFile(file, seen = new Set()) {
    if (seen.has(file)) {
        return [];
    }
    seen.add(file);
    await compileFile(file);
    const { js, css } = file.compiled;
    const s = new defaultCompiler.MagicString(js);
    const ast = defaultCompiler.babelParse(js, {
        sourceFilename: file.filename,
        sourceType: 'module',
        plugins: [...shared.babelParserDefaultPlugins]
    }).program.body;
    const idToImportMap = new Map();
    const declaredConst = new Set();
    const importedFiles = new Set();
    const importToIdMap = new Map();
    function defineImport(node, source) {
        const filename = source.replace(/^\.\/+/, '');
        if (!(filename in store.files)) {
            throw new Error(`File "${filename}" does not exist.`);
        }
        if (importedFiles.has(filename)) {
            return importToIdMap.get(filename);
        }
        importedFiles.add(filename);
        const id = `__import_${importedFiles.size}__`;
        importToIdMap.set(filename, id);
        s.appendLeft(node.start, `const ${id} = ${modulesKey}[${JSON.stringify(filename)}]\n`);
        return id;
    }
    function defineExport(name, local = name) {
        s.append(`\n${exportKey}(${moduleKey}, "${name}", () => ${local})`);
    }
    function defineAmount() {
        return `
import { createApp as _createApp } from "vue"

if (window.__app__) {
  window.__app__.unmount()
  document.getElementById('app').innerHTML = ''
}

document.getElementById('__sfc-styles').innerHTML = window.__css__
const app = window.__app__ = _createApp(__modules__["${MAIN_FILE}"].default)
app.config.errorHandler = e => console.error(e)
app.mount('#app')`.trim();
    }
    // 0. instantiate module
    s.prepend(`window.__modules__ = {};\nwindow.__css__ = ''\n\nconst ${moduleKey} = __modules__[${JSON.stringify(file.filename)}] = { [Symbol.toStringTag]: "Module" }\n\n`);
    // 1. check all import statements and record id -> importName map
    for (const node of ast) {
        // import foo from 'foo' --> foo -> __import_foo__.default
        // import { baz } from 'foo' --> baz -> __import_foo__.baz
        // import * as ok from 'foo' --> ok -> __import_foo__
        if (node.type === 'ImportDeclaration') {
            const source = node.source.value;
            if (source.startsWith('./')) {
                const importId = defineImport(node, node.source.value);
                for (const spec of node.specifiers) {
                    if (spec.type === 'ImportSpecifier') {
                        idToImportMap.set(spec.local.name, `${importId}.${spec.imported.name}`);
                    }
                    else if (spec.type === 'ImportDefaultSpecifier') {
                        idToImportMap.set(spec.local.name, `${importId}.default`);
                    }
                    else {
                        // namespace specifier
                        idToImportMap.set(spec.local.name, importId);
                    }
                }
                s.remove(node.start, node.end);
            }
        }
    }
    // 2. check all export statements and define exports
    for (const node of ast) {
        // named exports
        if (node.type === 'ExportNamedDeclaration') {
            if (node.declaration) {
                if (node.declaration.type === 'FunctionDeclaration' ||
                    node.declaration.type === 'ClassDeclaration') {
                    // export function foo() {}
                    defineExport(node.declaration.id.name);
                }
                else if (node.declaration.type === 'VariableDeclaration') {
                    // export const foo = 1, bar = 2
                    for (const decl of node.declaration.declarations) {
                        const names = extractNames(decl.id);
                        for (const name of names) {
                            defineExport(name);
                        }
                    }
                }
                s.remove(node.start, node.declaration.start);
            }
            else if (node.source) {
                // export { foo, bar } from './foo'
                const importId = defineImport(node, node.source.value);
                for (const spec of node.specifiers) {
                    defineExport(spec.exported.name, `${importId}.${spec.local.name}`);
                }
                s.remove(node.start, node.end);
            }
            else {
                // export { foo, bar }
                for (const spec of node.specifiers) {
                    const local = spec.local.name;
                    const binding = idToImportMap.get(local);
                    defineExport(spec.exported.name, binding || local);
                }
                s.remove(node.start, node.end);
            }
        }
        // default export
        if (node.type === 'ExportDefaultDeclaration') {
            s.overwrite(node.start, node.start + 14, `${moduleKey}.default =`);
        }
        // export * from './foo'
        if (node.type === 'ExportAllDeclaration') {
            const importId = defineImport(node, node.source.value);
            s.remove(node.start, node.end);
            s.append(`\nfor (const key in ${importId}) {
        if (key !== 'default') {
          ${exportKey}(${moduleKey}, key, () => ${importId}[key])
        }
      }`);
        }
    }
    // 3. convert references to import bindings
    for (const node of ast) {
        if (node.type === 'ImportDeclaration')
            continue;
        defaultCompiler.walkIdentifiers(node, (id, parent, parentStack) => {
            const binding = idToImportMap.get(id.name);
            if (!binding) {
                return;
            }
            if (isStaticProperty(parent) && parent.shorthand) {
                // let binding used in a property shorthand
                // { foo } -> { foo: __import_x__.foo }
                // skip for destructure patterns
                if (!parent.inPattern ||
                    isInDestructureAssignment(parent, parentStack)) {
                    s.appendLeft(id.end, `: ${binding}`);
                }
            }
            else if (parent.type === 'ClassDeclaration' &&
                id === parent.superClass) {
                if (!declaredConst.has(id.name)) {
                    declaredConst.add(id.name);
                    // locate the top-most node containing the class declaration
                    const topNode = parentStack[1];
                    s.prependRight(topNode.start, `const ${id.name} = ${binding};\n`);
                }
            }
            else {
                s.overwrite(id.start, id.end, binding);
            }
        });
    }
    defaultCompiler.walk(ast, {
        enter(node, parent) {
            if (node.type === 'Import' && parent.type === 'CallExpression') {
                const arg = parent.arguments[0];
                if (arg.type === 'StringLiteral' && arg.value.startsWith('./')) {
                    s.overwrite(node.start, node.start + 6, dynamicImportKey);
                    s.overwrite(arg.start, arg.end, JSON.stringify(arg.value.replace(/^\.\/+/, '')));
                }
            }
        }
    });
    // append CSS injection code
    if (css) {
        s.append(`\nwindow.__css__ += ${JSON.stringify(css)}`);
    }
    const processed = [defineAmount(), s.toString()];
    if (importedFiles.size) {
        for (const imported of importedFiles) {
            const fileList = await processFile(store.files[imported], seen);
            processed.push(...fileList);
        }
    }
    // return a list of files to further process
    return processed;
}
const isStaticProperty = (node) => node.type === 'ObjectProperty' && !node.computed;
function extractNames(param) {
    return extractIdentifiers(param).map(id => id.name);
}
function extractIdentifiers(param, nodes = []) {
    switch (param.type) {
        case 'Identifier':
            nodes.push(param);
            break;
        case 'MemberExpression':
            let object = param;
            while (object.type === 'MemberExpression') {
                object = object.object;
            }
            nodes.push(object);
            break;
        case 'ObjectPattern':
            param.properties.forEach(prop => {
                if (prop.type === 'RestElement') {
                    extractIdentifiers(prop.argument, nodes);
                }
                else {
                    extractIdentifiers(prop.value, nodes);
                }
            });
            break;
        case 'ArrayPattern':
            param.elements.forEach(element => {
                if (element)
                    extractIdentifiers(element, nodes);
            });
            break;
        case 'RestElement':
            extractIdentifiers(param.argument, nodes);
            break;
        case 'AssignmentPattern':
            extractIdentifiers(param.left, nodes);
            break;
    }
    return nodes;
}
function isInDestructureAssignment(parent, parentStack) {
    if (parent &&
        (parent.type === 'ObjectProperty' || parent.type === 'ArrayPattern')) {
        let i = parentStack.length;
        while (i--) {
            const p = parentStack[i];
            if (p.type === 'AssignmentExpression') {
                return true;
            }
            else if (p.type !== 'ObjectProperty' && !p.type.endsWith('Pattern')) {
                break;
            }
        }
    }
    return false;
}

exports.COMP_IDENTIFIER = COMP_IDENTIFIER;
exports.File = File;
exports.MAIN_FILE = MAIN_FILE;
exports.addFile = addFile;
exports.compileFile = compileFile;
exports.compileModules = compileModules;
exports.deleteFile = deleteFile;
exports.exportFiles = exportFiles;
exports.setActive = setActive;
exports.store = store;
