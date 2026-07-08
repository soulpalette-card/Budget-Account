/** 大白话：Tailwind 是“用小标签写样式”的工具（比如 class="text-red-500" 就是红字）。
 *  这里告诉它去哪些文件里找我们用到的样式标签。 */
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
}
