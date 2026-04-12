# Domain Gap Checklist — Web UI Development

Before searching, evaluate the spec against these common gaps. Focus your research on areas where the spec is silent or vague.

## Design System

- Design tokens defined (colors, typography, spacing, radii, shadows)?
- Typography scale specified (font families, sizes, weights, line heights)?
- Spacing system documented (base unit, scale)?
- Color palette with semantic naming (primary, secondary, surface, error, etc.)?
- Component inventory listed (which components are needed)?

## Responsive Design

- Breakpoints defined with specific pixel values?
- Layout strategy specified (Grid, Flexbox, Container Queries)?
- Fluid typography or step-based scaling documented?
- Mobile-first or desktop-first approach declared?
- Touch target minimum sizes specified (48x48px)?

## Accessibility

- WCAG conformance level declared (A, AA, AAA)?
- Keyboard navigation paths defined for all interactive elements?
- ARIA patterns specified for complex widgets (modals, tabs, comboboxes)?
- Focus management strategy documented (focus traps, focus restoration)?
- Color contrast requirements stated with specific ratios?
- Screen reader announcement expectations documented?
- Reduced motion behavior specified?

## Component States

- All interactive states defined (default, hover, focus, active, disabled)?
- Loading states specified (skeleton, spinner, progressive)?
- Empty states designed (no data, first use)?
- Error states defined (validation, network, boundary)?
- Success/confirmation feedback documented?

## CSS Architecture

- CSS methodology declared (BEM, utility-first, CSS Modules, CSS-in-JS)?
- Custom property naming convention documented?
- Dark mode or theme switching strategy specified?
- Animation and transition approach documented?
- Z-index scale defined?

## Performance

- Core Web Vitals targets set (LCP, FID/INP, CLS)?
- Image optimization strategy specified (formats, sizing, lazy loading)?
- Font loading strategy documented (swap, preload, subsetting)?
- Bundle size budget defined?
- Critical CSS or above-the-fold strategy?

## Browser Support

- Target browsers and versions listed?
- Progressive enhancement or graceful degradation approach?
- CSS feature support boundaries defined (Container Queries, :has(), etc.)?
- JavaScript feature requirements and polyfill strategy?

## Internationalization

- RTL layout support required?
- Text expansion/contraction handling for translations?
- Date, number, and currency formatting localized?
- Content overflow strategy for variable-length text?
