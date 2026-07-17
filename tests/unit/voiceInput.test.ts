import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { computeAdaptiveConfidenceThreshold, passesConfidenceGate } from '../../src/lib/voice/confidence';
import { resolveVoiceErrorMessage, shouldAutoRestartAfterError } from '../../src/lib/voice/errors';
import { appendDictationChunk, processDictationChunk } from '../../src/lib/voice/dictationText';
import {
  applySpokenPunctuation,
  normalizeDictationSpacing,
} from '../../src/lib/voice/dictationPunctuation';
import { DEFAULT_VOICE_INPUT_SETTINGS } from '../../src/lib/voice/voiceSettings';

describe('voice confidence adaptation', () => {
  test('lowers threshold as noise increases', () => {
    const quiet = computeAdaptiveConfidenceThreshold(5, DEFAULT_VOICE_INPUT_SETTINGS);
    const loud = computeAdaptiveConfidenceThreshold(90, DEFAULT_VOICE_INPUT_SETTINGS);
    assert.ok(loud < quiet);
    assert.equal(loud, DEFAULT_VOICE_INPUT_SETTINGS.minConfidenceThreshold);
  });

  test('never drops below configured floor', () => {
    const threshold = computeAdaptiveConfidenceThreshold(100, DEFAULT_VOICE_INPUT_SETTINGS);
    assert.equal(threshold, DEFAULT_VOICE_INPUT_SETTINGS.minConfidenceThreshold);
  });

  test('M19: null or zero confidence accepted for live dictation', () => {
    assert.equal(passesConfidenceGate(undefined, 0.9, 0), true);
    assert.equal(passesConfidenceGate(null, 0.9, 5), true);
    assert.equal(passesConfidenceGate(0, 0.9, 0), true);
  });

  test('gates low-confidence hypotheses in quiet bays', () => {
    assert.equal(passesConfidenceGate(0.8, 0.55), true);
    assert.equal(passesConfidenceGate(0.1, 0.55), false);
  });
});

describe('voice dictation text', () => {
  test('inserts word boundaries between finalized chunks', () => {
    assert.equal(appendDictationChunk('Customer reports', 'brake noise'), 'Customer reports brake noise');
    assert.equal(appendDictationChunk('Line one.', 'Line two'), 'Line one. Line two');
    assert.equal(appendDictationChunk('Already spaced ', 'next'), 'Already spaced next');
    assert.equal(appendDictationChunk('Voltage', ','), 'Voltage,');
  });

  test('story mode converts spoken punctuation commands', () => {
    assert.equal(applySpokenPunctuation('brake noise period', 'story'), 'brake noise.');
    assert.equal(applySpokenPunctuation('voltage comma twelve volts', 'story'), 'voltage, twelve volts');
    assert.equal(applySpokenPunctuation('found DTC P0300 new paragraph replaced plugs', 'story'), 'found DTC P0300\n\nreplaced plugs');
    assert.equal(applySpokenPunctuation('noise persists question mark', 'story'), 'noise persists?');
    assert.equal(applySpokenPunctuation('plain words', 'default'), 'plain words');
  });

  test('processDictationChunk merges story chunks with punctuation and spacing', () => {
    const first = processDictationChunk('', 'Customer reports brake noise period', 'story');
    const second = processDictationChunk(first, 'voltage at battery comma twelve point six volts', 'story');
    assert.match(second, /brake noise\./);
    assert.match(second, /battery, twelve point six volts/);
  });

  test('normalizeDictationSpacing tightens punctuation gaps', () => {
    assert.equal(normalizeDictationSpacing('word . Next'), 'word. Next');
  });
});

describe('voice dictation stability', () => {
  test('VoiceInputProvider shares one pipeline across StableTextarea fields', () => {
    const app = readFileSync(join(process.cwd(), 'src/components/BenzTechAuthenticatedApp.tsx'), 'utf8');
    const provider = readFileSync(join(process.cwd(), 'src/components/VoiceInputProvider.tsx'), 'utf8');
    const button = readFileSync(join(process.cwd(), 'src/components/VoiceInputButton.tsx'), 'utf8');
    // speechLanguage prop optional for preferred_language STT map
    assert.match(app, /<VoiceInputProvider(?:\s|>)/);
    assert.match(provider, /VoiceInputContext/);
    assert.match(button, /useSharedVoiceInput/);
    assert.match(button, /activeTarget === targetRef\.current/);
  });

  test('VoiceInputService joins finalized chunks with spacing helper', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/voice/VoiceInputService.ts'), 'utf8');
    assert.match(src, /processDictationChunk/);
    assert.match(src, /dictationMode/);
  });
  test('StableTextarea defers parent sync until finalized speech', () => {
    const src = readFileSync(join(process.cwd(), 'src/components/StableTextarea.tsx'), 'utf8');
    assert.match(src, /meta\?\.hasFinal/);
    assert.match(src, /suppressExternalSync|voiceListening/);
  });

  test('VoiceInputService ignores manual-edit guard while listening', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/voice/VoiceInputService.ts'), 'utf8');
    assert.match(src, /this\.state\.isListening\) return/);
    assert.match(src, /flushTranscriptToTarget/);
  });
});

describe('voice error recovery', () => {
  test('maps technician-friendly messages', () => {
    assert.match(resolveVoiceErrorMessage('not-allowed'), /Microphone blocked/i);
    assert.match(resolveVoiceErrorMessage('network'), /network/i);
  });

  test('auto-restarts only for recoverable errors within cap', () => {
    assert.equal(shouldAutoRestartAfterError('no-speech', 0, 10), true);
    assert.equal(shouldAutoRestartAfterError('network', 2, 10), true);
    assert.equal(shouldAutoRestartAfterError('aborted', 0, 10), false);
    assert.equal(shouldAutoRestartAfterError('not-allowed', 0, 10), false);
    assert.equal(shouldAutoRestartAfterError('no-speech', 10, 10), false);
  });
});