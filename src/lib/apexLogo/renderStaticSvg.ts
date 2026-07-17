import { APEX_LOGO_VIEWBOX } from './palette';
import { renderApexPlainEmblemMarkup } from './renderPlainEmblem';
import { renderApexPremiumEmblemMarkup } from './renderPremiumEmblem';

const VB = APEX_LOGO_VIEWBOX;

export function renderApexPlainStaticSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" width="${VB}" height="${VB}">
  ${renderApexPlainEmblemMarkup()}
</svg>`;
}

export function renderApexPremiumStaticSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" width="${VB}" height="${VB}">
  ${renderApexPremiumEmblemMarkup('apex-static')}
</svg>`;
}
