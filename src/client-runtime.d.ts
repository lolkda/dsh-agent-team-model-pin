/** Narrow declarations of inspected DSH shared icons; no duplicate UI runtime.
 *  DSH 0.1.7-rc.1 names the product icon set by glyph and stroke weight
 *  (`IconXOutlineRegular`) and takes the rendered size as a prop. */
declare module '@deepseek-ai/dsh-client-ui-primitives' {
  interface IconProps { size?: number; className?: string }
  export const IconDataOutlineRegular: (props: IconProps) => import('react').ReactElement;
  export const IconChevronDownOutlineRegular: (props: IconProps) => import('react').ReactElement;
  export const IconChevronRightOutlineRegular: (props: IconProps) => import('react').ReactElement;
  export const IconChevronLeftOutlineRegular: (props: IconProps) => import('react').ReactElement;
  export const IconCheckOutlineRegular: (props: IconProps) => import('react').ReactElement;
}
