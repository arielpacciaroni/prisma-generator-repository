import { parseEnvValue, getDMMF } from '@prisma/internals'
import { GeneratorOptions, EnvValue } from '@prisma/generator-helper'
import { promises as fs } from 'fs'
import path from 'path'
import removeDir from './utils/removeDir'
import {
  CodeBlockWriter,
  Project,
  StructureKind,
  VariableDeclarationKind,
} from 'ts-morph'
import { camelCase, isUndefined } from 'lodash'

function toTitleCase(string: string): string {
  return string.charAt(0).toUpperCase() + string.slice(1)
}

export async function generate(options: GeneratorOptions) {
  const outputDir = parseEnvValue(options.generator.output as EnvValue)
  await fs.mkdir(outputDir, { recursive: true })
  await removeDir(outputDir, true)

  const project = new Project({})

  const prismaClientProvider = options.otherGenerators.find(
    it => parseEnvValue(it.provider) === 'prisma-client-js'
  )

  const prismaClientDmmf = await getDMMF({
    datamodel: options.datamodel,
    previewFeatures: prismaClientProvider?.previewFeatures,
  })

  for (const model of prismaClientDmmf.datamodel.models) {
    console.log(model)

    const modelName = camelCase(model.name)
    console.log(modelName)
    const modelDir = path.join(outputDir, modelName)

    await fs.mkdir(modelDir, { recursive: true })

    const modelFileRepository = path.join(
      modelDir,
      `${modelName}.repository.ts`
    )

    const hasModelId = model.fields.some(field => field.isId)
    const modelRelations = model.fields.filter(
      field => !isUndefined(field.relationName)
    )

    const classFunctions = [
      {
        name: 'create',
        returnType: `Promise<${model.name}>`,
        isAsync: true,
        parameters: [{ name: 'data', type: `Required${model.name}Fields` }],
        statements: (writer: CodeBlockWriter) => {
          writer.write(`return await prisma.${modelName}.create({ `)
          writer.write(`data`)
          writer.write(` })`)
        },
      },

      {
        name: 'getAll',
        returnType: `Promise<${model.name}[]>`,
        isAsync: true,
        statements: (writer: CodeBlockWriter) => {
          writer.write(`return await prisma.${modelName}.findMany()`)
        },
      },
    ]

    if (hasModelId) {
      classFunctions.push(
        {
          name: 'getById',
          returnType: `Promise<${model.name} | null>`,
          isAsync: true,
          parameters: [{ name: 'id', type: `${model.name}['id']` }],
          statements: (writer: CodeBlockWriter) => {
            writer.write(`return await prisma.${modelName}.findFirst({ `)
            writer.write(`where: { id }`)
            writer.write(` })`)
          },
        },
        {
          name: 'updateById',
          returnType: `Promise<${model.name} | null>`,
          isAsync: true,
          parameters: [
            { name: 'id', type: `${model.name}['id']` },
            { name: 'data', type: `Required${model.name}Fields` },
          ],
          statements: (writer: CodeBlockWriter) => {
            writer.write(`return await prisma.${modelName}.update({ `)
            writer.write(`where: { id }, data`)
            writer.write(` })`)
          },
        },
        {
          name: 'deleteById',
          returnType: `Promise<void>`,
          isAsync: true,
          parameters: [{ name: 'id', type: `${model.name}['id']` }],
          statements: (writer: CodeBlockWriter) => {
            writer.write(`await prisma.${modelName}.delete({ `)
            writer.write(`where: { id }`)
            writer.write(` })`)
          },
        }
      )
    }

    for (const relation of modelRelations) {
      classFunctions.push({
        name: `get${toTitleCase(modelName)}${toTitleCase(relation.name)}`,
        returnType: `Promise<${relation.type}[]>`,
        isAsync: true,
        parameters: [{ name: 'id', type: `${model.name}['id']` }],
        statements: (writer: CodeBlockWriter) => {
          writer.write(`const data = await prisma.${modelName}.findFirst({ `)
          writer.write(`where: { id }, select: { ${relation.name}: true }`)
          writer.write(` })`)
          writer.writeLine(`return data?.${relation.name} ?? []`)
        },
      })
    }

    const repositoryContent = project.createSourceFile(modelFileRepository, {
      statements: [
        {
          kind: StructureKind.ImportDeclaration,
          moduleSpecifier: '@prisma/client',
          namedImports: [
            'PrismaClient',
            model.name,
            ...modelRelations.map(relation => relation.type),
          ],
        },
        {
          kind: StructureKind.VariableStatement,
          isExported: false,
          declarationKind: VariableDeclarationKind.Const,
          declarations: [
            {
              kind: StructureKind.VariableDeclaration,
              initializer: writer => writer.write(`new PrismaClient()`),
              name: 'prisma',
            },
          ],
        },
        {
          kind: StructureKind.TypeAlias,
          name: `Required${model.name}Fields`,
          isExported: true,
          type: writer => {
            const fieldsWithDefaultValues = model.fields
              .filter(field => field.hasDefaultValue || field.isUpdatedAt)
              .map(field => `'${field.name}'`)

            if (!fieldsWithDefaultValues.length)
              return writer.write(`${model.name}`)

            const omitStatement = `Omit<${
              model.name
            }, ${fieldsWithDefaultValues.join(' | ')}>`
            writer.write(omitStatement)
          },
        },
        {
          kind: StructureKind.Class,
          name: `${model.name}Repository`,
          isExported: true,
          properties: [],
          methods: classFunctions,
        },
      ],
    })

    await fs.writeFile(modelFileRepository, repositoryContent.getFullText())
  }
}
