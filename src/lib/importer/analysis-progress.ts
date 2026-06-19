type ProgressStream = Pick<NodeJS.WriteStream, 'write' | 'isTTY'>;

const phaseByEvent: Record<string, string> = {
	'thread.started': 'Codex started',
	'turn.started': 'Analyzing paragraph',
	'item.started': 'Preparing Word Help',
	'item.completed': 'Preparing Word Help',
	'turn.completed': 'Validating output'
};

export class TerminalAnalysisProgress {
	readonly #stream: ProgressStream;
	readonly #startedAt = Date.now();
	readonly #total: number;
	#completed: number;
	#paragraph = 0;
	#phase = 'Ready';
	#finished = false;

	constructor(total: number, completed = 0, stream: ProgressStream = process.stdout) {
		this.#stream = stream;
		this.#total = total;
		this.#completed = completed;
		this.#render();
	}

	paragraph(index: number): void {
		this.#paragraph = index + 1;
		this.#phase = 'Starting Codex';
		this.#render();
	}

	event(type: string): void {
		const phase = phaseByEvent[type];
		if (!phase || phase === this.#phase || this.#finished) return;
		this.#phase = phase;
		this.#render();
	}

	checkpoint(completed: number): void {
		this.#completed = completed;
		this.#phase = 'Checkpoint saved';
		this.#render();
	}

	complete(): void {
		this.#completed = this.#total;
		this.#finish('Complete');
	}

	fail(): void {
		this.#finish('Paused; checkpoint retained');
	}

	#finish(label: string): void {
		if (this.#finished) return;
		this.#finished = true;
		this.#phase = label;
		this.#render(true);
	}

	#render(final = false): void {
		const elapsed = Math.max(0, Math.round((Date.now() - this.#startedAt) / 1000));
		const percentage = this.#total === 0 ? 100 : Math.floor((this.#completed / this.#total) * 100);
		const width = 20;
		const filled = Math.floor((percentage / 100) * width);
		const bar = `${'='.repeat(filled)}${' '.repeat(width - filled)}`;
		const paragraph = this.#paragraph > 0 ? ` · paragraph ${this.#paragraph}/${this.#total}` : '';
		const line = `[analysis] [${bar}] ${this.#completed}/${this.#total} (${percentage}%)${paragraph} · ${this.#phase} · ${elapsed}s`;
		if (this.#stream.isTTY) this.#stream.write(`\r\u001b[2K${line}${final ? '\n' : ''}`);
		else this.#stream.write(`${line}\n`);
	}
}
