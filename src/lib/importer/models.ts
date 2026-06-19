import { spawn } from 'node:child_process';
import { ImportError } from './extract.ts';

export type CodexModel = {
	model: string;
	displayName: string;
	description: string;
	isDefault: boolean;
};

export function listCodexModels(
	command = process.env.CODEX_COMMAND || 'codex'
): Promise<CodexModel[]> {
	return new Promise((resolve, reject) => {
		const child = spawn(command, ['app-server', '--stdio'], { stdio: ['pipe', 'pipe', 'pipe'] });
		let stdout = '';
		let stderr = '';
		let settled = false;
		const timeout = setTimeout(
			() => finish(new ImportError('Timed out while loading available Codex models.')),
			10_000
		);

		function finish(error?: Error, models?: CodexModel[]) {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			child.kill();
			if (error) reject(error);
			else resolve(models ?? []);
		}

		function send(message: unknown) {
			child.stdin.write(`${JSON.stringify(message)}\n`);
		}

		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
			const lines = stdout.split('\n');
			stdout = lines.pop() ?? '';
			for (const line of lines) {
				let message: { id?: unknown; result?: unknown; error?: unknown };
				try {
					message = JSON.parse(line);
				} catch {
					continue;
				}
				if (message.id === 1) {
					if (message.error) {
						finish(new ImportError('Codex app-server initialization failed.'));
						return;
					}
					send({ method: 'initialized', params: {} });
					send({ method: 'model/list', id: 2, params: { includeHidden: false, limit: 100 } });
				} else if (message.id === 2) {
					const result = message.result as { data?: unknown } | undefined;
					if (!Array.isArray(result?.data)) {
						finish(new ImportError('Codex returned a malformed model list.'));
						return;
					}
					const models = result.data.filter(isCodexModel);
					if (models.length === 0) {
						finish(new ImportError('Codex did not report any available models.'));
						return;
					}
					finish(undefined, models);
				}
			}
		});
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk: string) => (stderr += chunk));
		child.stdin.on('error', () => {
			// The child error/close handlers provide the actionable failure.
		});
		child.on('error', (error) =>
			finish(new ImportError(`Could not start Codex to list models: ${error.message}`))
		);
		child.on('close', (code) => {
			if (!settled) {
				finish(
					new ImportError(
						`Codex model listing failed${stderr.trim() ? `: ${stderr.trim()}` : ` with exit code ${code}`}`
					)
				);
			}
		});

		send({
			method: 'initialize',
			id: 1,
			params: {
				clientInfo: { name: 'typing_practice', title: 'Typing Practice', version: '0.0.1' }
			}
		});
	});
}

function isCodexModel(value: unknown): value is CodexModel {
	if (!value || typeof value !== 'object') return false;
	const model = value as Partial<CodexModel> & { hidden?: unknown };
	return (
		typeof model.model === 'string' &&
		model.model.length > 0 &&
		typeof model.displayName === 'string' &&
		typeof model.description === 'string' &&
		typeof model.isDefault === 'boolean' &&
		model.hidden !== true
	);
}
