import { describe, expect, it } from 'vitest';
import { TerminalAnalysisProgress } from './analysis-progress.ts';

describe('analysis progress', () => {
	it('renders saved paragraph progress for an interactive terminal', () => {
		let output = '';
		const progress = new TerminalAnalysisProgress(4, 1, {
			isTTY: true,
			write: (chunk) => {
				output += String(chunk);
				return true;
			}
		});
		progress.paragraph(1);
		progress.event('thread.started');
		progress.checkpoint(2);
		progress.complete();

		expect(output).toContain('[=====               ] 1/4 (25%)');
		expect(output).toContain('paragraph 2/4');
		expect(output).toContain('Codex started');
		expect(output).toContain('[==========          ] 2/4 (50%)');
		expect(output).toContain('[====================] 4/4 (100%)');
	});

	it('prints durable phase lines for captured output', () => {
		let output = '';
		const progress = new TerminalAnalysisProgress(3, 0, {
			isTTY: false,
			write: (chunk) => {
				output += String(chunk);
				return true;
			}
		});
		progress.paragraph(0);
		progress.event('thread.started');
		progress.event('item.started');
		progress.fail();

		expect(output).toContain('0/3 (0%)');
		expect(output).toContain('paragraph 1/3');
		expect(output).toContain('Codex started');
		expect(output).toContain('Preparing Word Help');
		expect(output).toContain('Paused; checkpoint retained');
	});
});
