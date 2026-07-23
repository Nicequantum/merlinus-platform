import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

const root = resolve(process.cwd());
function readSrc(rel: string): string {
  return readFileSync(resolve(root, rel), 'utf8');
}

describe('Desktop module layouts (≥1024px polish)', () => {
  it('command shell has top search, control center, and jobs nav', () => {
    const shell = readSrc('src/components/desktop/DesktopCommandShell.tsx');
    assert.match(shell, /Ctrl\+K|placeholder=.*Ctrl\+K/);
    assert.match(shell, /Control Center/);
    assert.match(shell, /AI Jobs/);
    assert.match(shell, /technicianName/);
    assert.match(shell, /dealershipName/);
    assert.match(shell, /onSearchChange/);
  });

  it('shared desktop table and page frame exist', () => {
    assert.match(readSrc('src/components/desktop/DesktopDataTable.tsx'), /DesktopDataTable/);
    assert.match(readSrc('src/components/desktop/DesktopPageFrame.tsx'), /desktop-page-frame/);
  });

  it('department inbox uses desktop table + bulk actions', () => {
    const dash = readSrc('src/components/department/DepartmentRequestDashboard.tsx');
    assert.match(dash, /DesktopDataTable/);
    assert.match(dash, /Close selected/);
    assert.match(dash, /useDesktopCompanion/);
  });

  it('home, hub, video, voice, control center carry desktop class hooks', () => {
    assert.match(readSrc('src/components/HomeView.tsx'), /desktop-home-layout/);
    assert.match(readSrc('src/components/hub/HubDashboard.tsx'), /desktop-hub-layout/);
    assert.match(readSrc('src/components/videoInspection/VideoInspectionView.tsx'), /desktop-video-mpi/);
    assert.match(readSrc('src/components/voice/VoiceOpsDashboard.tsx'), /desktop-voice-ops/);
    assert.match(readSrc('src/components/manager/ManagerControlCenter.tsx'), /desktop-control-center/);
    assert.match(readSrc('src/components/manager/ManagerControlCenter.tsx'), /desktop-kpi-widgets/);
  });

  it('globals define desktop density + print styles', () => {
    const css = readSrc('src/app/globals.css');
    assert.match(css, /@media \(min-width: 1024px\)/);
    assert.match(css, /desktop-data-table/);
    assert.match(css, /@media print/);
    assert.match(css, /desktop-home-body/);
  });

  it('authenticated app wires shell search and manager deep links', () => {
    const app = readSrc('src/components/BenzTechAuthenticatedApp.tsx');
    assert.match(app, /setSearchTerm/);
    assert.match(app, /\/manager\/center/);
    assert.match(app, /\/manager\/jobs/);
  });
});
