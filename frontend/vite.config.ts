import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  // GitHub Pages 把仓库部署在 https://<user>.github.io/<repo>/ 这个子路径下，
  // 不是域名根路径，所以资源引用需要加上这个前缀。
  // 配合 App.tsx 里的 HashRouter 使用：HashRouter 本身不受 base 影响，
  // 但静态资源（JS/CSS）的路径需要这个配置才能在子路径下正确加载。
  base: '/party-game/',
})
