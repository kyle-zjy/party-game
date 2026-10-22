import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages 把仓库部署在 https://<user>.github.io/<repo>/ 这个子路径下，
  // 不是域名根路径，所以资源引用需要加上这个前缀。
  // 配合 App.tsx 里的 HashRouter 使用：HashRouter 本身不受 base 影响，
  // 但静态资源（JS/CSS）的路径需要这个配置才能在子路径下正确加载。
  // 预发布构建可以用 VITE_BASE=/party-game-staging/ 换一个子路径，正式构建默认仍是 /party-game/。
  // 资源路径在构建时写死进 index.html / JS，所以换路径必须重新构建，不能把现有 dist 复制到别的目录。
  base: process.env.VITE_BASE ?? '/party-game/',
})
