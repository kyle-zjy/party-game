/**
 * 用 esbuild 把 `src/index.ts` 连同它引用的 `../../shared/*`
 * 一起打包成单个 `dist/index.js`。
 *
 * 为什么需要这步，而不是直接 `tsc` 输出：
 * `shared/` 目录在 `functions/room/` 外面（和 frontend 共用），
 * 而 CloudBase 部署时只会上传配置的函数目录，不会把仓库根目录的
 * `shared/` 一起带上。打包成一个文件能避免"部署后发现 shared 模块找不到"的问题。
 *
 * @cloudbase/js-sdk 保持 external：由 CloudBase 运行时按
 * dist/package.json 的 dependencies 自动安装（需要在 cloudbaserc.json
 * 里给这个函数开 installDependency: true），不打包进 bundle 本身。
 *
 * ## 为什么要显式声明 @cloudbase/signature-nodejs（真实排查发现的问题）
 *
 * 反编译 `@cloudbase/js-sdk@3.10.2` 的 Node 构建产物确认：显式传入
 * `secretId`/`secretKey`（本项目在 `cloudbase-app.ts` 里为了绕开
 * `CLOUDBASE_APIKEY` 优先级问题而这么做）之后，Node 环境下给请求签名
 * 用的是 `@cloudbase/signature-nodejs` 这个包，SDK 通过内部的
 * `optionalRequire()` 按需加载它，加载失败时**不抛异常**，只是打一行
 * `console.error`（"缺少依赖 @cloudbase/signature-nodejs，请执行以下
 * 命令安装：npm install @cloudbase/signature-nodejs，该依赖用于 Node
 * 环境下的请求签名"）然后把签名函数设为 `null`——下游拿到 `null` 再调用
 * 会导致请求失败，但失败的具体现象（报错信息/错误码）目前没有在本地
 * 复现确认。
 *
 * 问题在于：`@cloudbase/signature-nodejs` 在 `@cloudbase/js-sdk` 自己的
 * `package.json` 里是 **`optionalDependencies`**（不是 `dependencies`），
 * 而 npm 的 `optionalDependencies` 设计成"装不上也不影响整体安装成功"——
 * 如果 CloudBase 云端的 `installDependency: true` 机制在执行 npm 安装时
 * 用了跳过可选依赖的参数（比如 `--no-optional`），或者目标 Node 版本/
 * 平台导致这个可选依赖安装失败，`dist/package.json` 原来只声明
 * `@cloudbase/js-sdk` 作为依赖的话，并不保证这个传递性的可选依赖一定会
 * 被装上。**这是否是本次 `dbConnected: false` 的真正原因，本地没有
 * 办法 100% 确认**（本地 `node_modules` 里这个包已经装好了，没有一个
 * 干净的、只装 regular dependencies 的环境可以复现"装不上会发生什么"）。
 *
 * 处理方式：把 `@cloudbase/signature-nodejs` 从"依赖 js-sdk 的可选依赖
 * 传递性安装"改成在 `dist/package.json` 里**显式声明为普通依赖**，
 * 这样不管 CloudBase 云端的 npm 安装是否跳过可选依赖，这个包都会被
 * 作为一等依赖项安装。不是凭空猜测加的——是反编译确认"这个包是 Node
 * 环境下 secretId/secretKey 签名链路的必需组件"之后，针对
 * "它只是可选依赖"这个具体风险点做的有依据的加固。
 *
 * 部署目标是 `dist/` 这个目录本身，而不是 `functions/room/`——
 * 后者还包含 src/、test/、未打包的 package.json 等不应该上传的内容。
 * 所以这里额外在 dist/ 下生成一个"干净"的 package.json，
 * 只声明运行时真正需要的依赖，cloudbaserc.json 的 `dir` 字段指向这个目录。
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
      name: 'room',
      version: '1.0.0',
      private: true,
      main: 'index.js',
      dependencies: {
        '@cloudbase/js-sdk': '3.10.2',
        // 本来是 @cloudbase/js-sdk 的 optionalDependency，Node 环境下
        // secretId/secretKey 请求签名的必需组件——显式声明成普通依赖，
        // 避免云端安装时因为"可选依赖"的语义被跳过。详见上面的注释。
        '@cloudbase/signature-nodejs': '2.0.0',
      },
    },
    null,
    2,
  ) + '\n',
)

