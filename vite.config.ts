// 大白话：Vite 是“开发服务器 + 打包工具”。这个文件是它的配置。
// 我们只加了一个 React 插件，让它认识 .tsx 文件里的 JSX 语法。
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
