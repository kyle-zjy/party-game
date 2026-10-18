/**
 * hello 函数不依赖 shared/，esbuild 主要是为了和 room 函数保持一致的构建方式，
 * 同时把 TS 编译成单个 CJS 文件，方便直接部署。
 *
 * 部署目标是 `dist/` 这个目录本身（见 cloudbaserc.json 的 `dir` 字段），
 * 所以这里额外生成一个"干净"的 package.json，只声明运行时真正需要的依赖。
 */
import { build } from 'esbuild'
import { writeFileSync } from 'node:fs'

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/index.js',
  external: ['@cloudbase/js-sdk'],
  logLevel: 'info',
})

writeFileSync(
  'dist/package.json',
  JSON.stringify(
    {
      name: 'hello',
      version: '1.0.0',
      private: true,
      main: 'index.js',
      dependencies: {
        '@cloudbase/js-sdk': '3.10.2',
      },
    },
    null,
    2,
  ) + '\n',
)
