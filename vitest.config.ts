import { defineConfig } from 'vitest/config'
import { resolve } from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/unit/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text'],
      include: ['src/main/audio/**']
    }
  },
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
      '@main': resolve(__dirname, 'src/main')
    }
  }
})
