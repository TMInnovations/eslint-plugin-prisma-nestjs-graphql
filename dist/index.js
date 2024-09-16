"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const strings_1 = require("@angular-devkit/core/src/utils/strings");
const fs_1 = require("fs");
const dmmf = JSON.parse((0, fs_1.readFileSync)(`prisma/generated/dmmf.json`, 'utf-8'));
const prismaEntities = dmmf.datamodel.models.map(m => {
    return {
        name: m.name,
        idFieldName: m.fields.find(f => f.isId)?.name,
        fields: m.fields.filter(f => !['scalar', 'enum'].includes(f.kind)),
    };
});
const args = (name, type) => {
    return `@Args({ nullable: true }) ${name}: FindMany${type}ArgsWithSoftDelete`;
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
                        const classNode = node;
                        const decorator = classNode.decorators?.find(d => d.expression.callee.name === 'Resolver');
                        if (!decorator) {
                            return;
                        }
                        const decoratorName = decorator.parent.id.name.replace('Resolver', '');
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
                            .map((methodDefinition) => ({
                            ...methodDefinition,
                            decorator: methodDefinition.decorators?.find(md => md.expression.callee.name === 'ResolveField'),
                        }))
                            .filter(methodDefinition => !!methodDefinition.decorator);
                        const resolverNames = resolverMethods.map(rm => rm.decorator.expression.arguments
                            .find(a => a.type === 'ObjectExpression')
                            ?.properties.find(p => p.key.name === 'name')?.value.value);
                        const openResolvers = prismaEntity.fields.filter(f => !resolverNames.find(rn => rn === f.name));
                        if (openResolvers.length >= 1) {
                            context.report({
                                node: node.id,
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
                                    const entityImports = openResolvers.map(r => r.type);
                                    const newImports = entityImports;
                                    const missingImports = Array.from(new Set(newImports.filter(ni => !existingImports.includes(ni))));
                                    const importFixer = fixer.insertTextAfter(importNode.specifiers.pop(), missingImports.map(i => ',\n    ' + i).join(''));
                                    const importNodeNestjsGraphql = context
                                        .getSourceCode()
                                        .ast.body.find(i => i.type === 'ImportDeclaration' &&
                                        i.source.value === '@nestjs/graphql');
                                    const findManyImportsFixer = fixer.insertTextAfter(importNodeNestjsGraphql, '\n\n// FindMany[Entity]ArgsWithSoftDelete' +
                                        openResolvers
                                            .filter(r => r.isList)
                                            .filter(r => {
                                            const importName = 'FindMany' + r.type + 'ArgsWithSoftDelete';
                                            const imported = context
                                                .getSourceCode()
                                                .ast.body.filter(i => i.type === 'ImportDeclaration').find(i => {
                                                return i.specifiers.find(s => s.imported.name === importName);
                                            });
                                            return !imported;
                                        })
                                            .map(r => '\nimport { FindMany' +
                                            r.type +
                                            "ArgsWithSoftDelete } from '../" +
                                            (0, strings_1.camelize)(r.type) +
                                            '/' +
                                            (0, strings_1.camelize)(r.type) +
                                            ".resolver';")
                                            .join('') +
                                        '\n');
                                    const existingImportsNestjsGraphql = importNodeNestjsGraphql.specifiers.map(i => i.imported.name);
                                    const newImportsNestjsGraphql = ['ResolveField', 'Parent'];
                                    const missingImportsNestjsGraphql = Array.from(new Set(newImportsNestjsGraphql.filter(ni => !existingImportsNestjsGraphql.includes(ni))));
                                    const importFixerNestjsGraphql = fixer.insertTextAfter(importNodeNestjsGraphql.specifiers.pop(), missingImportsNestjsGraphql
                                        .map(i => ',\n    ' + i)
                                        .join(''));
                                    const txt = `\n\n\n  // FIELDRESOLVERS \n` +
                                        openResolvers
                                            .map(r => {
                                            const isToManyRelation = r.isList;
                                            return `
  @CheckPermissions()
  @ResolveField(() => ${isToManyRelation ? '[' + r.type + ']' : r.type}, {
    name: '${r.name}',${isToManyRelation ? '' : '\n    nullable: true'}
  })
  ${r.name}(@Parent() entity: Entity, ${isToManyRelation ? args('args', r.type) + ', ' : ''}): Promise<${isToManyRelation ? r.type + '[]' : r.type}> {
    return this.service
      .findUnique({
        ${prismaEntity.idFieldName}: entity.${prismaEntity.idFieldName},
      })
      .${r.name}(${isToManyRelation ? 'args' : ''});
  }
`;
                                        })
                                            .join('');
                                    const resolverFix = fixer.insertTextAfter(classNode.body.body.find(b => b.key.name === 'constructor'), txt);
                                    return [
                                        importFixer,
                                        importFixerNestjsGraphql,
                                        resolverFix,
                                        findManyImportsFixer,
                                    ];
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