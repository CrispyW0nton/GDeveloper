/**
 * Smoke test — Task Queue Panel Visibility (Sprint 27.2)
 *
 * This is a declarative spec that verifies the TaskQueuePanel
 * component is included in the built renderer output.
 * For full Electron app launch tests, see the CI pipeline.
 *
 * Checks:
 * 1. TaskQueuePanel.tsx exists and exports a component
 * 2. TaskQueuePanel.css exists with expected class names
 * 3. ChatWorkspace.tsx imports and renders TaskQueuePanel
 * 4. Preload exposes onTodoChanged
 * 5. IPC_CHANNELS.TODO_CHANGED is registered
 * 6. Built renderer JS includes task queue identifiers
 */

import * as fs from 'fs';
import * as path from 'path';

function testTaskQueuePanelFileExists() {
  const results: string[] = [];
  const panelPath = path.resolve(__dirname, '../../src/renderer/components/chat/TaskQueuePanel.tsx');
  const cssPath = path.resolve(__dirname, '../../src/renderer/components/chat/TaskQueuePanel.css');

  const panelExists = fs.existsSync(panelPath);
  console.assert(panelExists, `TaskQueuePanel.tsx should exist at ${panelPath}`);
  results.push(panelExists ? 'PASS' : 'FAIL');

  const cssExists = fs.existsSync(cssPath);
  console.assert(cssExists, `TaskQueuePanel.css should exist at ${cssPath}`);
  results.push(cssExists ? 'PASS' : 'FAIL');

  if (panelExists) {
    const content = fs.readFileSync(panelPath, 'utf-8');
    const hasExport = content.includes('export default function TaskQueuePanel');
    console.assert(hasExport, 'TaskQueuePanel.tsx should export default function');
    results.push(hasExport ? 'PASS' : 'FAIL');

    const hasTodoItem = content.includes('TodoItem');
    console.assert(hasTodoItem, 'TaskQueuePanel.tsx should reference TodoItem type');
    results.push(hasTodoItem ? 'PASS' : 'FAIL');

    const hasCollapse = content.includes('onToggleCollapse');
    console.assert(hasCollapse, 'TaskQueuePanel.tsx should have onToggleCollapse prop');
    results.push(hasCollapse ? 'PASS' : 'FAIL');

    const hasAriaExpanded = content.includes('aria-expanded');
    console.assert(hasAriaExpanded, 'TaskQueuePanel.tsx should have ARIA attributes');
    results.push(hasAriaExpanded ? 'PASS' : 'FAIL');

    const hasOnTodoChanged = content.includes('onTodoChanged');
    console.assert(hasOnTodoChanged, 'TaskQueuePanel.tsx should subscribe to onTodoChanged');
    results.push(hasOnTodoChanged ? 'PASS' : 'FAIL');
  }

  if (cssExists) {
    const css = fs.readFileSync(cssPath, 'utf-8');
    const hasContainer = css.includes('.tqp-container');
    console.assert(hasContainer, 'CSS should have .tqp-container');
    results.push(hasContainer ? 'PASS' : 'FAIL');

    const hasHeader = css.includes('.tqp-header');
    console.assert(hasHeader, 'CSS should have .tqp-header');
    results.push(hasHeader ? 'PASS' : 'FAIL');

    const hasActiveIndicator = css.includes('.tqp-indicator--active');
    console.assert(hasActiveIndicator, 'CSS should have .tqp-indicator--active');
    results.push(hasActiveIndicator ? 'PASS' : 'FAIL');

    const hasProgress = css.includes('.tqp-progress-fill');
    console.assert(hasProgress, 'CSS should have .tqp-progress-fill');
    results.push(hasProgress ? 'PASS' : 'FAIL');
  }

  return results;
}

function testChatWorkspaceIntegration() {
  const results: string[] = [];
  const wsPath = path.resolve(__dirname, '../../src/renderer/components/chat/ChatWorkspace.tsx');

  if (!fs.existsSync(wsPath)) {
    results.push('FAIL');
    return results;
  }

  const content = fs.readFileSync(wsPath, 'utf-8');

  const importsPanel = content.includes("import TaskQueuePanel");
  console.assert(importsPanel, 'ChatWorkspace should import TaskQueuePanel');
  results.push(importsPanel ? 'PASS' : 'FAIL');

  const renderPanel = content.includes('<TaskQueuePanel');
  console.assert(renderPanel, 'ChatWorkspace should render <TaskQueuePanel>');
  results.push(renderPanel ? 'PASS' : 'FAIL');

  const hasTodoState = content.includes('todoTasks');
  console.assert(hasTodoState, 'ChatWorkspace should have todoTasks state');
  results.push(hasTodoState ? 'PASS' : 'FAIL');

  const hasCollapsedState = content.includes('taskPanelCollapsed');
  console.assert(hasCollapsedState, 'ChatWorkspace should have taskPanelCollapsed state');
  results.push(hasCollapsedState ? 'PASS' : 'FAIL');

  return results;
}

function testPreloadExposesTodoBroadcast() {
  const results: string[] = [];
  const preloadPath = path.resolve(__dirname, '../../src/preload/index.ts');

  if (!fs.existsSync(preloadPath)) {
    results.push('FAIL');
    return results;
  }

  const content = fs.readFileSync(preloadPath, 'utf-8');

  const hasOnTodoChanged = content.includes('onTodoChanged');
  console.assert(hasOnTodoChanged, 'Preload should expose onTodoChanged');
  results.push(hasOnTodoChanged ? 'PASS' : 'FAIL');

  const hasTodoChangedChannel = content.includes("'todo:changed'");
  console.assert(hasTodoChangedChannel, 'Preload should listen on todo:changed');
  results.push(hasTodoChangedChannel ? 'PASS' : 'FAIL');

  return results;
}

function testIPCChannelRegistered() {
  const results: string[] = [];
  const ipcPath = path.resolve(__dirname, '../../src/main/ipc/index.ts');

  if (!fs.existsSync(ipcPath)) {
    results.push('FAIL');
    return results;
  }

  const content = fs.readFileSync(ipcPath, 'utf-8');

  const hasTodoChanged = content.includes("TODO_CHANGED: 'todo:changed'");
  console.assert(hasTodoChanged, 'IPC channels should include TODO_CHANGED');
  results.push(hasTodoChanged ? 'PASS' : 'FAIL');

  return results;
}

function testBuiltRendererContainsPanel() {
  const results: string[] = [];
  const distDir = path.resolve(__dirname, '../../dist-renderer/assets');

  if (!fs.existsSync(distDir)) {
    console.log('dist-renderer not found — skipping built-output checks (build may not have run)');
    return results;
  }

  const jsFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.js'));
  if (jsFiles.length === 0) {
    results.push('FAIL');
    return results;
  }

  // Read the main JS bundle
  const bundleContent = jsFiles.map(f => fs.readFileSync(path.join(distDir, f), 'utf-8')).join('');

  // Check that task queue class names are present in the bundle
  const hasTaskQueueClass = bundleContent.includes('tqp-container') || bundleContent.includes('tqp-header');
  console.assert(hasTaskQueueClass, 'Built bundle should contain tqp- class names');
  results.push(hasTaskQueueClass ? 'PASS' : 'FAIL');

  // Check CSS was bundled
  const cssFiles = fs.readdirSync(distDir).filter(f => f.endsWith('.css'));
  if (cssFiles.length > 0) {
    const cssContent = cssFiles.map(f => fs.readFileSync(path.join(distDir, f), 'utf-8')).join('');
    const hasTqpCss = cssContent.includes('tqp-container');
    console.assert(hasTqpCss, 'Built CSS should contain tqp-container');
    results.push(hasTqpCss ? 'PASS' : 'FAIL');
  }

  return results;
}

// ─── Run ───

const allResults = [
  ...testTaskQueuePanelFileExists(),
  ...testChatWorkspaceIntegration(),
  ...testPreloadExposesTodoBroadcast(),
  ...testIPCChannelRegistered(),
  ...testBuiltRendererContainsPanel(),
];

const passed = allResults.filter(r => r === 'PASS').length;
const failed = allResults.filter(r => r === 'FAIL').length;

console.log(`\ntask-queue-visible smoke test: ${passed} passed, ${failed} failed (${allResults.length} total)`);
if (failed > 0) {
  process.exit(1);
}
