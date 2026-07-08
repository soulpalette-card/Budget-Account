// ============================================================================
// 文件摘要（main.tsx）—— 程序的“点火开关”
// ----------------------------------------------------------------------------
// 网页一打开，这里最先跑：把 React 应用塞进 index.html 里那个空盒子 <div id="root">。
// 顺便把样式(index.css)加载进来。真正的界面和路由在 App.tsx。
// ============================================================================

import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
