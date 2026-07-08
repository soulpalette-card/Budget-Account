/// <reference types="vite/client" />

// 大白话：这段是告诉 TypeScript：“我们会用到这两个环境变量”，
// 这样写代码时 import.meta.env.VITE_SUPABASE_URL 才不会报红字。
interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string
  readonly VITE_SUPABASE_ANON_KEY: string
}
interface ImportMeta {
  readonly env: ImportMetaEnv
}
