import { test, expect } from '@playwright/test';

const ROUTES = ['/', '/theory', '/diagram', '/lab', '/report', '/manual'];
const VIEWPORTS = [
  { width: 375, height: 812, name: 'mobile' },
  { width: 768, height: 1024, name: 'tablet' },
  { width: 1280, height: 800, name: 'laptop' },
  { width: 1920, height: 1080, name: 'desktop' },
];

for (const route of ROUTES) {
  for (const vp of VIEWPORTS) {
    test(`Visual QA: ${route} at ${vp.width}x${vp.height} (${vp.name})`, async ({ page }) => {
      const consoleErrors: string[] = [];
      page.on('console', (msg) => {
        if (msg.type() === 'error') {
          consoleErrors.push(msg.text());
        }
      });
      page.on('pageerror', (err) => {
        consoleErrors.push(err.message);
      });

      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto(route, { waitUntil: 'networkidle' });

      // Check horizontal overflow
      const hasHorizontalScroll = await page.evaluate(() => {
        return document.documentElement.scrollWidth > window.innerWidth;
      });
      expect(hasHorizontalScroll, `Horizontal overflow detected on ${route} at ${vp.width}px`).toBe(false);

      // Check clipped interactive controls
      const clippedControls = await page.evaluate(() => {
        const interactive = Array.from(document.querySelectorAll('button, a, input, select, textarea, [role="button"]'));
        const clipped: string[] = [];
        for (const el of interactive) {
          const rect = el.getBoundingClientRect();
          let parent = el.parentElement;
          while (parent && parent !== document.body) {
            const style = window.getComputedStyle(parent);
            if (style.overflow === 'hidden' || style.overflowX === 'hidden' || style.overflowY === 'hidden') {
              const pRect = parent.getBoundingClientRect();
              if (
                rect.right > pRect.right + 2 ||
                rect.left < pRect.left - 2 ||
                rect.bottom > pRect.bottom + 2 ||
                rect.top < pRect.top - 2
              ) {
                clipped.push(el.tagName + (el.id ? '#' + el.id : '') + (el.className ? '.' + el.className.slice(0, 20) : ''));
                break;
              }
            }
            parent = parent.parentElement;
          }
        }
        return clipped;
      });
      expect(clippedControls, `Clipped interactive elements on ${route}: ${clippedControls.join(', ')}`).toHaveLength(0);

      // Assert no console errors
      expect(consoleErrors, `Console errors on ${route}`).toHaveLength(0);

      // Save screenshot
      const safeRouteName = route === '/' ? 'home' : route.replace(/\//g, '_');
      await page.screenshot({
        path: `qa-screens/${safeRouteName}-${vp.width}x${vp.height}.png`,
        fullPage: true,
      });

      // Special lab checks: Zen mode, breadboard tab, schematic tab, 8-bit adder preset
      if (route === '/lab') {
        // Toggle Zen Mode if available
        const zenBtn = page.locator('button[aria-label*="Zen"], button:has-text("Zen")').first();
        if (await zenBtn.isVisible()) {
          await zenBtn.click();
          await page.waitForTimeout(300);
          await page.screenshot({
            path: `qa-screens/lab-zen-${vp.width}x${vp.height}.png`,
            fullPage: true,
          });
          await zenBtn.click(); // Exit zen
          await page.waitForTimeout(300);
        }

        // Breadboard tab
        const breadboardTab = page.locator('button:has-text("Breadboard"), [role="tab"]:has-text("Breadboard")').first();
        if (await breadboardTab.isVisible()) {
          await breadboardTab.click();
          await page.waitForTimeout(500);
          await page.screenshot({
            path: `qa-screens/lab-breadboard-${vp.width}x${vp.height}.png`,
            fullPage: true,
          });
        }
      }
    });
  }
}
