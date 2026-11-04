// How tools recognised from a photo go into the drawer. Every attempt runs on a copy, so the project stays untouched.
import {autoArrange} from './geometry.js';
import {addToolGroup} from './set-module.js';

const copy = value => JSON.parse(JSON.stringify(value));
const inDrawer = (project, tool) => project.modules.some(m => m.id === tool.moduleId && m.x >= -.001 && m.y >= -.001 && m.x + m.width <= project.width + .001 && m.y + m.height <= project.height + .001);

/** The arrangement that puts all tools into the drawer as ONE module, or null. A tidy order is preferred to a compact one. */
export function sharedArrangement(project, tools, info = {}) {
  for (const arrangement of ['ordered', 'compact']) {
    try { if (addToolGroup(copy(project), copy(tools), { ...info, arrangement, toolSet: { name: info.name, layout: 'shared' } }).placed) return arrangement; }
    catch { /* A module over the size limit is simply not an option here. */ }
  }
  return null;
}

/** Whether every tool finds a place in the drawer in a module of its own. */
export function separateModulesFit(project, tools) {
  const next = copy(project), ids = new Set(tools.map(tool => tool.id));
  next.tools.push(...copy(tools));
  const arranged = autoArrange(next);
  return arranged.tools.filter(tool => ids.has(tool.id)).every(tool => inDrawer({ ...next, modules: arranged.modules }, tool));
}

/**
 * layout 'shared' | 'each' | 'auto'. Returns {layout:'shared',arrangement} or {layout:'each'}.
 * 'auto' keeps the tools together while they fit, otherwise separates them. When nothing fits it stays separate,
 * so the drawer dialog can offer more space for exactly the tools that are left over.
 */
export function photoLayout(project, tools, layout = 'auto', info = {}) {
  if (layout === 'each') return { layout: 'each' };
  const arrangement = sharedArrangement(project, tools, info);
  if (layout === 'shared') return { layout: 'shared', arrangement: arrangement || 'ordered' };
  return arrangement ? { layout: 'shared', arrangement } : { layout: 'each' };
}
