// vite.config.js
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// user/pass để Vite gắn Basic Auth khi proxy
const CCTV_USER = "root";
const CCTV_PASS = "admin123456789";
const BASIC_AUTH =
  "Basic " + Buffer.from(`${CCTV_USER}:${CCTV_PASS}`).toString("base64");

export default defineConfig({
  base: './', // Change to relative path for asset loading anywhere
  plugins: [react()],
  optimizeDeps: {
    include: [
      'react-icons/fa',
      'react-icons/gi',
      'react-icons/tb',
      'react-icons/bs',
      'react-icons/fi',
      'react-icons/io',
      'react-icons/wi'
    ]
  },
  server: {
    host: "0.0.0.0", // cho các máy LAN truy cập
    port: 5173,
    // proxy: {
    //   // mọi request bắt đầu bằng /cctv sẽ được proxy sang IP camera
    //   "/cctv": {
    //     target: "http://10.13.14.13",
    //     changeOrigin: true,
    //     secure: false,
    //     // rewrite /cctv/... => ... (giữ nguyên phần sau)
    //     rewrite: (path) => path.replace(/^\/cctv/, ""),
    //     headers: {
    //       // gắn Basic Auth ở Vite (backend), browser không thấy
    //       Authorization: BASIC_AUTH,
    //     },
    //   },
    // },
  },
});
