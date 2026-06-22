import { afterEach, describe, expect, it, vi } from 'vitest';
import { TerminalAnalysisProgress } from './analysis-progress.ts';

function stream(isTTY: boolean) {
	let output = '';
	return {
		stream: {
			isTTY,
			write: (chunk: string | Uint8Array) => {
				output += String(chunk);
				return true;
			}
		},
		output: () => output
	};
}

describe('analysis progress', () => {
	afterEach(() => vi.useRealTimers());

	it('renders one aggregate live line for an interactive terminal', () => {
		const target = stream(true);
		const progress = new TerminalAnalysisProgress(6, 1, target.stream);
		progress.event({ type: 'batch-start', activeBatches: 2 });
		progress.event({
			type: 'batch-retry',
			keys: ['section-1:0'],
			retryCount: 1,
			activeBatches: 2,
			error: 'temporary'
		});
		progress.event({
			type: 'batch-complete',
			keys: ['section-1:0', 'section-1:1'],
			completedBlocks: 3,
			activeBatches: 1
		});
		progress.event({
			type: 'annotation-skipped',
			keys: ['section-1:1'],
			activeBatches: 1,
			errors: ['invalid quote a7']
		});
		progress.complete();

		expect(target.output()).toContain('1/6 blocks · 2 active · 0 retries');
		expect(target.output()).toContain('Retrying batch section-1:0: temporary');
		expect(target.output()).toContain('3/6 blocks · 1 active · 1 retries');
		expect(target.output()).toContain('Analysis complete');
		expect(target.output()).toContain(
			'Skipped invalid annotation in section-1:1: invalid quote a7'
		);
	});

	it('emits only durable events for captured output', () => {
		const target = stream(false);
		const progress = new TerminalAnalysisProgress(3, 0, target.stream);
		progress.event({ type: 'batch-start', activeBatches: 1 });
		expect(target.output()).toBe('');
		progress.event({
			type: 'batch-complete',
			keys: ['section-1:0'],
			completedBlocks: 1,
			activeBatches: 0
		});
		progress.fail();

		expect(target.output()).toContain('Batch complete: section-1:0');
		expect(target.output()).toContain('Analysis paused; checkpoints retained');
		expect(target.output()).not.toContain('active');
	});

	it('keeps elapsed time moving while Codex is active', () => {
		vi.useFakeTimers();
		const target = stream(true);
		const progress = new TerminalAnalysisProgress(6, 0, target.stream);
		progress.event({ type: 'batch-start', activeBatches: 1 });

		vi.advanceTimersByTime(2_100);
		progress.interrupted();

		expect(target.output()).toContain('0/6 blocks · 1 active · 0 retries · 2s');
	});
});
