/// <reference path="./sampling-assets.d.ts" />
import { AudioEngine } from '@/player/audio/audioEngine';
import { resolveAudioSource } from '@/player/audio/audioResources';
import type { Project } from '@/project/types';
import signageDataUrl from '../game/assets/sampling/station-signage.png?inline';
import audioDataUrl from '../game/assets/sampling/ui-open.mp3?inline';
import { applySampling } from '../game/src/assets/sampling.ts';

export function samplingProject(project: Project): Project {
  return applySampling(project, { signageDataUrl, audioDataUrl });
}

/** The native UI-open gesture uses the pinned engine's queued SE playback path. */
export function mountSamplingNotice(parent: HTMLElement, project: Project): () => void {
  const audio = new AudioEngine();
  const open = document.createElement('button'); open.type = 'button';
  open.dataset['samplingNotice'] = 'open'; open.textContent = '역 안내';
  const dialog = document.createElement('dialog');
  const text = document.createElement('p'); text.textContent = '역 표지 샘플 · 구로 / Kenney + original CC0';
  const close = document.createElement('button'); close.textContent = '닫기'; close.onclick = () => dialog.close();
  dialog.append(text, close); parent.append(open, dialog);
  open.onclick = () => {
    dialog.showModal();
    const url = resolveAudioSource('sampling-ui-open', project);
    if (!url) throw new Error('Registered sampling audio missing');
    audio.unlock();
    audio.play('se', 'sampling-ui-open', url, false);
    open.dataset['playbackAttempted'] = 'true';
  };
  return () => { audio.stopAll(); open.remove(); dialog.remove(); };
}
