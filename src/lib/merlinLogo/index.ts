/** Legacy merlinLogo surface — now Apex National Platform emblem. */
export {
  APEX_LOGO_VIEWBOX as MERLIN_LOGO_VIEWBOX,
  APEX_PLAIN_PALETTE as PLAIN_EMBLEM_PALETTE,
  APEX_PREMIUM_PALETTE as MERLIN_LOGO_PALETTE,
} from '@/lib/apexLogo/palette';

export const MERLIN_LOGO_CORNER_RADIUS = 0;
export const MERCEDES_EMBLEM_CENTER = 512;
export const MERCEDES_RING_RADIUS = 392;
export const MERCEDES_RING_STROKE = 20;

export { renderApexPlainEmblemMarkup as renderPlainEmblemMarkup } from '@/lib/apexLogo/renderPlainEmblem';
export { renderApexPlainStaticSvg as renderPlainEmblemStaticSvg } from '@/lib/apexLogo/renderStaticSvg';
export { renderApexPremiumEmblemMarkup as renderPremiumEmblemMarkup } from '@/lib/apexLogo/renderPremiumEmblem';
export { renderApexPremiumStaticSvg as renderMerlinLogoStaticSvg } from '@/lib/apexLogo/renderStaticSvg';

/** @deprecated Mercedes geometry removed. */
export const MERCEDES_STAR_ARM = '';
export const MERCEDES_STAR_ROTATIONS = [] as const;
