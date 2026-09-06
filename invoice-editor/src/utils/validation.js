import { ELEMENT_TYPES } from '../data/elementCatalog';

const MIN_SAFE_AREA_PX = 80; // below this, a region can't realistically fit a line of text

export function validateTemplate(template, railInsets) {
  const issues = [];

  // 1. every required element must have at least one instance on the canvas
  Object.entries(ELEMENT_TYPES).forEach(([type, def]) => {
    if (!def.required) return;
    const present = template.items.some((i) => i.kind === 'content' && i.type === type);
    if (!present) issues.push({ level: 'error', message: `Required element "${def.label}" is missing.` });
  });

  // 2. optional block enabled but structurally empty — genuinely reachable
  //    now that individual optional lines can be deleted per-item (see
  //    item.hiddenLines), not just theoretical placeholder-content guarding.
  const paymentItem = template.items.find((i) => i.kind === 'content' && i.type === 'paymentMethods');
  if (paymentItem) {
    const hidden = paymentItem.hiddenLines || [];
    const visibleCount = ELEMENT_TYPES.paymentMethods.render().lines.filter((l) => !hidden.includes(l.key)).length;
    if (visibleCount === 0) {
      issues.push({ level: 'warning', message: 'Payment methods block is enabled but has no methods.' });
    }
  }

  // 3. rail thickness eating too much safe area
  const pageW = template.page.width;
  const pageH = template.page.height;
  if (railInsets.left + railInsets.right > pageW - MIN_SAFE_AREA_PX) {
    issues.push({ level: 'error', message: 'Left/right rails leave almost no horizontal space for content.' });
  }
  if (railInsets.top + railInsets.bottom > pageH - MIN_SAFE_AREA_PX) {
    issues.push({ level: 'error', message: 'Top/bottom rails leave almost no vertical space for content.' });
  }

  return issues;
}
