# eslint-plugin-prisma-nestjs-graphql-helper

## Goal of the plugin (p):

- I always forgot some field-resolvers in my graphql resolver files.
- I wrote myself a little eslint p to check the prisma.schema entities' relations against the field resolvers in my files.
- Additionally, the p can auto-fix missing resolvers (means it inserts them (quite) the right way).
- Together with `lint --fix` it can auto-generate all your (basic) field resolvers.
- So the overall goal is to save you and me from error-prone, manual field resolver coding.
- This p will (atm) not check if you implemented all models of your prisma file, just if there is a model resolver => it will check if the field resolvers are there

## How to use the p:

- It needs you to also use https://www.npmjs.com/package/prisma-json-schema-generator as generator for your prisma setup.
- The p will look for a file called `prisma/generated/json-schema.json` which should be generated by the prisma-json-schema-generator
- Therefore the generator should look somewhat like that:

```
...
generator jsonSchema {
  provider = "prisma-json-schema-generator"
  output   = "./generated/"
}
...
```

- Your resolver files should reside in a folder

## Known issues

- Imports are added automatically (and naively) => if an import in a resolver file already exists before linting and the same one gets added by the linter => it will exist twice => error
  - Just delete the second (generated) import.

## Related Plugins / Repos / Topics

prisma-nestjs-graphql resource generator: LINK
