"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const camelcase_1 = __importDefault(require("camelcase"));
const fs_1 = require("fs");
const entities = JSON.parse((0, fs_1.readFileSync)(`prisma/generated/json-schema.json`, 'utf-8'));
const scalars = [
    'string',
    'float',
    'integer',
    'object',
    'enum',
    'boolean',
    'number',
    '[enum]',
];
const prismaEntities = Object.entries(entities.definitions).map(e => ({
    name: e[0],
    fields: Object.entries(e[1].properties)
        .map(e => {
        let t = null;
        if (!!e[1].enum) {
            t = '[enum]';
        }
        else if (e[1].type) {
            if (Array.isArray(e[1].type)) {
                t = e[1].type.find(typ => typ !== 'null');
            }
            else {
                if (e[1].type === 'array') {
                    t = '[' + e[1].items['$ref'].split('/').pop() + ']';
                }
                else {
                    t = e[1].type;
                }
            }
        }
        if (e[1].anyOf) {
            t = e[1].anyOf
                .find(of => !!of['$ref'])['$ref'].split('/')
                .pop();
        }
        if (e[1]['$ref']) {
            t = e[1]['$ref'].split('/').pop();
        }
        return { name: e[0], type: t };
    })
        .filter(f => !scalars.find(s => s === f.type)),
}));
const args = (name, type) => {
    return `@Args({ nullable: true }) ${name}: FindMany${type
        .replace('[', '')
        .replace(']', '')}Args`;
};
module.exports = {
    rules: {
        'enforce-field-resolvers': {
            meta: {
                fixable: 'code',
                type: 'problem',
            },
            create: (context) => {
                return {
                    ClassDeclaration(node) {
                        var _a, _b;
                        const classNode = node;
                        const decorator = (_a = classNode.decorators) === null || _a === void 0 ? void 0 : _a.find(d => d.expression.callee.name === 'Resolver');
                        if (!decorator) {
                            console.info(`No Resolver in class: ${node.id.name}`);
                            return;
                        }
                        const decoratorName = (_b = decorator.expression.arguments.find(a => a.type === 'ArrowFunctionExpression')) === null || _b === void 0 ? void 0 : _b.body.name;
                        if (!decoratorName) {
                            console.warn(`No DecoratorName in class: ${node.id.name}. There should be an arrow function to resolve the resolvers type like "() => EntityType"`);
                            return;
                        }
                        const prismaEntity = prismaEntities.find(pe => pe.name === decoratorName);
                        if (!prismaEntity) {
                            console.warn(`Decorator ${decoratorName} not found in prisma file. Please add the entity to the prisma file`);
                            return;
                        }
                        const resolverMethods = classNode.body.body
                            .map((methodDefinition) => {
                            var _a;
                            return ({
                                ...methodDefinition,
                                decorator: (_a = methodDefinition.decorators) === null || _a === void 0 ? void 0 : _a.find(md => md.expression.callee.name === 'ResolveField'),
                            });
                        })
                            .filter(methodDefinition => !!methodDefinition.decorator);
                        const resolverNames = resolverMethods.map(rm => {
                            var _a, _b;
                            return (_b = (_a = rm.decorator.expression.arguments
                                .find(a => a.type === 'ObjectExpression')) === null || _a === void 0 ? void 0 : _a.properties.find(p => p.key.name === 'name')) === null || _b === void 0 ? void 0 : _b.value.value;
                        });
                        const openResolvers = prismaEntity.fields.filter(f => !resolverNames.find(rn => rn === f.name));
                        if (openResolvers.length >= 1) {
                            context.report({
                                node: node,
                                message: `${context.getCwd()}${context.getFilename()}: Following Resolvers are not implemented atm: 
                  ${openResolvers.map(or => or.name).join(', ')} 
                  
                  `,
                                fix: function (fixer) {
                                    const importNode = context
                                        .getSourceCode()
                                        .ast.body.find(i => i.type === 'ImportDeclaration' &&
                                        i.source.value.split('/').pop() ===
                                            'nestjs-graphql');
                                    const existingImports = importNode.specifiers.map(i => i.imported.name);
                                    const entityImports = openResolvers.map(r => r.type.replace('[', '').replace(']', ''));
                                    const findManyImports = openResolvers
                                        .filter(i => -1 !== i.type.indexOf('['))
                                        .map(r => r.type.replace('[', '').replace(']', ''))
                                        .map(i => 'FindMany' + i + 'Args');
                                    const newImports = [...entityImports, ...findManyImports];
                                    const missingImports = Array.from(new Set(newImports.filter(ni => !existingImports.includes(ni))));
                                    const importFixer = fixer.insertTextAfter(importNode.specifiers.pop(), missingImports.map(i => '\n,' + i).join(''));
                                    const txt = `\n\n\n  // FIELDRESOLVERS \n` +
                                        openResolvers
                                            .map(r => {
                                            const isToManyRelation = r.type[0] === '[';
                                            return `
  @ResolveField(() => ${r.type}, {
    name: '${r.name}',${isToManyRelation ? '' : '\n    nullable: true, \n'}
  })
  ${r.name}(@Parent() ${(0, camelcase_1.default)(decoratorName)}: ${decoratorName}, ${isToManyRelation ? args('args', r.type) + ', ' : ''}) {
    return this.${(0, camelcase_1.default)(decoratorName)}Service
      .findOne({
        id: ${(0, camelcase_1.default)(decoratorName)}.id,
      })
      .${r.name}(${isToManyRelation ? 'args' : ''});
  }
`;
                                        })
                                            .join('');
                                    const resolverFix = fixer.insertTextAfter(classNode.body.body.find(b => b.key.name === 'constructor'), txt);
                                    return [importFixer, resolverFix];
                                },
                            });
                        }
                    },
                };
            },
        },
    },
};
//# sourceMappingURL=index.js.map