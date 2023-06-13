import { generatorHandler } from '@prisma/generator-helper'
import { generate } from './generator'

generatorHandler({
  onManifest: () => ({
    defaultOutput: './generated',
    prettyName: 'Prisma Repository Generator',
    requiresGenerators: ['prisma-client-js'],
  }),
  onGenerate: generate,
})
