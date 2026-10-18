import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { RoomPage } from './pages/RoomPage'
import { GamePage } from './pages/GamePage'
import { HelloTestPage } from './pages/HelloTestPage'
import { DbTestPage } from './pages/DbTestPage'
import { RoomProvider } from './room/RoomProvider'
import { GameRoomHomePage } from './pages/GameRoomHomePage'
import { GameRoomLobbyPage } from './pages/GameRoomLobbyPage'
import { GameRoomProvider } from './gameRoom/GameRoomProvider'

/**
 * 用 HashRouter 而不是 BrowserRouter：GitHub Pages 不支持 SPA 的
 * history fallback，/#/room/123456 这种带 hash 的路由刷新不会 404。
 *
 * ## 正式玩家入口：`/` -> `GameRoomHomePage`（前端直连 game_rooms），不再是
 * 旧模型的 `HomePage`
 *
 * 【修复记录】之前 `/`（默认首页）渲染的是 `HomePage.tsx`，它调用
 * `lib/api.ts` 里 `createRoom`/`joinRoom` 这些函数，这些函数最终
 * `callFunction('room', ...)`——也就是还在调用已经被阶段 B/C 弃用的
 * `room` 云函数。这个云函数从阶段 B 开始就没有再维护或部署修复
 * （`docs/next-remote-steps.md` 记录的 `INVALID_CREDENTIALS` 等一系列
 * 数据库连接问题从未真正解决，阶段 B 之后项目方向整体转向了前端直连
 * `game_rooms` 数据库），所以访问 `/` 点"创建房间"必然卡在"服务器内部
 * 错误"——这不是文案问题，是正式入口链接到了一条事实上已经停止维护的
 * 代码路径。
 *
 * 现在 `/` 直接渲染 `GameRoomHomePage`（阶段 B/C 用的新入口，调用
 * `lib/gameRoomDb.ts`，前端直连 `game_rooms`），`/mp` 保留作为同一个页面的
 * 别名（不删除，避免已经分享出去的 `/#/mp` 链接失效）。`HomePage`/
 * `RoomPage`/`GamePage`（旧模型）和 `room` 云函数本身都不删除、不修改，
 * 仍然可以通过 `/room/:code`、`/game/:code` 直接访问（见下面的兼容路由），
 * 但不再是任何正常玩家会从首页点进去的路径。
 *
 * /room/:roomCode 和 /game/:roomCode 共享同一个 RoomProvider 实例
 * （无路径的父路由 + Outlet），而不是各自包一层 <RoomProvider>——
 * 后者会导致从 /room 导航到 /game 时 RoomProvider 被卸载重建，
 * 进而把 watch 关掉重开，违反"一个房间最多一个 watch"的设计前提。
 * 父路由不变 + roomCode 参数值不变，React Router 不会重新挂载它，
 * 真正发生切换的只是 Outlet 里的 RoomPage -> GamePage。
 */
function App() {
  return (
    <HashRouter>
      <Routes>
        {/* 正式入口：阶段 B/C 的 game_rooms 直连系统，/mp 是同一个页面的别名 */}
        <Route path="/" element={<GameRoomHomePage />} />
        <Route path="/mp" element={<GameRoomHomePage />} />
        <Route element={<GameRoomProvider />}>
          <Route path="/mp/:roomCode" element={<GameRoomLobbyPage />} />
        </Route>

        <Route path="/dev/hello" element={<HelloTestPage />} />
        <Route path="/dev/dbtest" element={<DbTestPage />} />

        {/* 兼容路由：旧模型（room 云函数 + ADMINONLY 的 rooms/players 集合）
            不删除、不修改，但不再是正常玩家的主入口——没有任何首页按钮、
            导航链接会把玩家带到这里，只有知道具体 URL 的人能访问到，
            且访问后会立刻看到 room 云函数的真实报错（不伪装成可用）。 */}
        <Route element={<RoomProvider />}>
          <Route path="/room/:roomCode" element={<RoomPage />} />
          <Route path="/game/:roomCode" element={<GamePage />} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </HashRouter>
  )
}

export default App
