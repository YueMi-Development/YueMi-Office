import { describe, expect, it } from 'vitest';

import release from '../../../../.github/workflows/release.yml?raw';
import { brokenSteps, readJobs } from './workflowScan';

/**
 * The release workflow.
 *
 * A release is built from a tag and only from a tag, so the workflow
 * must not run on an ordinary push. The three platform jobs upload into
 * one release, and the release is created once, before them, so that they
 * do not race each other.
 */

describe('the release workflow', () => {
  it('runs on a tag and on nothing else', () => {
    expect(release).toMatch(/^on:$/m);
    expect(release).toContain("tags: ['v*.*.*']");
    expect(release).not.toMatch(/^\s+branches:/m);
    expect(release).not.toContain('pull_request');
    expect(release).not.toContain('workflow_dispatch');
  });

  it('builds the three platforms', () => {
    const bundle = readJobs(release).find((job) => job.name === 'bundle');

    expect(bundle).toBeDefined();
    expect(release).toContain(
      'platform: [ubuntu-latest, macos-latest, windows-latest]',
    );
  });

  it('creates the release once, before the platform jobs', () => {
    const jobs = readJobs(release);
    const prepare = jobs.find((job) => job.name === 'release');
    const bundle = jobs.find((job) => job.name === 'bundle');

    expect(prepare).toBeDefined();
    expect(bundle).toBeDefined();
    expect(release).toContain('needs: release');
    expect(release).toContain(
      'releaseId: ${{ needs.release.outputs.release_id }}',
    );
  });

  it('does not let each platform job create the release', () => {
    // The action creates a release itself when it is given a tag, and
    // three jobs doing that would race each other.
    expect(release).not.toContain('tagName:');
    expect(release).toContain('releaseId:');
  });

  it('publishes a pre-release as a pre-release', () => {
    expect(release).toContain('prerelease=true');
    expect(release).toContain('prerelease=false');
  });

  it('does not publish an updater manifest', () => {
    // There is no updater keypair yet, so there is nothing to publish.
    expect(release).toContain('uploadUpdaterJson: false');
  });

  it('uses the current line of the build action', () => {
    // The v0 line of the action is the old one, and it has no
    // `uploadWorkflowArtifacts` input at all.
    expect(release).toContain('tauri-apps/tauri-action@v1');
    expect(release).not.toContain('tauri-action@v0');
  });

  it('has no step that breaks on a Windows runner', () => {
    expect(brokenSteps(readJobs(release))).toEqual([]);
  });

  it('asks for bash where a command is spread over several lines', () => {
    const prepare = readJobs(release).find((job) => job.name === 'release');
    const steps = prepare?.steps ?? [];

    for (const step of steps) {
      if (step.command.some((line) => line.trimEnd().endsWith('\\'))) {
        expect(step.shell).toBe('bash');
      }
    }
  });
});
