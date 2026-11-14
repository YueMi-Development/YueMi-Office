import { describe, expect, it } from 'vitest';

import release from '../../../../.github/workflows/release.yml?raw';
import createRelease from '../../../../.github/scripts/create-release.sh?raw';
import versionFromTag from '../../../../.github/scripts/version-from-tag.sh?raw';
import applyTagVersion from '../../../../.github/scripts/apply-tag-version.sh?raw';
import fixDebVersion from '../../../../.github/scripts/fix-deb-version.sh?raw';
import buildLinuxPackages from '../../../../.github/scripts/build-linux-packages.sh?raw';
import uploadReleaseFiles from '../../../../.github/scripts/upload-release-files.sh?raw';
import { brokenSteps, readJobs } from './workflowScan';

/**
 * The release workflow.
 *
 * A release is built from a tag and only from a tag, so the workflow
 * must not run on an ordinary push. The platform jobs upload into one
 * release, and the release is created once, before them, so that they do
 * not race each other.
 *
 * The work of reading the version and creating the release is in the
 * scripts under `.github/scripts`, because a workflow file is a list of
 * steps and a step that is forty lines of shell is not a step. The rules
 * that matter to the release are therefore checked against both.
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
    const linux = readJobs(release).find((job) => job.name === 'linux');

    expect(bundle).toBeDefined();
    expect(linux).toBeDefined();
    expect(release).toContain('platform: [macos-latest, windows-latest]');
    expect(linux?.runsOn).toBe('ubuntu-latest');
  });

  it('creates the release once, before the platform jobs', () => {
    const jobs = readJobs(release);
    const prepare = jobs.find((job) => job.name === 'release');
    const bundle = jobs.find((job) => job.name === 'bundle');

    expect(prepare).toBeDefined();
    expect(bundle).toBeDefined();
    expect(release).toContain('needs: release');
    expect(release).toContain('releaseId: ${{ needs.release.outputs.release_id }}');
  });

  it('does not let each platform job create the release', () => {
    // The action creates a release itself when it is given a tag, and the
    // jobs doing that would race each other.
    expect(release).not.toContain('tagName:');
    expect(release).toContain('releaseId:');
  });

  it('creates the release with the script', () => {
    // The script does the work, so the workflow has to run it rather than
    // carrying a copy of it.
    expect(release).toContain('create-release.sh');
    expect(createRelease).toContain('releases/tags/');
  });

  it('reads the version with the script', () => {
    // The script does the work, so the workflow has to run it rather than
    // carrying a copy of it.
    expect(release).toContain('version-from-tag.sh');
    expect(versionFromTag).toContain('does not name a version');
  });

  it('puts the version into the tree with the script', () => {
    // The version of a build is the version of its tag, and the tag's
    // version has to be written into every file that carries one before
    // the build starts. The script does the work, because a workflow file
    // is a list of steps and a step that is forty lines of shell is not a
    // step.
    expect(release).toContain('apply-tag-version.sh');
    expect(applyTagVersion).toContain('version-from-tag.sh');
    expect(applyTagVersion).toContain('set-version.ts');
  });

  it('gives the script the tag it was built from', () => {
    // The version of the build is the version of the tag, and the tag is
    // what the release job read the version from.
    expect(release).toContain('TAG: ${{ github.ref_name }}');
    expect(release).toContain('apply-tag-version.sh "$TAG"');
  });

  it('does not carry the work of the version in the workflow file', () => {
    // The workflow says which script to run and nothing else.
    expect(release).not.toContain('scripts/set-version.ts');
  });

  it('publishes a pre-release as a pre-release', () => {
    // The rule is in the script that reads the tag, because that is
    // where the version is decided.
    expect(versionFromTag).toContain('prerelease=true');
    expect(versionFromTag).toContain('prerelease=false');
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

  it('says whether the tag names a pre-release', () => {
    // The Linux job needs to know, because an rpm cannot be built for a
    // pre-release.
    expect(release).toContain('prerelease: ${{ steps.version.outputs.prerelease }}');
  });

  it('builds the Linux packages on their own job', () => {
    // The Debian package is rewritten after it is built, because the
    // bundler puts the version of the app into the control file of the
    // package and Debian reads a pre-release identifier in that field as
    // a revision that sorts after the finished release. The upload has
    // to happen after the rewrite, so the Linux job cannot use the Tauri
    // action, which uploads what it builds.
    const jobs = readJobs(release);
    const linux = jobs.find((job) => job.name === 'linux');

    expect(linux).toBeDefined();
    expect(
      linux?.steps.some((step) =>
        step.command.some((line) => line.includes('build-linux-packages.sh')),
      ),
    ).toBe(true);
    expect(
      linux?.steps.some((step) =>
        step.command.some((line) => line.includes('upload-release-files.sh')),
      ),
    ).toBe(true);
  });

  it('leaves the rpm out of a pre-release', () => {
    // The version of an rpm has to be set while it is built, and the
    // only version the bundler takes is the one in the configuration,
    // which has to be a plain semver version.
    expect(release).toContain('bundles=deb,appimage');
    expect(release).toContain('bundles=deb,appimage,rpm');
  });

  it('rewrites the version inside the Debian package', () => {
    expect(buildLinuxPackages).toContain('fix-deb-version.sh');
    expect(fixDebVersion).toContain('Version:');
    expect(fixDebVersion).toContain('dpkg-deb');
  });

  it('uploads the packages into the release that is already there', () => {
    expect(uploadReleaseFiles).toContain('gh release upload');
    expect(release).toContain('TAG: ${{ github.ref_name }}');
  });

  it('asks for bash where a shell script is run', () => {
    // The scripts under `.github/scripts` are shell scripts, and a runner
    // on Windows runs a step in PowerShell by default, which cannot run
    // one. The step that runs the release scripts is named here so that
    // removing the shell from it is a failure with a message that says
    // what is wrong.
    const prepare = readJobs(release).find((job) => job.name === 'release');
    const steps = prepare?.steps ?? [];

    for (const step of steps) {
      if (step.command.some((line) => line.includes('.github/scripts/'))) {
        expect(step.shell).toBe('bash');
      }
    }
  });
});
