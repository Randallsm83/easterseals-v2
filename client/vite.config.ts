import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { realpathSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const clientDir = dirname(fileURLToPath(import.meta.url))
const repoDir = resolve(clientDir, '..')
const workspaceDir = process.cwd()
const workspaceRepoDir = resolve(workspaceDir, '..')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      allow: [
        workspaceDir,
        workspaceRepoDir,
        clientDir,
        repoDir,
        realpathSync(workspaceDir),
        realpathSync(workspaceRepoDir),
        realpathSync(clientDir),
        realpathSync(repoDir),
      ],
    },
  },
})
