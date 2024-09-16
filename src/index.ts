import { camelize } from '@angular-devkit/core/src/utils/strings';
import { DMMF } from '@prisma/generator-helper';
import { Rule } from 'eslint';
import {
  ClassDeclaration,
  ImportDeclaration,
  ImportSpecifier,
  MethodDefinition,
} from 'estree';
import { readFileSync } from 'fs';

const dmmf: DMMF.Document = JSON.parse(
  readFileSync(`prisma/generated/dmmf.json`, 'utf-8'),
);

type DM<T> = T &
  Rule.NodeParentExtension & {
    decorators: {
      expression: {
        arguments: {
          properties: { value: { value: string }; key: { name: string } }[];
          type: string;
          body: { name: string };
        }[];
        callee: { name: string };
      };
    }[];
    key: { name: string };
  };

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

      create: (context): Rule.RuleListener => {
        return {
          ClassDeclaration(node) {
            const classNode = node as DM<ClassDeclaration>;
            const decorator = classNode.decorators?.find(
              d => d.expression.callee.name === 'Resolver',
            ); // Assume that there is only one Class with Resolver Decorator => find

            // If there is no decorator => notify and quit Class inspection
            if (!decorator) {
              // console.info(`No Resolver in class: ${node.id.name}`);
              return;
            }

            // Look for the decorator's name
            // @ts-ignore
            const decoratorName = decorator.parent.id.name.replace(
              'Resolver',
              '',
            );

            // If there is no decoratorName => notify and quit Class inspection
            if (!decoratorName) {
              console.warn(
                `No DecoratorName in class: ${node.id.name}. There should be an arrow function to resolve the resolvers type like "() => EntityType"`,
              );
              return;
            }

            // Find the decorator's name in the prisma file
            const prismaEntity = prismaEntities.find(
              pe => pe.name === decoratorName,
            );

            // If there is no prisma entry for the decoratorName => notify and quit Class inspection
            if (!prismaEntity) {
              console.warn(
                `Decorator ${decoratorName} not found in prisma file. Please add the entity to the prisma file`,
              );
              return;
            }

            // Get all Resolvers of the class and extract the ResolveField decorator (All Methods with ResolveField Decorator)
            const resolverMethods = classNode.body.body
              .map((methodDefinition: DM<MethodDefinition>) => ({
                ...methodDefinition,
                decorator: methodDefinition.decorators?.find(
                  md => md.expression.callee.name === 'ResolveField',
                ),
              }))
              .filter(methodDefinition => !!methodDefinition.decorator);

            const resolverNames = resolverMethods.map(
              rm =>
                rm.decorator.expression.arguments
                  .find(a => a.type === 'ObjectExpression')
                  ?.properties.find(p => p.key.name === 'name')?.value.value,
            );

            // Let's check for the prismaEntitys relations

            const openResolvers = prismaEntity.fields.filter(
              f => !resolverNames.find(rn => rn === f.name),
            );

            if (openResolvers.length >= 1) {
              context.report({
                node: node.id,
                message: `${context.getCwd()}${context.getFilename()}: Following Resolvers are not implemented atm: 
                  ${openResolvers.map(or => or.name).join(', ')} 
                  
                  `,
                fix: function (fixer) {
                  const importNode = context
                    .getSourceCode()
                    .ast.body.find(
                      i =>
                        i.type === 'ImportDeclaration' &&
                        (i.source.value as string).split('/').pop() ===
                          'nestjs-graphql',
                    ) as ImportDeclaration;

                  const existingImports = (
                    importNode.specifiers as ImportSpecifier[]
                  ).map(i => i.imported.name);

                  const entityImports = openResolvers.map(r => r.type);

                  const newImports = entityImports;

                  const missingImports = Array.from(
                    new Set(
                      newImports.filter(ni => !existingImports.includes(ni)),
                    ),
                  );

                  const importFixer = fixer.insertTextAfter(
                    importNode.specifiers.pop(),
                    missingImports.map(i => ',\n    ' + i).join(''),
                  );

                  // create a new import statement for related reltation resolvers

                  const importNodeNestjsGraphql = context
                    .getSourceCode()
                    .ast.body.find(
                      i =>
                        i.type === 'ImportDeclaration' &&
                        (i.source.value as string) === '@nestjs/graphql',
                    ) as ImportDeclaration;

                  const findManyImportsFixer = fixer.insertTextAfter(
                    importNodeNestjsGraphql,
                    '\n\n// FindMany[Entity]ArgsWithSoftDelete' +
                      openResolvers
                        // check if already imported
                        .filter(r => r.isList)
                        .filter(r => {
                          const importName =
                            'FindMany' + r.type + 'ArgsWithSoftDelete';
                          const imported = (
                            context
                              .getSourceCode()
                              .ast.body.filter(
                                i => i.type === 'ImportDeclaration',
                              ) as ImportDeclaration[]
                          ).find(i => {
                            return (i.specifiers as ImportSpecifier[]).find(
                              s => s.imported.name === importName,
                            );
                          });
                          return !imported;
                        })
                        .map(
                          r =>
                            '\nimport { FindMany' +
                            r.type +
                            "ArgsWithSoftDelete } from '../" +
                            camelize(r.type) +
                            '/' +
                            camelize(r.type) +
                            ".resolver';",
                        )
                        .join('') +
                      '\n',
                  );

                  const existingImportsNestjsGraphql = (
                    importNodeNestjsGraphql.specifiers as ImportSpecifier[]
                  ).map(i => i.imported.name);

                  const newImportsNestjsGraphql = ['ResolveField', 'Parent'];

                  const missingImportsNestjsGraphql = Array.from(
                    new Set(
                      newImportsNestjsGraphql.filter(
                        ni => !existingImportsNestjsGraphql.includes(ni),
                      ),
                    ),
                  );

                  const importFixerNestjsGraphql = fixer.insertTextAfter(
                    importNodeNestjsGraphql.specifiers.pop(),
                    missingImportsNestjsGraphql
                      .map(i => ',\n    ' + i)
                      .join(''),
                  );

                  const txt =
                    `\n\n\n  // FIELDRESOLVERS \n` +
                    openResolvers
                      .map(r => {
                        const isToManyRelation = r.isList;

                        return `
  @CheckPermissions()
  @ResolveField(() => ${isToManyRelation ? '[' + r.type + ']' : r.type}, {
    name: '${r.name}',${isToManyRelation ? '' : '\n    nullable: true'}
  })
  ${r.name}(@Parent() entity: Entity, ${
                          isToManyRelation ? args('args', r.type) + ', ' : ''
                        }): Promise<${
                          isToManyRelation ? r.type + '[]' : r.type
                        }> {
    return this.service
      .findUnique({
        ${prismaEntity.idFieldName}: entity.${prismaEntity.idFieldName},
      })
      .${r.name}(${isToManyRelation ? 'args' : ''});
  }
`;
                      })
                      .join('');

                  const resolverFix = fixer.insertTextAfter(
                    // @ts-ignore
                    classNode.body.body.find(b => b.key.name === 'constructor'),
                    txt,
                  );
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
