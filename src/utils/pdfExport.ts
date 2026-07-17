import { jsPDF } from 'jspdf';
import { DEALERSHIP_DISPLAY_NAME } from '@/lib/constants';
import { sanitizeForCDK, sanitizeForCDKWithMeta } from '@/lib/sanitizeForCDK';
import type { RepairLine, RepairOrder } from '@/types';

const STORY_LINE_HEIGHT = 1.25;
const STORY_PARAGRAPH_GAP = 8;
const MERCEDES_NAVY = { r: 0, g: 31, b: 63 };
const MUTED_GRAY = { r: 85, g: 85, b: 85 };
const LABEL_GRAY = { r: 68, g: 68, b: 68 };
const FOOTER_GRAY = { r: 102, g: 102, b: 102 };

/** Normalize warranty story text for CDK/DMS paste — plain paragraphs, no junk whitespace. */
export function normalizeWarrantyStoryText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, '')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export async function copyPlainTextToClipboard(text: string): Promise<{ wasModified: boolean }> {
  const normalized = normalizeWarrantyStoryText(text);
  const { text: plain, wasModified } = sanitizeForCDKWithMeta(normalized);
  if (!plain) {
    throw new Error('Nothing to copy');
  }

  if (typeof navigator !== 'undefined' && navigator.clipboard?.write) {
    try {
      const blob = new Blob([plain], { type: 'text/plain;charset=utf-8' });
      await navigator.clipboard.write([new ClipboardItem({ 'text/plain': blob })]);
      return { wasModified };
    } catch {
      // fall through to writeText / execCommand
    }
  }

  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(plain);
      return { wasModified };
    } catch {
      // fall through
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = plain;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  textarea.style.left = '0';
  textarea.style.width = '2em';
  textarea.style.height = '2em';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  textarea.setSelectionRange(0, plain.length);
  const copied = document.execCommand('copy');
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error('Copy command failed');
  }
  return { wasModified };
}

function setTextColor(doc: jsPDF, color: { r: number; g: number; b: number }): void {
  doc.setTextColor(color.r, color.g, color.b);
}

function ensurePageSpace(doc: jsPDF, y: number, margin: number, needed: number): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  if (y + needed > pageHeight - margin) {
    doc.addPage();
    return margin;
  }
  return y;
}

function renderPdfLines(
  doc: jsPDF,
  text: string,
  margin: number,
  maxWidth: number,
  startY: number,
  fontSize: number,
  style: 'normal' | 'bold' = 'normal',
  color?: { r: number; g: number; b: number }
): number {
  const pageHeight = doc.internal.pageSize.getHeight();
  const lineHeight = fontSize * STORY_LINE_HEIGHT;
  let y = startY;

  doc.setFont('helvetica', style);
  doc.setFontSize(fontSize);
  if (color) setTextColor(doc, color);

  const lines = doc.splitTextToSize(text, maxWidth) as string[];
  for (let i = 0; i < lines.length; i++) {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(lines[i], margin, y);
    y += lineHeight;
  }

  setTextColor(doc, { r: 0, g: 0, b: 0 });
  return y;
}

function renderSectionTitle(
  doc: jsPDF,
  title: string,
  margin: number,
  maxWidth: number,
  startY: number
): number {
  let y = ensurePageSpace(doc, startY, margin, 24);
  y = renderPdfLines(doc, title, margin, maxWidth, y, 12, 'bold', MERCEDES_NAVY);
  return y + 4;
}

function renderLabelValueRow(
  doc: jsPDF,
  label: string,
  value: string,
  margin: number,
  maxWidth: number,
  startY: number
): number {
  if (!value.trim()) return startY;

  const pageHeight = doc.internal.pageSize.getHeight();
  const fontSize = 10;
  const lineHeight = fontSize * STORY_LINE_HEIGHT;
  const labelWidth = maxWidth * 0.3;
  const valueWidth = maxWidth * 0.7;
  let y = ensurePageSpace(doc, startY, margin, lineHeight * 2);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fontSize);
  setTextColor(doc, LABEL_GRAY);
  doc.text(label, margin, y);

  doc.setFont('helvetica', 'normal');
  setTextColor(doc, { r: 0, g: 0, b: 0 });
  const valueLines = doc.splitTextToSize(value, valueWidth) as string[];

  for (let i = 0; i < valueLines.length; i++) {
    if (y > pageHeight - margin) {
      doc.addPage();
      y = margin;
    }
    doc.text(valueLines[i], margin + labelWidth, y);
    y += lineHeight;
  }

  return y + 4;
}

function renderStoryParagraphs(
  doc: jsPDF,
  text: string,
  margin: number,
  maxWidth: number,
  startY: number,
  fontSize: number
): number {
  const lineHeight = fontSize * STORY_LINE_HEIGHT;
  let y = startY + 4;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(fontSize);
  setTextColor(doc, { r: 0, g: 0, b: 0 });

  const paragraphs = text
    .split(/\n\n+/)
    .map((p) => p.replace(/\s*\n\s*/g, ' ').trim())
    .filter(Boolean);

  for (let i = 0; i < paragraphs.length; i++) {
    if (i > 0) y += STORY_PARAGRAPH_GAP + 4;

    const wrapped = doc.splitTextToSize(paragraphs[i], maxWidth) as string[];

    for (let j = 0; j < wrapped.length; j++) {
      y = ensurePageSpace(doc, y, margin, lineHeight + 5);
      doc.text(wrapped[j], margin, y);
      y += lineHeight;
    }
  }

  return y;
}

function renderHeader(
  doc: jsPDF,
  ro: RepairOrder,
  margin: number,
  maxWidth: number,
  startY: number,
  technicianName?: string
): number {
  let y = startY;

  y = renderPdfLines(doc, DEALERSHIP_DISPLAY_NAME, margin, maxWidth, y, 18, 'bold', MERCEDES_NAVY);
  y += 6;
  y = renderPdfLines(
    doc,
    `Warranty Story • Repair Order #${ro.roNumber}`,
    margin,
    maxWidth,
    y,
    13,
    'normal',
    MUTED_GRAY
  );
  y += 6;

  const technician = technicianName?.trim() || ro.technicianName?.trim();
  if (technician) {
    y = renderPdfLines(doc, `Technician: ${technician}`, margin, maxWidth, y, 10, 'normal', MUTED_GRAY);
    y += 8;
  }

  doc.setDrawColor(MERCEDES_NAVY.r, MERCEDES_NAVY.g, MERCEDES_NAVY.b);
  doc.setLineWidth(2);
  doc.line(margin, y, margin + maxWidth, y);

  return y + 22;
}

function renderFooter(
  doc: jsPDF,
  margin: number,
  maxWidth: number,
  auditHash?: string,
  promptVersion?: string
): void {
  const pageHeight = doc.internal.pageSize.getHeight();
  const footerY = pageHeight - 38;
  const date = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  // Prompt version ties the exported PDF to the Merlin instruction set used at generation time.
  let footerText = `Generated by Merlin — Mercedes-Benz Warranty Platform • ${date}`;
  if (promptVersion) {
    footerText += `\nPrompt version: ${promptVersion}`;
  }
  if (auditHash) {
    footerText += `\nDocument ID: ${auditHash.substring(0, 16)}...`;
  }

  doc.setDrawColor(220, 220, 220);
  doc.setLineWidth(0.75);
  doc.line(margin, footerY - 14, margin + maxWidth, footerY - 14);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  setTextColor(doc, FOOTER_GRAY);
  doc.text(footerText, margin + maxWidth / 2, footerY, {
    align: 'center',
    lineHeightFactor: 1.4,
  });
  setTextColor(doc, { r: 0, g: 0, b: 0 });
}

export function exportWarrantyStoryPdf(
  ro: RepairOrder,
  line: RepairLine,
  storyOverride?: string,
  auditHash?: string,
  promptVersion?: string,
  technicianName?: string
): void {
  const story = sanitizeForCDK(normalizeWarrantyStoryText(storyOverride ?? line.warrantyStory ?? ''));
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const margin = 45;
  const pageWidth = doc.internal.pageSize.getWidth();
  const maxWidth = pageWidth - margin * 2;

  let y = margin;
  y = renderHeader(doc, ro, margin, maxWidth, y, technicianName);

  y = renderSectionTitle(doc, 'Vehicle Information', margin, maxWidth, y);
  const vehicle = [ro.vehicle.year, ro.vehicle.make, ro.vehicle.model].filter(Boolean).join(' ');
  if (vehicle) {
    y = renderLabelValueRow(doc, 'Vehicle:', vehicle, margin, maxWidth, y);
  }
  if (ro.vehicle.vin) {
    y = renderLabelValueRow(doc, 'VIN:', ro.vehicle.vin, margin, maxWidth, y);
  }
  if (ro.vehicle.mileageIn) {
    y = renderLabelValueRow(doc, 'Mileage:', ro.vehicle.mileageIn, margin, maxWidth, y);
  }
  if (ro.vehicle.engine) {
    y = renderLabelValueRow(doc, 'Engine:', ro.vehicle.engine, margin, maxWidth, y);
  }
  y = renderLabelValueRow(doc, 'Line:', `${line.lineNumber} — ${line.description}`, margin, maxWidth, y);

  y = renderSectionTitle(doc, 'Customer Concern', margin, maxWidth, y);
  y = renderPdfLines(doc, line.customerConcern?.trim() || '[Not documented]', margin, maxWidth, y, 10);
  y += 10;

  y = renderSectionTitle(doc, 'Technician Notes', margin, maxWidth, y);
  y = renderPdfLines(doc, line.technicianNotes?.trim() || '[Not documented]', margin, maxWidth, y, 10);
  y += 10;

  y = renderSectionTitle(doc, 'Warranty Story', margin, maxWidth, y);
  y = renderStoryParagraphs(doc, story, margin, maxWidth, y, 11);

  renderFooter(doc, margin, maxWidth, auditHash, promptVersion);

  doc.save(`RO-${ro.roNumber}-Line${line.lineNumber}-Warranty.pdf`);
}

export async function copyFormattedStory(
  _ro: RepairOrder,
  line: RepairLine,
  storyOverride?: string
): Promise<{ wasModified: boolean }> {
  const storyEl = typeof document !== 'undefined' ? document.getElementById(`warranty-story-${line.id}`) : null;
  const raw =
    storyOverride ??
    (storyEl instanceof HTMLTextAreaElement ? storyEl.value : undefined) ??
    line.warrantyStory ??
    '';
  return copyPlainTextToClipboard(raw);
}