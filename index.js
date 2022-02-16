const fs = require('fs');
const path = require('path');
const { parse } = require('node-html-parser');
const typescript = require('typescript');
const _ = require('lodash');

const CRICUT_REPO_PATH = '../cricut/CricutDesignSpace';
const TARGET_FOLDER_PATH = 'libs/user-profile';

const UNABLE_TO_RESOLVE_VALUE = 'UNABLE_TO_RESOLVE_VALUE';

const { tsFiles, htmlFiles } = findRelevantFiles();
const trees = createTreesFromFiles(htmlFiles).flat();
const htmlTranslationKeys = parseHTMLAst(trees);
const tsTranslationsKeys = parseTSAst(tsFiles).flat();
const filteredResults = filterResults([...htmlTranslationKeys, ...tsTranslationsKeys]);

createJSONTranslations(filteredResults);

function findRelevantFiles() {
    const pathsToIterate = [path.resolve(CRICUT_REPO_PATH, TARGET_FOLDER_PATH)];
    const htmlFiles = [];
    const tsFiles = [];

    while (pathsToIterate.length) {
        const currentPath = pathsToIterate.shift();

        fs.readdirSync(currentPath, { withFileTypes: true }).forEach(entry => {
            const isHTML = entry.name.endsWith('.html');
            const isTS = entry.name.endsWith('.ts');

            if (entry.isFile() && ((isHTML || isTS))) {
                const relevantPath = path.resolve(`${currentPath}/${entry.name}`);

                isHTML ? htmlFiles.push(relevantPath) : tsFiles.push(relevantPath);
            } else if (entry.isDirectory()) {
                pathsToIterate.push(path.resolve(currentPath, entry.name));
            }
        });
    }

    return { htmlFiles, tsFiles };
}

function createTreesFromFiles(files) {
    return files.map(file => {
        const html = fs.readFileSync(file);
        const root = createHTMLAST(html);

        return root.childNodes;
    });
}

function createHTMLAST(html) {
    return parse(html, {
        comment: false,
        blockTextElements: {
            script: true,
            noscript: true,
            style: false,
            pre: false
        }
    });
}

function parseHTMLAst(trees) {
    const results = [];
    const nodesToIterate = [...trees];

    while (nodesToIterate.length) {
        const currentNode = nodesToIterate.shift();
        const hasChildNodes = currentNode.childNodes && currentNode.childNodes.length;

        if (Array.isArray(currentNode) || hasChildNodes) {
            const nodes = hasChildNodes ? currentNode.childNodes : currentNode;
            nodesToIterate.push(...nodes);
        }

        if (currentNode.rawAttrs || currentNode.rawText) {
            const attrValue = getAttributeTranslation(currentNode);
            const textValue = getTextTranslation(currentNode);

            results.push(...attrValue, ...textValue);
        }
    }

    return results;
}

function parseTSAst(files) {
    const parseResults = [];

    files.forEach(file => {
        const rootNode = createTsAST(file);

        parseFiles(rootNode, file);
    });

    function parseFiles(node, file) {
        if (node.expression && node.kind === 207) {
            if (node.expression && node.expression.name && node.expression.name.escapedText === 'instant') {
                const [fnArguments] = node.arguments;
                const argumentNodes = Array.isArray(fnArguments) ? fnArguments : [fnArguments];
                const translationKeys = argumentNodes.map(node => {
                    const validFields = [
                        'text',
                        'expression.escapedText',
                        'name.escapedText',
                        'expression.name.escapedText',
                        'left.expression.name.escapedText',
                        'right.expression.name.escapedText',
                        'head.text',
                        'condition.expression.name.escapedText',
                        'condition.expression.escapedText',
                        'condition.escapedText',
                        'whenTrue.text',
                        'whenFalse.text',
                    ];

                    const field = validFields.find(validField => _.get(node, validField));
                    const name = _.get(node, field);

                    if (name) {
                        return name;
                    }

                    const elements = node.elements && node.elements.map(element => element.text);

                    if (elements && elements.length) {
                        return elements;
                    }

                    return `${UNABLE_TO_RESOLVE_VALUE}:${prettifyKey(name)}`;
                });

                parseResults.push(...translationKeys);
            }
        }

        node.forEachChild(node => parseFiles(node, file));
    }

    return parseResults;
}

function createTsAST(file) {
    const content = fs.readFileSync(file, { encoding: 'utf8' });

    return typescript.createSourceFile(
      '_.ts',
      content,
      typescript.ScriptTarget.Latest
    );
}


function getAttributeTranslation(node) {
    if (!node.getAttribute) {
        return [];
    }

    const translationKey = node.getAttribute('translate');

    if (translationKey) {
        return [translationKey.trim()];
    }

    return extractTranslationsFromString(node.rawAttrs);
}

function getTextTranslation(node) {
    let rawText = node.rawText;

    if (!rawText || !rawText.includes('translate')) {
        return [];
    }

    return extractTranslationsFromString(node.rawText);
}

function extractTranslationsFromString(value) {
    const results = [];
    let currentString = value;

    const translateKeyword = '| translate';
    let lastTranslateIndex;

    while (true) {
        const currentTranslateIndex = currentString.indexOf(translateKeyword);

        if (currentTranslateIndex === -1) {
            return results;
        }

        const attrs = currentString.substring(0, currentTranslateIndex).trim();
        const end = Math.max(attrs.lastIndexOf('\''), attrs.lastIndexOf('\"'));
        const start = Math.max(attrs.lastIndexOf('\'', end - 1), attrs.lastIndexOf('\"', end - 1)) + 1;

        const unresolvedValue = `${UNABLE_TO_RESOLVE_VALUE}: ${prettifyKey(attrs)}`;
        const translationKey = attrs.substring(start, end).trim() || unresolvedValue;

        results.push(translationKey);
        lastTranslateIndex = currentTranslateIndex;
        currentString = currentString.substring(currentTranslateIndex + translateKeyword.length);
    }
}

function filterResults(results) {
    return [...new Set([...results])];
}

function prettifyKey(key) {
    return key.replace(/\s/g, '').replace(/\n/g);
}

function createJSONTranslations(translationKeys) {
    const TRANSLATIONS_PATH = path.resolve(CRICUT_REPO_PATH, 'static-asset/design3/translation');
    const paths = ['en_US.json', 'featureFlags.json'];
    const unresolvedTranslations = {};

    const translationsObject = {};

    paths.forEach(currentPath => {
        const fullPath = path.resolve(TRANSLATIONS_PATH, currentPath);
        const file = fs.readFileSync(fullPath, { encoding: 'utf8' });
        const content = JSON.parse(file);

        Object.assign(translationsObject, content);
    });

    const resolvedTranslations = translationKeys.reduce((acc, key) => {
        const path = key.split('.');
        const value = path.reduce((acc, current) => {
            return acc ? acc[current] : ""
        }, translationsObject);

        if (value) {
            _.set(acc, path, value);
        } else {
            _.set(unresolvedTranslations, path, key)
        }

        return acc;
    }, {});

    const translationsFilename = 'translations.json';
    const unresolvedTranslationsFilename = 'unresolved-translations.json';

    fs.writeFileSync(`./${translationsFilename}`, JSON.stringify(resolvedTranslations));
    fs.writeFileSync(`./${unresolvedTranslationsFilename}`, JSON.stringify(unresolvedTranslations));

    console.log(`Translations were generated: ${translationsFilename}, ${unresolvedTranslationsFilename}`,)
}