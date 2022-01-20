import camelcase from 'camelcase';
import { Rule } from 'eslint';
import { ClassDeclaration, MethodDefinition, Node } from 'estree';
import { readFileSync } from 'fs';

const entities: Entity = JSON.parse(
  readFileSync(`prisma/generated/json-schema.json`, 'utf-8'),
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

interface PrismaEntity {
  name: string;
  fields: {
    name: string;
    type: string;
  }[];
}

interface Entity {
  definitions: {
    [entityName: string]: {
      properties: {
        type: string | string[];
        anyOf: ({ $ref: string } | { type: string })[];
        items: { $ref: string }[];
      };
    };
  }[];
}

const scalars = [
  'string',
  'float',
  'integer',
  'object',
  'enum',
  'boolean',
  'number',
];

const prismaEntities: PrismaEntity[] = Object.entries(entities.definitions).map(
  e => ({
    name: e[0],
    fields: Object.entries(e[1].properties)
      .map(e => {
        let t = null;
        if (e[1].type) {
          if (Array.isArray(e[1].type)) {
            // check if it is an array :-O => more than one types possible
            t = e[1].type.find(typ => typ !== 'null');
          } else {
            if (e[1].type === 'array') {
              t = '[' + e[1].items['$ref'].split('/').pop() + ']';
            } else {
              t = e[1].type;
            }
          }
        }
        if (e[1].anyOf) {
          t = e[1].anyOf
            .find(of => !!of['$ref'])
            ['$ref'].split('/')
            .pop();
        }
        if (e[1]['$ref']) {
          t = e[1]['$ref'].split('/').pop();
        }
        return { name: e[0], type: t };
      })
      .filter(f => !scalars.find(s => s === f.type)),
  }),
);

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

      create: (context): Rule.RuleListener => {
        return {
          ClassDeclaration(node) {
            const classNode = node as DM<ClassDeclaration>;
            const decorator = classNode.decorators?.find(
              d => d.expression.callee.name === 'Resolver',
            ); // Assume that there is only one Class with Resolver Decorator => find

            // If there is no decorator => notify and quit Class inspection
            if (!decorator) {
              console.info(`No Resolver in class: ${node.id.name}`);
              return;
            }

            // Look for the decorator's name
            const decoratorName = decorator.expression.arguments.find(
              a => a.type === 'ArrowFunctionExpression',
            )?.body.name;

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
                node: node,
                message: `${context.getCwd()}${context.getFilename()}: Following Resolvers are not implemented atm: 
                  ${openResolvers.map(or => or.name).join(', ')} 
                  
                  `,
                fix: function (fixer) {
                  const imports = openResolvers.map(r =>
                    r.type.replace('[', '').replace(']', ''),
                  );
                  const multiImports = openResolvers
                    .filter(i => -1 !== i.type.indexOf('['))
                    .map(r => r.type.replace('[', '').replace(']', ''));
                  const importFix = fixer.insertTextBefore(
                    decorator as unknown as Node,
                    `import {
                      ${imports.join(', ')}, 
                      ${multiImports
                        .map(i => 'FindMany' + i + 'Args, ')
                        .join('')}
                    } from '@prisma/client/nestjs-graphql'
`,
                  );

                  const txt =
                    `\n\n\n  // FIELDRESOLVERS \n` +
                    openResolvers
                      .map(r => {
                        const isToManyRelation = r.type[0] === '[';

                        return `
  @ResolveField(() => ${r.type}, {
    name: '${r.name}',${isToManyRelation ? '' : '\n    nullable: true, \n'}
  })
  ${r.name}(@Parent() ${camelcase(decoratorName)}: ${decoratorName}, ${
                          isToManyRelation ? args('args', r.type) + ', ' : ''
                        }) {
    return this.${camelcase(decoratorName)}Service
      .findOne({
        id: ${camelcase(decoratorName)}.id,
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
                  return [importFix, resolverFix];
                },
              });
            }
          },
        };
      },
    } as Rule.RuleModule,
  },
};
