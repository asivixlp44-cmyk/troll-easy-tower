import { defineConfig } from 'vite';

export default defineConfig({
    // shared/ lives next to client/ and is imported by both client and server
    server: { fs: { allow: ['..'] }, port: 5203 },
    build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
});
