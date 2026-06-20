import { defineConfig } from '@playwright/test';

const basePath = process.env.BASE_PATH ?? '';

export default defineConfig({
	webServer: {
		command: 'npm run build && npm run preview -- --host 127.0.0.1',
		port: 4173
	},
	use: { baseURL: `http://127.0.0.1:4173${basePath}/` },
	testMatch: '**/*.e2e.{ts,js}'
});
