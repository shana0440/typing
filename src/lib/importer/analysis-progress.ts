import type { AnalysisEvent } from './analyze.ts';

type ProgressStream = Pick<NodeJS.WriteStream, 'write' | 'isTTY'>;

export class TerminalAnalysisProgress {
	readonly #stream: ProgressStream;
	readonly #startedAt = Date.now();
	readonly #total: number;
	#completed: number;
	#active = 0;
	#retries = 0;
	#finished = false;
	#heartbeat: ReturnType<typeof setInterval> | undefined;

	constructor(total: number, completed = 0, stream: ProgressStream = process.stdout) {
		this.#stream = stream;
		this.#total = total;
		this.#completed = completed;
		if (this.#stream.isTTY) {
			this.#render();
			this.#heartbeat = setInterval(() => this.#render(), 1_000);
			this.#heartbeat.unref?.();
		}
	}

	event(event: AnalysisEvent): void {
		if (this.#finished) return;
		this.#active = event.activeBatches;
		if (event.type === 'batch-start') {
			this.#render();
			return;
		}
		if (event.type === 'batch-complete') {
			this.#completed = event.completedBlocks;
			this.#durable(`Batch complete: ${event.keys.join(', ')}`);
		} else if (event.type === 'annotation-skipped') {
			this.#durable(
				`Skipped invalid annotation in ${event.keys.join(', ')}: ${event.errors.join('; ')}`
			);
		} else if (event.type === 'batch-retry') {
			this.#retries = event.retryCount;
			this.#durable(`Retrying batch ${event.keys.join(', ')}: ${event.error}`);
		} else {
			this.#durable(`Batch failed ${event.keys.join(', ')}: ${event.error}`);
		}
		this.#render();
	}

	complete(): void {
		this.#finish('Analysis complete');
	}
	fail(): void {
		this.#finish('Analysis paused; checkpoints retained');
	}
	interrupted(): void {
		this.#finish('Analysis interrupted; checkpoints retained');
	}

	#finish(label: string): void {
		if (this.#finished) return;
		this.#finished = true;
		if (this.#heartbeat) clearInterval(this.#heartbeat);
		this.#active = 0;
		this.#durable(label);
	}

	#durable(message: string): void {
		if (this.#stream.isTTY) this.#stream.write('\r\u001b[2K');
		this.#stream.write(`[analysis] ${message}\n`);
	}

	#render(): void {
		if (!this.#stream.isTTY || this.#finished) return;
		const elapsed = Math.max(0, Math.round((Date.now() - this.#startedAt) / 1000));
		this.#stream.write(
			`\r\u001b[2K[analysis] ${this.#completed}/${this.#total} blocks · ${this.#active} active · ${this.#retries} retries · ${elapsed}s`
		);
	}
}
