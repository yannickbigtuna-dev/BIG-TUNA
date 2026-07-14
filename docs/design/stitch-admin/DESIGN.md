---
name: Pro-SaaS Administrative Interface
colors:
  surface: '#f7f9fb'
  surface-dim: '#d8dadc'
  surface-bright: '#f7f9fb'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f2f4f6'
  surface-container: '#eceef0'
  surface-container-high: '#e6e8ea'
  surface-container-highest: '#e0e3e5'
  on-surface: '#191c1e'
  on-surface-variant: '#45464d'
  inverse-surface: '#2d3133'
  inverse-on-surface: '#eff1f3'
  outline: '#76777d'
  outline-variant: '#c6c6cd'
  surface-tint: '#565e74'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#131b2e'
  on-primary-container: '#7c839b'
  inverse-primary: '#bec6e0'
  secondary: '#0058be'
  on-secondary: '#ffffff'
  secondary-container: '#2170e4'
  on-secondary-container: '#fefcff'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#0b1c30'
  on-tertiary-container: '#75859d'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#dae2fd'
  primary-fixed-dim: '#bec6e0'
  on-primary-fixed: '#131b2e'
  on-primary-fixed-variant: '#3f465c'
  secondary-fixed: '#d8e2ff'
  secondary-fixed-dim: '#adc6ff'
  on-secondary-fixed: '#001a42'
  on-secondary-fixed-variant: '#004395'
  tertiary-fixed: '#d3e4fe'
  tertiary-fixed-dim: '#b7c8e1'
  on-tertiary-fixed: '#0b1c30'
  on-tertiary-fixed-variant: '#38485d'
  background: '#f7f9fb'
  on-background: '#191c1e'
  surface-variant: '#e0e3e5'
typography:
  headline-xl:
    fontFamily: Plus Jakarta Sans
    fontSize: 36px
    fontWeight: '700'
    lineHeight: 44px
    letterSpacing: -0.02em
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.01em
  headline-lg-mobile:
    fontFamily: Plus Jakarta Sans
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 28px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
  body-lg:
    fontFamily: Inter
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '600'
    lineHeight: 20px
  label-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.25rem
  DEFAULT: 0.5rem
  md: 0.75rem
  lg: 1rem
  xl: 1.5rem
  full: 9999px
spacing:
  sidebar_width: 280px
  sidebar_collapsed: 80px
  container_max_width: 1440px
  gutter: 24px
  margin_mobile: 16px
  margin_desktop: 32px
  stack_xs: 4px
  stack_sm: 8px
  stack_md: 16px
  stack_lg: 24px
---

## Brand & Style
The design system is engineered for high-productivity administrative environments. It prioritizes clarity, efficiency, and a "SaaS-pro" aesthetic that balances professional rigor with modern interface trends. The target audience includes data analysts, system administrators, and operations managers who require long-term visual comfort and immediate information recognition.

The style is **Corporate / Modern**, leaning heavily into high-functioning minimalism. It utilizes ample whitespace to reduce cognitive load while maintaining a structured density appropriate for data-heavy workflows. The emotional response is one of reliability, precision, and calm control.

## Colors
The palette is anchored by a deep slate-to-navy foundation, providing a sense of stability and authority. 

- **Primary:** A deep Slate (#0F172A) used for core navigation backgrounds, headings, and high-emphasis text.
- **Secondary:** A vibrant Blue (#3B82F6) reserved for primary actions, active states, and focus indicators.
- **Neutral:** A comprehensive scale of grays from Cool Gray to Slate, used for borders (#E2E8F0), secondary text (#64748B), and soft background fills (#F8FAFC).
- **Semantic:** Success, Warning, and Error colors are tuned for high accessibility against white backgrounds, ensuring critical status indicators are instantly legible.
- **Data Visualization:** Use a sequential blue scale (Primary 500, 400, 300) complemented by a neutral slate for multi-series charts.

## Typography
This design system utilizes a dual-font strategy to maximize both character and readability. 

**Plus Jakarta Sans** is used for headings to provide a modern, slightly rounded, and approachable professional feel. **Inter** is used for all functional UI elements, body copy, and data displays due to its exceptional legibility and systematic design. 

For data-heavy tables, `body-sm` or `body-md` should be used with "tabular-nums" enabled to ensure numerical alignment. Use high-contrast slate (#1E293B) for primary body text and a softer slate (#64748B) for secondary descriptions.

## Layout & Spacing
The system employs a **Sidebar-based Fluid Grid**. 

- **Desktop (1280px+):** A 280px fixed-width sidebar on the left with a flexible content area. Content is organized into a 12-column grid with 24px gutters.
- **Tablet (768px - 1279px):** The sidebar collapses to an 80px icon-only rail or hides behind a hamburger menu. Margins reduce to 24px.
- **Mobile (Under 767px):** Full-screen width with 16px horizontal margins. The layout stacks vertically into a single column.

Spacing follows an 8px base unit (4, 8, 16, 24, 32, 48, 64) to ensure mathematical harmony across all components. Use `stack_md` (16px) as the default padding for cards and input groups.

## Elevation & Depth
Depth is communicated through **Tonal Layers** and **Ambient Shadows**. This design system avoids heavy gradients, favoring flat surfaces with subtle shadow definitions to signify hierarchy.

- **Level 0 (Background):** #F8FAFC (Neutral Slate 50). All main page backgrounds.
- **Level 1 (Cards/Surface):** #FFFFFF. Used for the primary content containers. Features a 1px border (#E2E8F0) and a soft, low-opacity shadow: `0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)`.
- **Level 2 (Dropdowns/Modals):** White background with a more pronounced elevation shadow: `0 10px 15px -3px rgba(0,0,0,0.1), 0 4px 6px -2px rgba(0,0,0,0.05)`.
- **Overlays:** Use a 40% opacity Slate-900 backdrop blur for modals to maintain context while focusing the user.

## Shapes
The shape language is "Rounded Professional." A standard radius of 8px (`0.5rem`) is applied to standard components like buttons, input fields, and cards to soften the technical nature of the dashboard. 

Larger containers like modals may use 16px (`1rem`) to feel more distinct from the base grid. Small elements like tags or badges may use a full pill-shape (999px) to distinguish them from interactive buttons.

## Components
- **Buttons:** Primary buttons use the Secondary Blue (#3B82F6) with white text. Secondary buttons use a white fill with a 1px border (#E2E8F0).
- **Input Fields:** 8px rounded corners, 1px border (#CBD5E1). On focus, use a 2px Blue-500 ring with 20% opacity. Labels are always `label-md` in Slate-700.
- **Cards:** White background, 8px or 12px rounded corners, 1px border (#E2E8F0). Card headers should have a subtle 1px bottom divider.
- **Sidebar:** Dark-themed (#0F172A). Active links should use a semi-transparent blue highlight or a 3px left-accent border in Blue-500.
- **Chips/Badges:** Small, 12px text, semi-transparent background fills matching their semantic status (e.g., Success Green at 10% opacity with Green 700 text).
- **Data Tables:** Row heights should be 52px for standard density. Use horizontal dividers only; avoid vertical grid lines to keep the interface clean.
- **Status Indicators:** Use a combination of color and icon (e.g., a small 8px dot + text) to ensure information is accessible to colorblind users.