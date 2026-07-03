import { describe, expect, test } from 'bun:test';
import { normalizeScheduleTasks, normalizeScheduleTasksFromMarkdown } from './schedule-model.ts';
import { renderConstructionSchedulePng, renderConstructionScheduleSvg } from './schedule-renderer.ts';

const scheduleMarkdown = [
  '| WBS | Task | Baseline Start | Baseline Finish | Current Start | Current Finish | Progress % | Critical | Milestone | Dependencies |',
  '| --- | --- | --- | --- | --- | --- | ---: | --- | --- | --- |',
  '| 1 | Earthworks | 2026-07-01 | 2026-07-20 | 2026-07-03 | 2026-07-22 | 50 | yes | no | |',
  '| 1 | Excavation Complete | 2026-07-20 | 2026-07-20 | 2026-07-22 | 2026-07-22 | 100 | yes | yes | Earthworks |',
  '| 2 | Structures | 2026-07-21 | 2026-08-30 | 2026-07-25 | 2026-09-05 | 10 | no | no | Excavation Complete |',
].join('\n');

describe('construction schedule renderer', () => {
  test('normalizes Markdown schedule tables into task records', () => {
    const tasks = normalizeScheduleTasksFromMarkdown(scheduleMarkdown);

    expect(tasks).toHaveLength(3);
    expect(tasks[0]).toMatchObject({
      name: 'Earthworks',
      wbs: '1',
      baselineStart: '2026-07-01',
      baselineFinish: '2026-07-20',
      start: '2026-07-03',
      finish: '2026-07-22',
      percentComplete: 50,
      critical: true,
      milestone: false,
    });
    expect(tasks[1]?.dependencies).toEqual(['Earthworks']);
  });

  test('normalizes JSON schedule snippets into task records', () => {
    const tasks = normalizeScheduleTasks(JSON.stringify({
      tasks: [{
        id: 'a1',
        name: 'Mobilization',
        wbs: '0',
        start: '2026-06-01',
        finish: '2026-06-10',
        dependencies: ['Notice to proceed'],
        critical: true,
      }],
    }));

    expect(tasks).toEqual([{
      id: 'a1',
      name: 'Mobilization',
      wbs: '0',
      start: '2026-06-01',
      finish: '2026-06-10',
      dependencies: ['Notice to proceed'],
      critical: true,
    }]);
  });

  test('renders baseline/current bars, progress date, critical class, milestone diamonds, WBS bands, and legend', () => {
    const tasks = normalizeScheduleTasksFromMarkdown(scheduleMarkdown);
    const result = renderConstructionScheduleSvg(tasks, {
      pageSize: 'A4',
      orientation: 'landscape',
      progressDate: '2026-07-31',
    });

    expect(result.usedFallbackTable).toBe(false);
    expect(result.svg).toContain('data-page-size="A4"');
    expect(result.svg).toContain('class="baseline-bar"');
    expect(result.svg).toContain('class="current-bar critical"');
    expect(result.svg).toContain('class="progress-line"');
    expect(result.svg).toContain('class="milestone-diamond"');
    expect(result.svg).toContain('class="wbs-band"');
    expect(result.svg).toContain('Construction schedule legend');
  });

  test('supports A3 landscape sizing for dense schedules', () => {
    const tasks = normalizeScheduleTasksFromMarkdown(scheduleMarkdown);
    const result = renderConstructionScheduleSvg(tasks, {
      pageSize: 'A3',
      orientation: 'landscape',
    });

    expect(result.svg).toContain('data-page-size="A3"');
    expect(result.svg).toContain('width="1587"');
    expect(result.svg).toContain('height="1123"');
  });

  test('truncates large schedules with a warning', () => {
    const tasks = Array.from({ length: 8 }, (_, index) => ({
      id: `task-${index + 1}`,
      name: `Task ${index + 1}`,
      start: '2026-07-01',
      finish: '2026-07-10',
      wbs: `${index + 1}`,
    }));

    const result = renderConstructionScheduleSvg(tasks, {
      maxTasks: 3,
    });

    expect(result.renderedTaskCount).toBe(3);
    expect(result.warnings).toContain('Schedule has 8 tasks; rendered first 3 tasks for report readability.');
    expect(result.svg).not.toContain('Task 8');
  });

  test('warns when dependencies are too dense to draw cleanly', () => {
    const tasks = Array.from({ length: 3 }, (_, index) => ({
      id: `task-${index + 1}`,
      name: `Task ${index + 1}`,
      start: '2026-07-01',
      finish: '2026-07-10',
      dependencies: ['A', 'B', 'C', 'D', 'E'],
    }));

    const result = renderConstructionScheduleSvg(tasks, {
      denseDependencyThreshold: 4,
    });

    expect(result.warnings).toContain('Dependency network is too dense to draw cleanly; summarize dependencies in a table.');
  });

  test('degrades to a table fallback when date data is insufficient', () => {
    const result = renderConstructionScheduleSvg([
      { id: 'task-1', name: 'Undated activity' },
    ]);

    expect(result.usedFallbackTable).toBe(true);
    expect(result.markdownFallback).toContain('| Task | Start | Finish |');
    expect(result.warnings).toContain('Insufficient schedule dates for Gantt rendering; returned a table fallback.');
  });

  test('exposes optional PNG conversion for export paths', () => {
    expect(typeof renderConstructionSchedulePng).toBe('function');
  });
});
