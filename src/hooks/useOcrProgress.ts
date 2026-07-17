import { useCallback, useMemo, useRef, useState } from 'react';
import {
  type VisionPipelineControls,
  type VisionPipelineId,
} from '@/hooks/visionPipeline';

type PipelineUiState = { progress: number; statusMessage: string };

const INITIAL_UI: PipelineUiState = { progress: 0, statusMessage: '' };

export function useOcrProgress() {
  const activePipelineRef = useRef<VisionPipelineId | null>(null);
  const [activePipeline, setActivePipeline] = useState<VisionPipelineId | null>(null);
  const [roScanUi, setRoScanUi] = useState<PipelineUiState>(INITIAL_UI);
  const [xentryUi, setXentryUi] = useState<PipelineUiState>(INITIAL_UI);

  const getActivePipeline = useCallback((): VisionPipelineId | null => activePipelineRef.current, []);

  const tryAcquirePipeline = useCallback((pipeline: VisionPipelineId): boolean => {
    const current = activePipelineRef.current;
    if (current !== null && current !== pipeline) {
      return false;
    }
    activePipelineRef.current = pipeline;
    setActivePipeline(pipeline);
    return true;
  }, []);

  const releasePipeline = useCallback((pipeline: VisionPipelineId) => {
    if (activePipelineRef.current !== pipeline) return;
    activePipelineRef.current = null;
    setActivePipeline(null);
    if (pipeline === 'ro_scan') {
      setRoScanUi(INITIAL_UI);
    } else {
      setXentryUi(INITIAL_UI);
    }
  }, []);

  const buildControls = useCallback(
    (pipeline: VisionPipelineId): VisionPipelineControls => {
      const isRoScan = pipeline === 'ro_scan';
      const ui = isRoScan ? roScanUi : xentryUi;
      const setUi = isRoScan ? setRoScanUi : setXentryUi;
      const defaultStartMessage = isRoScan ? 'Preparing scan…' : 'Preparing diagnostic photos…';

      return {
        id: pipeline,
        isProcessing: activePipeline === pipeline,
        progress: ui.progress,
        statusMessage: ui.statusMessage,
        tryAcquire: () => tryAcquirePipeline(pipeline),
        release: () => releasePipeline(pipeline),
        start: (message = defaultStartMessage) => {
          setUi({ progress: 0, statusMessage: message });
        },
        setProgress: (progress: number) => {
          setUi((prev) => ({ ...prev, progress }));
        },
        setStatusMessage: (statusMessage: string) => {
          setUi((prev) => ({ ...prev, statusMessage }));
        },
        finish: () => releasePipeline(pipeline),
      };
    },
    [activePipeline, releasePipeline, roScanUi, tryAcquirePipeline, xentryUi]
  );

  const roScan = useMemo(() => buildControls('ro_scan'), [buildControls]);
  const xentry = useMemo(() => buildControls('xentry'), [buildControls]);

  return {
    activePipeline,
    isAnyPipelineActive: activePipeline !== null,
    getActivePipeline,
    roScan,
    xentry,
  };
}